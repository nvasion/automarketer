import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { platformConfigStore } from '../models/platformConfigStore.js';

const router = Router();

// Throttle the public config endpoint to prevent scraping / DoS.
// Client IDs are public but there is no reason to serve thousands of requests
// per minute from a single IP. In test mode the middleware is omitted so
// automated test suites can query the endpoint freely without hitting limits.
if (process.env.NODE_ENV !== 'test') {
  const configLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15-minute sliding window
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
  });
  router.use(configLimiter);
}

/**
 * GET /api/platform-config
 *
 * Returns OAuth 2.0 client IDs for all supported social platforms.
 *
 * Authentication is NOT required — client IDs are public values (they appear
 * verbatim in every OAuth redirect URL) and are safe to expose to the browser.
 *
 * Client IDs are persisted in the platform_configs database table and managed
 * through the authenticated admin API (PUT/DELETE /api/admin/platform-config/:platform).
 * An empty string for a platform means it has not been configured yet; the
 * frontend should show setup instructions in that case.
 *
 * Response shape:
 *   {
 *     linkedin:  string,   // LinkedIn OAuth 2.0 Client ID (or "")
 *     twitter:   string,   // Twitter OAuth 2.0 Client ID (or "")
 *     reddit:    string,   // Reddit OAuth 2.0 Client ID (or "")
 *     facebook:  string,   // Meta App ID shared by Facebook & Instagram (or "")
 *     instagram: string,   // same value as facebook (or "")
 *   }
 */
router.get('/', (_req: Request, res: Response): void => {
  res.json(platformConfigStore.getAll());
});

export default router;
