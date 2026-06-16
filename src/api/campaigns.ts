/**
 * Campaign API service — talks to the server-side campaign store.
 *
 * Campaigns are persisted per-user in the server database (see
 * server/routes/campaigns.ts), so they follow the account across browsers and
 * devices instead of living only in this browser's localStorage.
 *
 * The exported function signatures are unchanged from the previous
 * localStorage-backed implementation, so all React hooks and pages continue to
 * work without modification.
 *
 * One-time migration
 * ──────────────────
 * Earlier versions stored campaigns in localStorage only. On first use after
 * upgrading, any campaigns found in this browser's localStorage are uploaded to
 * the server once (see `ensureMigrated`), so existing data is preserved. The
 * upload is idempotent (upsert by id), so it is safe to retry.
 *
 * Error handling
 * ──────────────
 * Functions throw an `ApiError` carrying the server's message and HTTP status.
 * Client-side validation runs first for fast feedback before any network call.
 *
 * Authentication
 * ──────────────
 * The browser's httpOnly `auth_token` cookie is sent automatically via
 * `credentials: 'include'`; the server scopes every operation to that user.
 */

import { CampaignModel, computeStats } from '../db/CampaignModel'
import { isValidSubredditName, normalizeSubreddits } from '../utils/subreddits'
import type {
  CampaignRecord,
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignStats,
} from '../db/schema'

// ─── API error type ───────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message)
    this.name = 'ApiError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── Input validation ─────────────────────────────────────────────────────────

/** Only these URL schemes are permitted in websiteUrl fields. */
const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * Maximum allowed character lengths for string fields. Prevents oversized
 * payloads. The server enforces the same limits as the security boundary.
 */
const FIELD_MAX_LENGTHS = {
  name: 200,
  description: 5000,
  targetAudience: 500,
  websiteUrl: 2048,
} as const

function validateWebsiteUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ApiError('Invalid websiteUrl: value must be a valid URL', 400)
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new ApiError('Invalid websiteUrl: only http and https schemes are allowed', 400)
  }
  if (url.length > FIELD_MAX_LENGTHS.websiteUrl) {
    throw new ApiError(
      `Invalid websiteUrl: must be ${FIELD_MAX_LENGTHS.websiteUrl} characters or fewer`,
      400
    )
  }
}

function validateStringLength(field: keyof typeof FIELD_MAX_LENGTHS, value: string): void {
  const max = FIELD_MAX_LENGTHS[field]
  if (value.length > max) {
    throw new ApiError(`Invalid ${field}: must be ${max} characters or fewer`, 400)
  }
}

/**
 * Validate subreddit input (single name or array). Names are checked after
 * normalization so "r/" prefixes and comma-separated lists are accepted.
 */
function validateSubreddits(input: string | string[]): void {
  for (const name of normalizeSubreddits(input)) {
    if (!isValidSubredditName(name)) {
      throw new ApiError(
        `Invalid subreddit "${name}": names may only contain letters, digits, and underscores (max 21 characters)`,
        400
      )
    }
  }
}

/** Validate a full CreateCampaignInput payload. Throws ApiError(400) on the first violation. */
function validateCreateInput(input: CreateCampaignInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new ApiError('Invalid name: campaign name is required', 400)
  }
  validateStringLength('name', input.name)
  validateStringLength('description', input.description)
  validateStringLength('targetAudience', input.targetAudience)
  if (input.websiteUrl) {
    validateWebsiteUrl(input.websiteUrl)
  }
  if (input.subreddits !== undefined) {
    validateSubreddits(input.subreddits)
  }
}

/** Validate a partial UpdateCampaignInput patch. Throws ApiError(400) on the first violation. */
function validateUpdateInput(patch: UpdateCampaignInput): void {
  if (patch.name !== undefined) {
    if (patch.name.trim().length === 0) {
      throw new ApiError('Invalid name: campaign name must not be empty', 400)
    }
    validateStringLength('name', patch.name)
  }
  if (patch.description !== undefined) {
    validateStringLength('description', patch.description)
  }
  if (patch.targetAudience !== undefined) {
    validateStringLength('targetAudience', patch.targetAudience)
  }
  if (patch.websiteUrl !== undefined) {
    validateWebsiteUrl(patch.websiteUrl)
  }
  if (patch.subreddits !== undefined) {
    validateSubreddits(patch.subreddits)
  }
}

