import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { userStore } from '../models/userStore.js';
import { requireAuth } from '../middleware/auth.js';
import { jwtSecret } from '../utils/config.js';
import type { PublicUser, User } from '../types.js';
import { getPool } from '../db/connection.js';
import { emailExists as dbEmailExists } from '../db/usersTable.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12; // OWASP minimum is 10; 12 gives a comfortable margin
const TOKEN_TTL = '7d';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Prevents credential-stuffing and brute-force attacks.
// In test environments the limit is raised to avoid flaky tests.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute sliding window
  max: process.env.NODE_ENV === 'test' ? 500 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
});

// ── Input validators ─────────────────────────────────────────────────────────

function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

// ── Cookie helper ─────────────────────────────────────────────────────────────

function cookieOptions() {
  return {
    httpOnly: true, // inaccessible to JS — mitigates XSS token theft
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'strict' as const, // CSRF protection
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  };
}

// ── Token & user helpers ─────────────────────────────────────────────────────

function signToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL,
  });
}

function toPublic(user: { id: string; email: string; createdAt: string }): PublicUser {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// Apply rate limiting to all auth routes
router.use(authLimiter);

/**
 * POST /api/auth/register
 * Body: { email: string; password: string }
 * Response: { user: PublicUser }
 * Sets an httpOnly auth_token cookie on success.
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as Record<string, unknown>;

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'A valid email address is required.', code: 'INVALID_EMAIL' });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({
      error: 'Password must be between 8 and 128 characters.',
      code: 'INVALID_PASSWORD',
    });
    return;
  }

  // Check if email exists in DB (if available) or in-memory cache
  const pool = getPool();
  if (pool) {
    const exists = await dbEmailExists(pool, email);
    if (exists) {
      res.status(409).json({ error: 'An account with that email already exists.', code: 'DUPLICATE_EMAIL' });
      return;
    }
  } else if (userStore.emailExists(email)) {
    res.status(409).json({ error: 'An account with that email already exists.', code: 'DUPLICATE_EMAIL' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = userStore.create(email, passwordHash);
  
  // Persist to database if available
  if (pool) {
    await userStore.saveToDb(user);
  }
  
  const token = signToken(user.id, user.email);

  res.cookie('auth_token', token, cookieOptions());
  res.status(201).json({ user: toPublic(user) });
});

/**
 * POST /api/auth/login
 * Body: { email: string; password: string }
 * Response: { user: PublicUser }
 * Sets an httpOnly auth_token cookie on success.
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as Record<string, unknown>;

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'A valid email address is required.', code: 'INVALID_EMAIL' });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({
      error: 'Password must be between 8 and 128 characters.',
      code: 'INVALID_PASSWORD',
    });
    return;
  }

  // Try DB first if available, otherwise fall back to in-memory cache
  const pool = getPool();
  let user: User | undefined;
  
  if (pool) {
    const { findByEmail: dbFindByEmail } = await import('../db/usersTable.js');
    user = await dbFindByEmail(pool, email);
  }
  
  if (!user) {
    user = userStore.findByEmail(email);
  }
  
  if (!user) {
    // Return a generic message to prevent user-enumeration attacks
    res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const token = signToken(user.id, user.email);
  res.cookie('auth_token', token, cookieOptions());
  res.status(200).json({ user: toPublic(user) });
});

/**
 * POST /api/auth/logout
 * Clears the auth_token cookie.
 */
router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('auth_token', { path: '/' });
  res.status(200).json({ message: 'Logged out successfully.' });
});

/**
 * GET /api/auth/me
 * Requires: valid auth_token cookie.
 * Response: { user: PublicUser }
 */
router.get('/me', requireAuth, (req: Request, res: Response): void => {
  const payload = req.user!;
  const user = userStore.findById(payload.sub);

  if (!user) {
    // Token is valid but the user was deleted (edge-case in this in-memory store)
    res.status(404).json({ error: 'User not found.', code: 'USER_NOT_FOUND' });
    return;
  }

  res.status(200).json({ user: toPublic(user) });
});

export default router;
