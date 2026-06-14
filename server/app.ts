import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRouter from './routes/auth.js';
import platformConfigRouter from './routes/platformConfig.js';
import publishRouter from './routes/publish.js';
import oauthCallbackRouter from './routes/oauthCallback.js';

/**
 * Factory function that creates and configures the Express application.
 * Exporting this separately from the HTTP listener makes the app trivially
 * testable with Supertest without binding to a real port.
 */
export function createApp(): express.Application {
  const app = express();

  // ── CORS ───────────────────────────────────────────────────────────────────
  // credentials: true is required for the browser to send/receive cookies
  // cross-origin. The allowed origin must be explicit (not '*') when
  // credentials are enabled.
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl && process.env.NODE_ENV === 'production') {
    throw new Error(
      'FRONTEND_URL environment variable must be set in production to restrict CORS. ' +
        'Example: FRONTEND_URL=https://app.example.com',
    );
  }

  app.use(
    cors({
      origin: frontendUrl ?? 'http://localhost:5173',
      credentials: true, // required for cross-origin cookie exchange
    }),
  );

  // ── Body & cookie parsing ─────────────────────────────────────────────────
  app.use(express.json());
  app.use(cookieParser());

  // ── Routes ────────────────────────────────────────────────────────────────
  // The authRouter applies its own rate limiter (20 req / 15 min per IP) to
  // all auth endpoints before any handler runs — see server/routes/auth.ts.
  app.use('/api/auth', authRouter);

  // Per-user OAuth client IDs (GET/PUT/DELETE) — every endpoint requires
  // authentication; each account owns its own set of client IDs.
  app.use('/api/platform-config', platformConfigRouter);

  // Publish posts to social platforms
  app.use('/api/publish', publishRouter);

  // OAuth callback handler
  app.use('/api/oauth', oauthCallbackRouter);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Global error handler ─────────────────────────────────────────────────
  // Must have exactly four parameters for Express to treat it as an error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const isProduction = process.env.NODE_ENV === 'production';

    if (err instanceof Error) {
      // In production: log only the error name and a sanitised message — never
      // stack traces or raw field values which may contain PII or secrets.
      // In development: include the stack for fast debugging.
      console.error('[server] Unhandled error:', {
        name: err.name,
        message: isProduction ? 'Internal server error' : err.message,
        ...(isProduction ? {} : { stack: err.stack }),
      });
    } else {
      console.error('[server] Unhandled non-Error thrown');
    }

    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  return app;
}

// Pre-instantiated app for convenience (used by the dev server entry point)
export const app = createApp();
