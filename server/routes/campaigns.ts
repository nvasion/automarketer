import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { campaignStore } from '../db/campaignsTable.js';
import { isValidSubredditName, normalizeSubreddits } from '../../src/utils/subreddits.js';
import type {
  CampaignRecord,
  CreateCampaignInput,
  UpdateCampaignInput,
} from '../../src/db/schema.js';

const router = Router();

// ── Authentication guard ─────────────────────────────────────────────────────
// Every campaign belongs to the authenticated user; the user id comes from the
// verified JWT, never from the request body.
router.use(requireAuth);

// ── Validation ────────────────────────────────────────────────────────────────
// Mirrors the client-side validation in src/api/campaigns.ts. The client
// validates for fast feedback; the server re-validates because it is the
// security boundary and clients can be bypassed.

const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:']);
const FIELD_MAX_LENGTHS = {
  name: 200,
  description: 5000,
  targetAudience: 500,
  websiteUrl: 2048,
} as const;

class ValidationError extends Error {}

function validateLength(field: keyof typeof FIELD_MAX_LENGTHS, value: string): void {
  if (value.length > FIELD_MAX_LENGTHS[field]) {
    throw new ValidationError(`Invalid ${field}: must be ${FIELD_MAX_LENGTHS[field]} characters or fewer`);
  }
}

function validateWebsiteUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('Invalid websiteUrl: value must be a valid URL');
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new ValidationError('Invalid websiteUrl: only http and https schemes are allowed');
  }
  validateLength('websiteUrl', url);
}

function validateSubreddits(input: string | string[]): void {
  for (const name of normalizeSubreddits(input)) {
    if (!isValidSubredditName(name)) {
      throw new ValidationError(
        `Invalid subreddit "${name}": names may only contain letters, digits, and underscores (max 21 characters)`,
      );
    }
  }
}

function validateCreate(input: CreateCampaignInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('Invalid name: campaign name is required');
  }
  validateLength('name', input.name);
  validateLength('description', input.description ?? '');
  validateLength('targetAudience', input.targetAudience ?? '');
  if (input.websiteUrl) validateWebsiteUrl(input.websiteUrl);
  if (input.subreddits !== undefined) validateSubreddits(input.subreddits);
}

function validateUpdate(patch: UpdateCampaignInput): void {
  if (patch.name !== undefined) {
    if (patch.name.trim().length === 0) throw new ValidationError('Invalid name: campaign name must not be empty');
    validateLength('name', patch.name);
  }
  if (patch.description !== undefined) validateLength('description', patch.description);
  if (patch.targetAudience !== undefined) validateLength('targetAudience', patch.targetAudience);
  if (patch.websiteUrl !== undefined) validateWebsiteUrl(patch.websiteUrl);
  if (patch.subreddits !== undefined) validateSubreddits(patch.subreddits);
}

/** Map a validation failure to a 400 response; rethrow anything else. */
function handle(err: unknown, res: Response): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, code: 'INVALID_INPUT' });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('[campaigns] storage error:', message);
  res.status(500).json({ error: 'Failed to persist campaign data', code: 'STORAGE_ERROR' });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/campaigns — all campaigns for the user, newest first. */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await campaignStore.findAll(req.user!.sub));
  } catch (err) {
    handle(err, res);
  }
});

/** GET /api/campaigns/:id — a single campaign, or 404. */
router.get('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const record = await campaignStore.findById(req.user!.sub, req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
      return;
    }
    res.json(record);
  } catch (err) {
    handle(err, res);
  }
});

/** POST /api/campaigns — create a campaign; the server assigns id + timestamps. */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const input = req.body as CreateCampaignInput;
    validateCreate(input);

    const now = new Date().toISOString();
    const { subreddits, ...rest } = input;
    const normalized = normalizeSubreddits(subreddits);
    const record: CampaignRecord = {
      ...rest,
      platforms: rest.platforms ?? [],
      screenshots: rest.screenshots ?? [],
      posts: rest.posts ?? [],
      ...(normalized.length > 0 && { subreddits: normalized }),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await campaignStore.upsert(req.user!.sub, record);
    res.status(201).json(record);
  } catch (err) {
    handle(err, res);
  }
});

/** PATCH /api/campaigns/:id — partial update; 404 when the campaign is unknown. */
router.patch('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const patch = req.body as UpdateCampaignInput;
    validateUpdate(patch);

    const existing = await campaignStore.findById(req.user!.sub, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
      return;
    }

    const { subreddits, ...rest } = patch;
    const updated: CampaignRecord = {
      ...existing,
      ...rest,
      ...(subreddits !== undefined && { subreddits: normalizeSubreddits(subreddits) }),
      id: existing.id, // id and creation time are immutable
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await campaignStore.upsert(req.user!.sub, updated);
    res.json(updated);
  } catch (err) {
    handle(err, res);
  }
});

/** DELETE /api/campaigns/:id — 404 when the campaign is unknown. */
router.delete('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const deleted = await campaignStore.delete(req.user!.sub, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    handle(err, res);
  }
});

/**
 * POST /api/campaigns/import — bulk upsert used by the client's one-time
 * migration of pre-existing localStorage campaigns. Each record keeps its
 * original id and timestamps so re-running the import is idempotent. Malformed
 * records are skipped rather than failing the whole batch.
 */
router.post('/import', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { campaigns?: unknown };
    const incoming = Array.isArray(body.campaigns) ? body.campaigns : [];
    let imported = 0;

    for (const item of incoming) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as Record<string, unknown>).id !== 'string' ||
        typeof (item as Record<string, unknown>).name !== 'string'
      ) {
        continue;
      }
      const record = item as CampaignRecord;
      const now = new Date().toISOString();
      await campaignStore.upsert(req.user!.sub, {
        ...record,
        platforms: record.platforms ?? [],
        screenshots: record.screenshots ?? [],
        posts: record.posts ?? [],
        createdAt: record.createdAt ?? now,
        updatedAt: record.updatedAt ?? now,
      });
      imported++;
    }

    console.log(`[campaigns] import: user=${req.user!.sub} imported=${imported}/${incoming.length}`);
    res.json({ imported });
  } catch (err) {
    handle(err, res);
  }
});

export default router;
