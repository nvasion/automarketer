/**
 * CampaignModel — localStorage-backed ORM for campaign records.
 *
 * Provides synchronous CRUD operations on top of localStorage.  The API is
 * intentionally free of UI framework coupling so the model can be used in
 * both React components (via the api/ layer) and in unit tests without a
 * DOM renderer.
 *
 * Seeding
 * ───────
 * Demo data is opt-in. `init()` only seeds from `data/sampleData.ts` when
 * the `VITE_SEED_DEMO_DATA` environment variable is set to `"true"`.
 * By default the app starts with an empty store so production deployments
 * never expose placeholder content to real users.
 * Use `CampaignModel.seed()` directly in tests that need a pre-populated store.
 *
 * Error handling
 * ──────────────
 * localStorage quota errors, JSON parse failures, and corrupted records are
 * caught internally; callers receive empty arrays / null values rather than
 * thrown exceptions.  The one exception is `create()` / `update()`, which
 * re-throw on serialisation failure so callers know the write did not persist.
 *
 * Storage & encryption
 * ────────────────────
 * Campaign metadata (name, description, status, etc.) is persisted as plaintext
 * JSON in localStorage.  This is acceptable for non-sensitive data.
 *
 * IMPORTANT: When the schema is extended to include sensitive fields — such as
 * social platform OAuth tokens or third-party API keys — those values MUST be
 * encrypted at rest using the AES-256-GCM utilities in `src/db/encryption.ts`
 * before being written to storage.  Do NOT store raw secrets in localStorage.
 */

import type {
  CampaignRecord,
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignStats,
} from './schema'
import { DB_SCHEMA_VERSION } from './schema'
import type { Platform } from '../types'
import { SAMPLE_CAMPAIGNS } from '../data/sampleData'
import { normalizeSubreddits } from '../utils/subreddits'

// ─── Storage error type ───────────────────────────────────────────────────────

/**
 * Thrown by `writeAll()` when the underlying storage write fails (e.g. quota
 * exceeded or serialisation error).  The API layer catches this and converts
 * it into an `ApiError(507)` for consistent error handling.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const CAMPAIGNS_KEY = 'automarketer_campaigns'
const DB_VERSION_KEY = 'automarketer_db_version'
/**
 * Written to localStorage (value "true") whenever `seed()` populates the store.
 * Read by `init()` to detect and remove demo data when the app is started
 * without `VITE_SEED_DEMO_DATA=true`, ensuring a production deployment never
 * surfaces placeholder content left over from a previous demo run.
 */
const DEMO_SEEDED_KEY = 'automarketer_demo_seeded'

/**
 * Fixed IDs of the built-in sample campaigns.
 * Used as a fallback to detect pre-existing demo data that was seeded before
 * the `DEMO_SEEDED_KEY` mechanism was introduced (i.e. when the flag is absent
 * but the store contains only sample records).
 */
const SAMPLE_IDS: ReadonlySet<string> = new Set(SAMPLE_CAMPAIGNS.map((c) => c.id))

// ─── UUID helper ──────────────────────────────────────────────────────────────

/**
 * Generate a simple collision-resistant ID.
 * Uses `crypto.randomUUID()` when available (all modern browsers), falling
 * back to a Date + random suffix for environments that do not support it
 * (e.g. older jsdom versions in unit tests).
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── Low-level storage helpers ────────────────────────────────────────────────

function readAll(): CampaignRecord[] {
  try {
    const raw = localStorage.getItem(CAMPAIGNS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Filter out any records that do not have the minimum required shape.
    // This guards against corrupted data, stale schema versions, or manual
    // tampering that would otherwise cause downstream property-access errors.
    const valid = parsed.filter(
      (item): item is CampaignRecord =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['id'] === 'string' &&
        typeof (item as Record<string, unknown>)['name'] === 'string'
    )
    if (valid.length !== parsed.length) {
      console.warn(
        '[CampaignModel] readAll: discarded %d malformed record(s)',
        parsed.length - valid.length
      )
    }
    return valid
  } catch {
    return []
  }
}

/**
 * Persist the given records array to localStorage.
 * Throws `StorageError` on quota exceeded or serialisation failure so that the
 * API layer can surface a user-friendly message rather than crashing silently.
 */
