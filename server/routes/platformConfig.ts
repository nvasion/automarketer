import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPublicOAuthConfig } from '../utils/platformOAuth.js';

const router = Router();

// ── Authentication guard ─────────────────────────────────────────────────────
// Reading the platform config requires a valid auth_token cookie.
router.use(requireAuth);

/**
 * GET /api/platform-config
 *
 * Returns the OAuth client IDs configured on the server, one entry per
 * supported platform (empty string when that platform is not configured).
 *
 * Shared-app model: AutoMarketer owns one OAuth app per platform, configured
 * via <PLATFORM>_CLIENT_ID / <PLATFORM>_CLIENT_SECRET environment variables.
 * Client IDs are public (they appear in OAuth redirect URLs), so they are safe
 * to serve to the browser. Secrets are never exposed. There is no per-user
 * client-ID storage — every user shares the same OAuth app.
 */
router.get('/', (_req: Request, res: Response): void => {
  res.json(getPublicOAuthConfig());
});

export default router;
