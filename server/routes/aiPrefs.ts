import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { aiPrefsStore } from '../db/aiPrefsTable.js';
import type { AiPrefs } from '../db/aiPrefsTable.js';

const router = Router();

// ── Authentication guard ─────────────────────────────────────────────────────
router.use(requireAuth);

const VALID_TONES = new Set(['professional', 'casual', 'excited', 'informative']);
const VALID_EMOJI = new Set(['none', 'minimal', 'moderate', 'heavy']);

/**
 * Validate an incoming preferences payload. Returns the sanitized AiPrefs, or
 * null when any field is missing or out of range. Keeping this strict prevents
 * malformed values from being persisted and later breaking generation.
 */
function parsePrefs(body: unknown): AiPrefs | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.tone !== 'string' || !VALID_TONES.has(b.tone)) return null;
  if (typeof b.emojiUsage !== 'string' || !VALID_EMOJI.has(b.emojiUsage)) return null;
  if (typeof b.autoHashtags !== 'boolean') return null;
  if (typeof b.maxTokens !== 'number' || b.maxTokens <= 0 || b.maxTokens > 32_000) return null;
  if (typeof b.temperature !== 'number' || b.temperature < 0 || b.temperature > 2) return null;

  return {
    tone: b.tone,
    emojiUsage: b.emojiUsage,
    autoHashtags: b.autoHashtags,
    maxTokens: b.maxTokens,
    temperature: b.temperature,
  };
}

/**
 * GET /api/ai-prefs
 *
 * Returns the user's saved generation preferences, or null when none are
 * stored yet (the client then keeps its local defaults). Never returns API
 * keys — those are intentionally browser-only.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await aiPrefsStore.get(req.user!.sub));
  } catch (err) {
    console.error('[ai-prefs] read failed:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to load preferences', code: 'STORAGE_ERROR' });
  }
});

/**
 * PUT /api/ai-prefs
 *
 * Upserts the user's generation preferences. Rejects with 400 on an invalid
 * payload.
 */
router.put('/', async (req: Request, res: Response): Promise<void> => {
  const prefs = parsePrefs(req.body);
  if (!prefs) {
    res.status(400).json({ error: 'Invalid preferences payload', code: 'INVALID_INPUT' });
    return;
  }
  try {
    await aiPrefsStore.set(req.user!.sub, prefs);
    res.json(prefs);
  } catch (err) {
    console.error('[ai-prefs] write failed:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to save preferences', code: 'STORAGE_ERROR' });
  }
});

export default router;