function writeAll(records: CampaignRecord[]): void {
  try {
    localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(records))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[CampaignModel] writeAll: storage write failed —', message)
    throw new StorageError(`Failed to persist campaigns: ${message}`)
  }
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

/**
 * Convert a sample-data Campaign (from sampleData.ts) to a CampaignRecord by
 * adding the `updatedAt` field that the schema requires.
 */
function sampleToCampaignRecord(c: (typeof SAMPLE_CAMPAIGNS)[number]): CampaignRecord {
  return {
    id: c.id,
    name: c.name,
    websiteUrl: c.websiteUrl,
    description: c.description,
    status: c.status,
    tone: c.tone,
    targetAudience: c.targetAudience,
    platforms: c.platforms,
    subreddits: c.subreddits,
    screenshots: c.screenshots,
    posts: c.posts,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
  }
}

// ─── Stats computation ──────────────────────────────────────────────────────

/**
 * Compute summary statistics from a list of campaign records.
 *
 * Pure function (no storage access) so it can be reused by both the
 * localStorage-backed `CampaignModel.getStats()` and the server-backed
 * `fetchCampaignStats()` in the API layer.
 *
 * Derives `avgEngagementRate` as total engagements / total views × 100,
 * expressed as a percentage rounded to one decimal place.
 */
export function computeStats(all: CampaignRecord[]): CampaignStats {
  const activeCampaigns = all.filter(
    (c) => c.status === 'ready' || c.status === 'generating'
  ).length

  let totalPostsPublished = 0
  let totalEngagements = 0
  let totalViews = 0
  const engagementsByPlatform: Record<string, number> = {}

  for (const campaign of all) {
    for (const post of campaign.posts) {
      if (post.status === 'published') totalPostsPublished++
      if (post.engagements) {
        const e = post.engagements
        const postEngagements = e.likes + e.comments + e.shares
        totalEngagements += postEngagements
        totalViews += e.views
        engagementsByPlatform[post.platform] =
          (engagementsByPlatform[post.platform] ?? 0) + postEngagements
      }
    }
  }

  const avgEngagementRate =
    totalViews > 0
      ? Math.round((totalEngagements / totalViews) * 1000) / 10
      : 0

  const topPlatform =
    Object.keys(engagementsByPlatform).length > 0
      ? (Object.entries(engagementsByPlatform).sort(([, a], [, b]) => b - a)[0][0] as Platform)
      : null

  return {
    totalCampaigns: all.length,
    activeCampaigns,
    totalPostsPublished,
    totalEngagements,
    avgEngagementRate,
    topPlatform,
  }
}

// ─── ORM class ────────────────────────────────────────────────────────────────

/**
 * Static ORM for campaign records backed by localStorage.
 *
 * All methods are synchronous because localStorage I/O is synchronous.
 * The async wrapper layer in `src/api/campaigns.ts` exposes Promise-based
 * equivalents that mirror the interface a REST backend would provide.
 */
export class CampaignModel {
  // ── Schema migration ─────────────────────────────────────────────────────────

  /**
   * Initialise the database on application startup.
   *
   * - If the stored schema version differs from `DB_SCHEMA_VERSION`, wipes the
   *   store so the app always starts with valid data shapes.
   * - If the app is NOT running in demo mode (i.e. `VITE_SEED_DEMO_DATA` is not
   *   `"true"`), any previously-seeded demo data is removed so that a production
   *   deployment or a fresh non-demo run always starts with an empty store.
   *   Demo data is detected via two mechanisms:
   *     (a) the `automarketer_demo_seeded` flag written by `seed()`, or
   *     (b) all stored records having IDs that match the built-in sample set
   *         (handles stores seeded before the flag was introduced).
   * - If the store is empty AND `VITE_SEED_DEMO_DATA=true`, seeds sample data.
   */
  static init(): void {
    const storedVersion = parseInt(localStorage.getItem(DB_VERSION_KEY) ?? '0', 10)

    if (storedVersion !== DB_SCHEMA_VERSION) {
      // Schema changed — clear stale data and the demo flag together.
      localStorage.removeItem(CAMPAIGNS_KEY)
      localStorage.removeItem(DEMO_SEEDED_KEY)
      localStorage.setItem(DB_VERSION_KEY, String(DB_SCHEMA_VERSION))
    }

    const isDemoMode = import.meta.env.VITE_SEED_DEMO_DATA === 'true'

    if (!isDemoMode) {
      // Remove demo data when the env var is absent or disabled.
      // This handles two cases:
      //   (a) Explicit flag: the store was marked as demo-seeded.
      //   (b) Legacy detection: all stored records match the sample IDs,
      //       meaning demo data was seeded before the flag existed.
      const wasMarkedAsDemo = localStorage.getItem(DEMO_SEEDED_KEY) === 'true'
      const stored = readAll()
      const allAreSampleRecords =
        stored.length > 0 && stored.every((c) => SAMPLE_IDS.has(c.id))

      if (wasMarkedAsDemo || allAreSampleRecords) {
        localStorage.removeItem(CAMPAIGNS_KEY)
        localStorage.removeItem(DEMO_SEEDED_KEY)
      }
    }

    if (readAll().length === 0 && isDemoMode) {
      CampaignModel.seed()
    }
  }

