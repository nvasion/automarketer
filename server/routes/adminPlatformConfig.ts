import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { platformConfigStore } from '../models/platformConfigStore.js';

const router = Router();

// ── Authentication guard ───────────────────────────────────────────────────────
// requireAuth verifies the httpOnly auth_token JWT cookie on EVERY request to
// this router before any handler runs. Unauthenticated callers receive 401.
// This prevents arbitrary clients from writing OAuth client IDs to the database.
router.use(requireAuth);

// ── Allowed platforms ─────────────────────────────────────────────────────────
const VALID_PLATFORMS = new Set([
  'linkedin',
  'twitter',
  'reddit',
  'facebook',
  'instagram',
]);

// ── Client ID validation ──────────────────────────────────────────────────────
// OAuth client IDs are short, printable identifiers. We reject:
//   • Values longer than 256 characters (generous upper bound — real IDs are
//     under 100 chars for every supported platform).
//   • Values containing ASCII control characters (null bytes, newlines, etc.)
//     which could enable log-injection or database corruption.
// We intentionally do NOT restrict the character set beyond that — some
// platforms issue IDs with dots, dashes, or base64 characters.
const CLIENT_ID_MAX_LEN = 256;
// Matches any ASCII control character (0x00–0x1F, 0x7F).
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;

function isValidClientId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= CLIENT_ID_MAX_LEN &&
    !CONTROL_CHAR_RE.test(value)
  );
}

/**
 * GET /api/admin/platform-config
 *
 * Returns the complete set of OAuth client IDs. Identical shape to the public
 * GET /api/platform-config endpoint, but requires authentication so the
 * frontend can use this route from the settings UI where the user is logged in.
 */
router.get('/', (_req: Request, res: Response): void => {
  res.json(platformConfigStore.getAll());
});

/**
 * PUT /api/admin/platform-config/:platform
 *
 * Set or update the OAuth client ID for a platform.
 *
 * Body:  { "clientId": "<string>" }
 *
 * Facebook and Instagram share the same Meta App ID. Updating either one
 * automatically mirrors the value to the other so they stay in sync.
 *
 * Writes are applied to the in-memory cache immediately (so the new value
 * is served at once) and then persisted to the database for durability across
 * server restarts.
 */
router.put('/:platform', async (req: Request, res: Response): Promise<void> => {
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

  // Update cache + persist to DB for the target platform.
  platformConfigStore.setClientId(platform, trimmed);
  await platformConfigStore.saveToDb(platform, trimmed);

  // Facebook and Instagram share the same Meta App ID — mirror the value.
  const mirror = platform === 'facebook' ? 'instagram' : platform === 'instagram' ? 'facebook' : null;
  if (mirror) {
    platformConfigStore.setClientId(mirror, trimmed);
    await platformConfigStore.saveToDb(mirror, trimmed);
  }

  res.json({ platform, clientId: trimmed });
});

/**
 * DELETE /api/admin/platform-config/:platform
 *
 * Clear the client ID for a platform (sets it to an empty string).
 * After this call the GET /api/platform-config endpoint will return "" for
 * the platform and the frontend will display setup instructions.
 */
router.delete('/:platform', async (req: Request, res: Response): Promise<void> => {
  const { platform } = req.params;

  if (!VALID_PLATFORMS.has(platform)) {
    res.status(400).json({
      error: `Unknown platform. Valid platforms: ${[...VALID_PLATFORMS].join(', ')}`,
      code: 'INVALID_PLATFORM',
    });
    return;
  }

  platformConfigStore.setClientId(platform, '');
  await platformConfigStore.saveToDb(platform, '');

  // Mirror to the paired platform for facebook/instagram.
  const mirror = platform === 'facebook' ? 'instagram' : platform === 'instagram' ? 'facebook' : null;
  if (mirror) {
    platformConfigStore.setClientId(mirror, '');
    await platformConfigStore.saveToDb(mirror, '');
  }

  res.json({ platform, clientId: '' });
});

export default router;
