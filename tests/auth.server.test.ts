// @vitest-environment node
/**
 * Supertest integration tests for the /api/auth/* Express routes.
 *
 * These run in Node environment (not jsdom) because they import real server
 * modules and use the Node-native http module underneath Supertest.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { userStore } from '../server/models/userStore';

const app = createApp();

// Clear in-memory store between tests so registrations don't bleed across cases
beforeEach(() => {
  userStore._clear();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function registerUser(
  email = 'test@example.com',
  password = 'password123',
) {
  return request(app).post('/api/auth/register').send({ email, password });
}

async function loginAndGetCookie(
  email = 'test@example.com',
  password = 'password123',
) {
  await registerUser(email, password);
  const res = await request(app).post('/api/auth/login').send({ email, password });
  // Supertest exposes Set-Cookie headers as an array
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0] ?? '';
  return cookie;
}

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 and a status field', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });
});

// ── POST /api/auth/register ───────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('creates a user and returns 201 with public user data', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'test@example.com' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('sets an httpOnly auth_token cookie on success', async () => {
    const res = await registerUser();
    const setCookieHeader = res.headers['set-cookie'] as string[] | undefined;
    expect(setCookieHeader).toBeDefined();
    const cookie = setCookieHeader?.[0] ?? '';
    expect(cookie).toContain('auth_token=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=strict');
  });

  it('normalises email to lowercase', async () => {
    const res = await registerUser('User@EXAMPLE.COM');
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('user@example.com');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_EMAIL');
  });

  it('rejects an invalid email format with 400', async () => {
    const res = await registerUser('not-an-email');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EMAIL');
  });

  it('rejects a missing email with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EMAIL');
  });

  it('rejects a password shorter than 8 characters with 400', async () => {
    const res = await registerUser('test@example.com', 'short');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PASSWORD');
  });

  it('rejects a missing password with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PASSWORD');
  });

  it('rejects a password longer than 128 characters with 400', async () => {
    const res = await registerUser('test@example.com', 'a'.repeat(129));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PASSWORD');
  });
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 200 and user data for valid credentials', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'test@example.com' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('sets an httpOnly auth_token cookie on success', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0] ?? '';
    expect(cookie).toContain('auth_token=');
    expect(cookie.toLowerCase()).toContain('httponly');
  });

  it('is case-insensitive for email', async () => {
    await registerUser('user@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'USER@EXAMPLE.COM', password: 'password123' });
    expect(res.status).toBe(200);
  });

  it('returns 401 for an unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 for a wrong password', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same error for wrong email and wrong password (no user enumeration)', async () => {
    await registerUser();
    const badEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });
    const badPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });
    expect(badEmail.body.code).toBe('INVALID_CREDENTIALS');
    expect(badPassword.body.code).toBe('INVALID_CREDENTIALS');
    expect(badEmail.body.error).toBe(badPassword.body.error);
  });

  it('rejects invalid email format with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EMAIL');
  });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears the auth_token cookie', async () => {
    const cookie = await loginAndGetCookie();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    // The Set-Cookie header should clear the cookie (max-age=0 or expires in past)
    const setCookie = ((res.headers['set-cookie'] as string[] | undefined) ?? []).join(' ');
    expect(setCookie.toLowerCase()).toMatch(/auth_token=;|max-age=0/);
  });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns the user profile when authenticated', async () => {
    const cookie = await loginAndGetCookie();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'test@example.com' });
  });

  it('returns 401 when no cookie is present', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 for an invalid token value', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'auth_token=invalid.jwt.token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a token signed with a different secret', async () => {
    // Forge a token using a wrong secret — simulates a tampered token
    const jwt = await import('jsonwebtoken');
    const forgedToken = jwt.sign(
      { sub: 'fake-id', email: 'hacker@example.com' },
      'wrong-secret',
      { algorithm: 'HS256' },
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${forgedToken}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});