// ─── HTTP helper ────────────────────────────────────────────────────────────

const BASE = '/api/campaigns'

/**
 * Fetch wrapper that sends the auth cookie, parses JSON, and converts non-2xx
 * responses (and network failures) into `ApiError` with the server's message.
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (HTTP ${res.status})`
    throw new ApiError(message, res.status)
  }

  return body as T
}

// ─── One-time localStorage → server migration ────────────────────────────────

const MIGRATED_FLAG = 'automarketer_campaigns_migrated'
let migrationPromise: Promise<void> | null = null

async function runMigration(): Promise<void> {
  if (localStorage.getItem(MIGRATED_FLAG) === 'true') return

  let local: CampaignRecord[]
  try {
    local = CampaignModel.findAll()
  } catch {
    local = []
  }

  if (local.length === 0) {
    try {
      localStorage.setItem(MIGRATED_FLAG, 'true')
    } catch {
      /* ignore quota / private-mode errors */
    }
    return
  }

  // Idempotent bulk upsert — preserves ids/timestamps. Throws on auth/network
  // failure so the flag is left unset and migration is retried on a later call.
  await apiFetch(`${BASE}/import`, {
    method: 'POST',
    body: JSON.stringify({ campaigns: local }),
  })

  try {
    localStorage.setItem(MIGRATED_FLAG, 'true')
  } catch {
    /* ignore */
  }
  console.info('[campaigns] migrated %d local campaign(s) to the server', local.length)
}

/**
 * Ensure the one-time migration has run before any read/write. Never throws:
 * on failure it logs and lets the operation proceed (the next call retries the
 * migration). Concurrent callers share a single in-flight attempt.
 */
function ensureMigrated(): Promise<void> {
  if (localStorage.getItem(MIGRATED_FLAG) === 'true') return Promise.resolve()
  if (!migrationPromise) {
    migrationPromise = runMigration().catch((err) => {
      migrationPromise = null // allow a later retry
      console.warn(
        '[campaigns] migration deferred:',
        err instanceof Error ? err.message : String(err)
      )
    })
  }
  return migrationPromise
}

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialise local state. Call once at app startup (e.g. in main.tsx).
 * Runs the localStorage schema/demo cleanup so that only the user's real
 * campaigns are later migrated to the server. Idempotent.
 */
export function initDb(): void {
  CampaignModel.init()
}

// ─── Read routes ──────────────────────────────────────────────────────────────

/** GET /api/campaigns — all campaigns sorted by createdAt descending. */
export async function fetchCampaigns(): Promise<CampaignRecord[]> {
  await ensureMigrated()
  return apiFetch<CampaignRecord[]>(BASE)
}

/** GET /api/campaigns/:id — the campaign, or throws ApiError(404). */
export async function fetchCampaign(id: string): Promise<CampaignRecord> {
  await ensureMigrated()
  return apiFetch<CampaignRecord>(`${BASE}/${encodeURIComponent(id)}`)
}

/** Aggregate statistics across all campaigns (computed from the list). */
export async function fetchCampaignStats(): Promise<CampaignStats> {
  await ensureMigrated()
  const campaigns = await apiFetch<CampaignRecord[]>(BASE)
  return computeStats(campaigns)
}

// ─── Write routes ─────────────────────────────────────────────────────────────

/** POST /api/campaigns — create a campaign; the server assigns id + timestamps. */
export async function createCampaign(input: CreateCampaignInput): Promise<CampaignRecord> {
  validateCreateInput(input)
  await ensureMigrated()
  return apiFetch<CampaignRecord>(BASE, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** PATCH /api/campaigns/:id — partial update; throws ApiError(404) if missing. */
export async function updateCampaign(id: string, patch: UpdateCampaignInput): Promise<CampaignRecord> {
  validateUpdateInput(patch)
  await ensureMigrated()
  return apiFetch<CampaignRecord>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** DELETE /api/campaigns/:id — throws ApiError(404) if the campaign does not exist. */
export async function deleteCampaign(id: string): Promise<void> {
  await ensureMigrated()
  await apiFetch<void>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
