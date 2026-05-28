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
 * On first use (empty store) the model automatically seeds from the sample
 * data in `data/sampleData.ts`.  This mirrors a real database migration that
 * populates reference / demo data, and ensures the UI is not blank on a
 * fresh install.
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
    screenshots: c.screenshots,
    posts: c.posts,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
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
   *   store and re-seeds so the app always starts with valid data shapes.
   * - If the store is empty, seeds sample data (first-run experience).
   */
  static init(): void {
    const storedVersion = parseInt(localStorage.getItem(DB_VERSION_KEY) ?? '0', 10)

    if (storedVersion !== DB_SCHEMA_VERSION) {
      // Schema changed — clear and re-seed
      localStorage.removeItem(CAMPAIGNS_KEY)
      localStorage.setItem(DB_VERSION_KEY, String(DB_SCHEMA_VERSION))
    }

    if (readAll().length === 0) {
      CampaignModel.seed()
    }
  }

  /**
   * Populate the store with sample campaigns.
   * Called automatically by `init()` on first use; can also be called
   * directly in tests to reset state.
   */
  static seed(): void {
    const records = SAMPLE_CAMPAIGNS.map(sampleToCampaignRecord)
    writeAll(records)
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
    const record: CampaignRecord = {
      ...input,
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

    const updated: CampaignRecord = {
      ...all[idx],
      ...patch,
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
    const all = readAll()

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
}
