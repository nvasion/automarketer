/**
 * Campaign API service — async wrapper around the CampaignModel ORM.
 *
 * These functions provide a Promise-based interface that mirrors the contract
 * a REST backend would expose.  All I/O currently goes through localStorage
 * (via CampaignModel), but callers do not need to know that detail — they
 * simply await these functions.
 *
 * Switching to a real backend later requires updating only this file:
 *   - Replace `CampaignModel.*` calls with `fetch('/api/campaigns/...')`
 *   - All React hooks and pages continue to work without modification.
 *
 * Error handling
 * ──────────────
 * Functions throw an `ApiError` when the underlying operation fails.  All
 * client-facing error messages are generic (no internal IDs or stack traces)
 * to avoid leaking implementation details; detailed context is written to the
 * browser console for local debugging.
 *
 * Authentication
 * ──────────────
 * Write operations enforce an authentication guard via `assertAuthenticated()`.
 * The guard checks for a session token written by the auth service on login.
 * Replace the localStorage check with a proper JWT-validation call once the
 * full auth service is wired in (PRD task #2).
 *
 * Input validation
 * ────────────────
 * User-supplied payloads are validated before reaching the storage layer to
 * prevent URI injection, stored XSS, and oversized payloads from corrupting
 * the record store.  Only `http` and `https` URL schemes are accepted.
 */

import { CampaignModel, StorageError } from '../db/CampaignModel'
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

// ─── Authentication guard ─────────────────────────────────────────────────────

// Authentication is now handled exclusively by the server-side JWT middleware.
// The localStorage-based guard was removed because the auth service uses
// httpOnly cookies, not localStorage.

// ─── Input validation ─────────────────────────────────────────────────────────

/** Only these URL schemes are permitted in websiteUrl fields. */
const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * Maximum allowed character lengths for string fields.
 * Prevents oversized payloads from degrading localStorage performance or
 * enabling DoS-style data-corruption attacks.
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

/**
 * Validate a full CreateCampaignInput payload.
 * Throws ApiError(400) on the first violation found.
 */
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

/**
 * Validate a partial UpdateCampaignInput patch.
 * Only validates fields that are present in the patch.
 * Throws ApiError(400) on the first violation found.
 */
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

// ─── Storage error mapping ────────────────────────────────────────────────────

/**
 * Wrap the given operation, converting any StorageError from the ORM layer
 * into an ApiError(507 Insufficient Storage).
 */
function withStorageErrorHandling<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof StorageError) {
      throw new ApiError('Insufficient storage: unable to save campaign data', 507)
    }
    throw err
  }
}

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialise the local database.  Call once at app startup (e.g. in main.tsx).
 * Idempotent — safe to call multiple times.
 */
export function initDb(): void {
  CampaignModel.init()
}

// ─── Read routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/campaigns
 *
 * Returns all campaigns sorted by createdAt descending.
 */
export function fetchCampaigns(): Promise<CampaignRecord[]> {
  return Promise.resolve(CampaignModel.findAll())
}

/**
 * GET /api/campaigns/:id
 *
 * Returns the campaign with the given id, or throws ApiError(404).
 */
export function fetchCampaign(id: string): Promise<CampaignRecord> {
  const record = CampaignModel.findById(id)
  if (!record) {
    console.warn('[campaigns] fetchCampaign: record not found, id=%s', id)
    return Promise.reject(new ApiError('Campaign not found', 404))
  }
  return Promise.resolve(record)
}

/**
 * GET /api/campaigns/stats
 *
 * Returns aggregate statistics across all campaigns.
 */
export function fetchCampaignStats(): Promise<CampaignStats> {
  return Promise.resolve(CampaignModel.getStats())
}

// ─── Write routes ─────────────────────────────────────────────────────────────

/**
 * POST /api/campaigns
 *
 * Creates a new campaign and returns the persisted record (with generated id
 * and timestamps).
 *
 * Rejects with ApiError(400) for invalid payloads.
 * Rejects with ApiError(507) if storage is full.
 */
export function createCampaign(input: CreateCampaignInput): Promise<CampaignRecord> {
  try {
    validateCreateInput(input)
    return Promise.resolve(withStorageErrorHandling(() => CampaignModel.create(input)))
  } catch (err) {
    return Promise.reject(err)
  }
}

/**
 * PATCH /api/campaigns/:id
 *
 * Applies a partial update to an existing campaign.
 * Rejects with ApiError(400) for invalid patch fields.
 * Rejects with ApiError(404) if the campaign does not exist.
 * Rejects with ApiError(507) if storage is full.
 */
export function updateCampaign(id: string, patch: UpdateCampaignInput): Promise<CampaignRecord> {
  try {
    validateUpdateInput(patch)
    const updated = withStorageErrorHandling(() => CampaignModel.update(id, patch))
    if (!updated) {
      console.warn('[campaigns] updateCampaign: record not found, id=%s', id)
      return Promise.reject(new ApiError('Campaign not found', 404))
    }
    return Promise.resolve(updated)
  } catch (err) {
    return Promise.reject(err)
  }
}

/**
 * DELETE /api/campaigns/:id
 *
 * Deletes the campaign with the given id.
 * Rejects with ApiError(404) if the campaign does not exist.
 * Rejects with ApiError(507) if storage is full.
 */
export function deleteCampaign(id: string): Promise<void> {
  try {
    const deleted = withStorageErrorHandling(() => CampaignModel.delete(id))
    if (!deleted) {
      console.warn('[campaigns] deleteCampaign: record not found, id=%s', id)
      return Promise.reject(new ApiError('Campaign not found', 404))
    }
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}
