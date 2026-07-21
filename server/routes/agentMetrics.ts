import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getUsageSummary,
  getRecentUsage,
  isAgentPlatform,
} from '../utils/tokenUsageTracker.js';
import type { AgentPlatform } from '../utils/tokenUsageTracker.js';

const router = Router();

// All agent metrics routes require authentication — usage data is per-user.
router.use(requireAuth);

const DEFAULT_RECENT_LIMIT = 50;
const MAX_RECENT_LIMIT = 1000;

/**
 * Validates userId from auth middleware to prevent invalid/malicious IDs,
 * mirroring the guard used in server/routes/agentAuth.ts.
 */
function isValidUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && userId.trim().length > 0 && userId.length <= 256;
}

/**
 * Parses and clamps the `limit` query param. Returns null (and never throws)
 * when the value is missing/invalid so callers can fall back to the default.
 */
function parseLimit(raw: unknown): number | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string') return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, MAX_RECENT_LIMIT);
}

/**
 * GET /api/agent-metrics
 *
 * Returns aggregate token usage for the authenticated user across all agent
 * platforms (reddit, x) — total tokens, total requests, and a per-platform
 * breakdown. Users with no recorded usage get an all-zero summary.
 */
router.get('/', (req: Request, res: Response): void => {
  const userId = req.user!.sub;

  if (!isValidUserId(userId)) {
    res.status(401).json({ error: 'Invalid user authentication', code: 'INVALID_USER' });
    return;
  }

  try {
    res.status(200).json(getUsageSummary(userId));
  } catch (error) {
    console.error('[agentMetrics] Error building usage summary:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to load usage metrics', code: 'METRICS_ERROR' });
  }
});

/**
 * GET /api/agent-metrics/recent?limit=N
 *
 * Returns the authenticated user's most recent token-usage records, newest
 * first. `limit` defaults to 50 and is clamped to 1000; an invalid limit
 * falls back to the default rather than erroring, since it's a display hint.
 */
router.get('/recent', (req: Request, res: Response): void => {
  const userId = req.user!.sub;

  if (!isValidUserId(userId)) {
    res.status(401).json({ error: 'Invalid user authentication', code: 'INVALID_USER' });
    return;
  }

  const limit = parseLimit(req.query.limit) ?? DEFAULT_RECENT_LIMIT;

  try {
    res.status(200).json({ records: getRecentUsage(userId, limit) });
  } catch (error) {
    console.error('[agentMetrics] Error loading recent usage:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to load usage metrics', code: 'METRICS_ERROR' });
  }
});

/**
 * GET /api/agent-metrics/:platform
 *
 * Returns the authenticated user's usage totals for a single platform
 * ('reddit' | 'x'). Responds 400 for any other platform value.
 */
router.get('/:platform', (req: Request, res: Response): void => {
  const { platform } = req.params;

  if (!isAgentPlatform(platform)) {
    res.status(400).json({ error: 'Invalid platform. Must be one of: reddit, x', code: 'INVALID_PLATFORM' });
    return;
  }

  const userId = req.user!.sub;

  if (!isValidUserId(userId)) {
    res.status(401).json({ error: 'Invalid user authentication', code: 'INVALID_USER' });
    return;
  }

  try {
    const summary = getUsageSummary(userId);
    const platformKey = platform as AgentPlatform;
    res.status(200).json({
      userId: summary.userId,
      platform: platformKey,
      ...summary.byPlatform[platformKey],
    });
  } catch (error) {
    console.error('[agentMetrics] Error loading platform usage:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: 'Failed to load usage metrics', code: 'METRICS_ERROR' });
  }
});

export default router;