  /**
   * Populate the store with sample campaigns and mark the store as demo-seeded.
   *
   * Not called automatically by `init()` unless `VITE_SEED_DEMO_DATA=true`.
   * Call this directly in tests or scripts that need a pre-populated store.
   *
   * The `automarketer_demo_seeded` flag is set so that `init()` can identify
   * and remove this data when the app is later started without the demo env var.
   */
  static seed(): void {
    const records = SAMPLE_CAMPAIGNS.map(sampleToCampaignRecord)
    writeAll(records)
    localStorage.setItem(DEMO_SEEDED_KEY, 'true')
  }

  // ── Read operations ───────────────────────────────────────────────────────────

  /** Return all campaign records, sorted by createdAt descending. */
  static findAll(): CampaignRecord[] {
    return readAll().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  /** Return the campaign with the given id, or null if not found. */
  static findById(id: string): CampaignRecord | null {
    return readAll().find((c) => c.id === id) ?? null
  }

  /** Return the total number of stored campaigns. */
  static count(): number {
    return readAll().length
  }

  // ── Write operations ──────────────────────────────────────────────────────────

  /**
   * Create a new campaign and persist it.
   * Assigns a generated `id`, `createdAt`, and `updatedAt`.
   */
  static create(input: CreateCampaignInput): CampaignRecord {
    const now = new Date().toISOString()
    const { subreddits, ...rest } = input
    const normalizedSubreddits = normalizeSubreddits(subreddits)
    const record: CampaignRecord = {
      ...rest,
      ...(normalizedSubreddits.length > 0 && { subreddits: normalizedSubreddits }),
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    }
    const all = readAll()
    writeAll([...all, record])
    return record
  }

  /**
   * Patch an existing campaign with the given fields.
   * Always refreshes `updatedAt`.
   * Returns the updated record, or null if no record with that id exists.
   */
  static update(id: string, patch: UpdateCampaignInput): CampaignRecord | null {
    const all = readAll()
    const idx = all.findIndex((c) => c.id === id)
    if (idx === -1) return null

    const { subreddits, ...rest } = patch
    const updated: CampaignRecord = {
      ...all[idx],
      ...rest,
      // Normalize subreddit input when present in the patch; an empty value
      // clears the stored list.
      ...(subreddits !== undefined && { subreddits: normalizeSubreddits(subreddits) }),
      id, // prevent callers from changing the id
      createdAt: all[idx].createdAt, // creation time is immutable
      updatedAt: new Date().toISOString(),
    }

    const next = [...all]
    next[idx] = updated
    writeAll(next)
    return updated
  }

  /**
   * Remove a campaign by id.
   * Returns true if a record was deleted, false if not found.
   */
  static delete(id: string): boolean {
    const all = readAll()
    const filtered = all.filter((c) => c.id !== id)
    if (filtered.length === all.length) return false
    writeAll(filtered)
    return true
  }

  // ── Aggregate queries ─────────────────────────────────────────────────────────

  /**
   * Compute summary statistics across all campaign records.
   *
   * Derives `avgEngagementRate` as total engagements / total views × 100,
   * expressed as a percentage rounded to one decimal place.
   */
  static getStats(): CampaignStats {
    return computeStats(readAll())
  }
}
