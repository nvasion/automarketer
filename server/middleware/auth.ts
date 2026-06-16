import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../utils/config.js';
import type { JwtPayload } from '../types.js';

/**
 * Verifies the JWT stored in the httpOnly `auth_token` cookie and attaches
 * the decoded payload to `req.user`. Responds with 401 if the token is
 * missing, malformed, or expired.
 *
 * Algorithm is explicitly restricted to HS256 to prevent algorithm-confusion
 * attacks (e.g., swapping to "none" or an asymmetric algorithm).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.auth_token as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'Authentication required', code: 'MISSING_TOKEN' });
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret(), {
      algorithms: ['HS256'], // explicit allowlist prevents algorithm-confusion attacks
    }) as JwtPayload;

    req.user = payload;
    next();
  } catch (err) {
    const error = err as Error;
    // Log the token failure type (expired vs. tampered) to aid debugging —
    // but never log the raw token value or stack trace.
    console.warn('[auth] JWT verification failed:', error.name, error.message);
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
}
