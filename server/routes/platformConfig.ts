import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { platformConfigStore, SUPPORTED_PLATFORMS } from '../models/platformConfigStore.js';

const router = Router();

// ── Authentication guard ─────────────────────────────────────────────────────
// Every endpoint in this router requires a valid auth_token cookie. Each user
// owns their own OAuth client IDs — there is no public or admin variant.
router.use(requireAuth);

// ── Allowed platforms ─────────────────────────────────────────────────────────
const VALID_PLATFORMS = new Set<string>(SUPPORTED_PLATFORMS);

// ── Client ID validation ──────────────────────────────────────────────────────
// OAuth client IDs are short, printable identifiers. We reject:
//   • Values longer than 256 characters (generous upper bound — real IDs are
//     under 100 chars for every supported platform).
//   • Values containing ASCII control characters (null bytes, newlines, etc.)
//     which could enable log-injection or database corruption.
const CLIENT_ID_MAX_LEN = 256;
// Matches any ASCII control character (0x00–0x1F, 0x7F). Rejecting these
// is the whole point of the check, so silence ESLint's no-control-regex rule.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;

function isValidClientId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= CLIENT_ID_MAX_LEN &&
    !CONTROL_CHAR_RE.test(value)
  );
}

/** Facebook and Instagram are configured under the same Meta App ID. */
function mirrorOf(platform: string): string | null {
  if (platform === 'facebook') return 'instagram';
  if (platform === 'instagram') return 'facebook';
  return null;
}

/**
 * GET /api/platform-config
 *
 * Returns the calling user's OAuth client IDs for every supported platform.
 * Each user manages their own set; the response shape is stable (one entry
 * per platform, empty string when not yet configured).
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  // Refresh the cache from the DB on read so multi-process deployments stay
  // consistent. No-op when DATABASE_URL is not set.
  await platformConfigStore.loadForUser(userId);
  res.json(platformConfigStore.getAllForUser(userId));
});

/**
 * PUT /api/platform-config/:platform
 *
 * Set or update the calling user's OAuth client ID for a platform.
 *
 * Body:  { "clientId": "<string>" }
 *
 * Facebook and Instagram share the same Meta App ID. Updating either one
 * automatically mirrors the value to the other so they stay in sync within
 * the user's own configuration.
 */
router.put<{ platform: string }>('/:platform', async (req: Request<{ platform: string }>, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { platform } = req.params;
  const { clientId } = req.body as { clientId?: unknown };

  if (!VALID_PLATFORMS.has(platform)) {
    res.status(400).json({
      error: `Unknown platform. Valid platforms: ${[...VALID_PLATFORMS].join(', ')}`,
      code: 'INVALID_PLATFORM',
    });
    return;
  }

  if (!isValidClientId(clientId)) {
    res.status(400).json({
      error:
        'Request body must contain a "clientId" string field with at most 256 ' +
        'printable characters (no control characters).',
      code: 'INVALID_BODY',
    });
    return;
  }

  const trimmed = clientId.trim();

  platformConfigStore.setClientIdForUser(userId, platform, trimmed);
  await platformConfigStore.saveToDbForUser(userId, platform, trimmed);

  const mirror = mirrorOf(platform);
  if (mirror) {
    platformConfigStore.setClientIdForUser(userId, mirror, trimmed);
    await platformConfigStore.saveToDbForUser(userId, mirror, trimmed);
  }

  res.json({ platform, clientId: trimmed });
});

/**
 * DELETE /api/platform-config/:platform
 *
 * Clear the calling user's client ID for a platform (sets it to an empty
 * string). Subsequent GETs will return "" for the platform and the frontend
 * will show the setup form again.
 */
router.delete<{ platform: string }>('/:platform', async (req: Request<{ platform: string }>, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { platform } = req.params;

  if (!VALID_PLATFORMS.has(platform)) {
    res.status(400).json({
      error: `Unknown platform. Valid platforms: ${[...VALID_PLATFORMS].join(', ')}`,
      code: 'INVALID_PLATFORM',
    });
    return;
  }

  platformConfigStore.setClientIdForUser(userId, platform, '');
  await platformConfigStore.saveToDbForUser(userId, platform, '');

  const mirror = mirrorOf(platform);
  if (mirror) {
    platformConfigStore.setClientIdForUser(userId, mirror, '');
    await platformConfigStore.saveToDbForUser(userId, mirror, '');
  }

  res.json({ platform, clientId: '' });
});

export default router;
