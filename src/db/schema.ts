/**
 * Database schema for AutoMarketer.
 *
 * This module defines the database-layer types that extend the core domain
 * types with persistence metadata (timestamps, soft-delete flags, etc.).
 *
 * Table layout
 * ────────────
 *
 *   campaigns            One row per marketing campaign.
 *   ├─ id                UUID primary key.
 *   ├─ name              Human-readable campaign name.
 *   ├─ websiteUrl        Target website / product URL.
 *   ├─ description       Brief product / service description.
 *   ├─ status            Lifecycle status: draft | generating | ready | published.
 *   ├─ tone              Writing style: professional | casual | excited | informative.
 *   ├─ targetAudience    Intended audience description.
 *   ├─ platforms         Array of target social platform IDs.
 *   ├─ screenshots       Array of uploaded screenshot metadata.
 *   ├─ posts             Array of generated post drafts.
 *   ├─ createdAt         ISO-8601 creation timestamp.
 *   └─ updatedAt         ISO-8601 last-modified timestamp.
 *
 *   posts  (embedded in campaigns.posts)
 *   ├─ id                UUID primary key (scoped to parent campaign).
 *   ├─ platform          Target social platform.
 *   ├─ content           Post body text.
 *   ├─ hashtags          Array of hashtag strings.
 *   ├─ status            Post lifecycle: draft | scheduled | published | failed.
 *   ├─ scheduledAt?      ISO-8601 scheduled publish time (nullable).
 *   ├─ publishedAt?      ISO-8601 actual publish time (nullable).
 *   └─ engagements?      Optional engagement counters.
 *
 *   screenshots  (embedded in campaigns.screenshots)
 *   ├─ id                UUID primary key.
 *   ├─ name              Original filename.
 *   ├─ url               Blob URL or remote URL.
 *   └─ type              MIME type (e.g. "image/png").
 *
 * Persistence
 * ───────────
 * The application currently uses localStorage as a lightweight in-process
 * database.  The CampaignModel ORM layer provides the read/write API so that
 * a future migration to IndexedDB or a remote REST backend requires only
 * changes inside `src/db/` — all pages and hooks remain unchanged.
 *
 * Storage keys
 *   automarketer_campaigns   JSON-serialised CampaignRecord[].
 *   automarketer_db_version  Schema version integer (used for migrations).
 */

import type { Platform, Tone, PostStatus, CampaignStatus } from '../types'

// ─── Embedded record types ────────────────────────────────────────────────────

/** Engagement counters for a published post. */
export interface EngagementsRecord {
  likes: number
  comments: number
  shares: number
  views: number
}

/** Screenshot metadata embedded in a campaign record. */
export interface ScreenshotRecord {
  id: string
  name: string
  url: string
  type: string
}

/** A generated social media post draft embedded in a campaign record. */
export interface PostRecord {
  id: string
  platform: Platform
  content: string
  hashtags: string[]
  status: PostStatus
  scheduledAt?: string
  publishedAt?: string
  engagements?: EngagementsRecord
}

// ─── Top-level record type ────────────────────────────────────────────────────

/**
 * A campaign as stored in the database.
 *
 * Adds `updatedAt` to the core Campaign domain type so the ORM can track
 * last-modified time without coupling the UI types to persistence concerns.
 */
export interface CampaignRecord {
  /** UUID primary key. */
  id: string
  name: string
  websiteUrl: string
  description: string
  status: CampaignStatus
  tone: Tone
  targetAudience: string
  /** Array of platform IDs this campaign targets. */
  platforms: Platform[]
  screenshots: ScreenshotRecord[]
  posts: PostRecord[]
  /** ISO-8601 timestamp — set on creation, never modified. */
  createdAt: string
  /** ISO-8601 timestamp — updated on every write. */
  updatedAt: string
}

// ─── Input types for ORM operations ──────────────────────────────────────────

/** Fields required to create a new campaign. */
export type CreateCampaignInput = Omit<CampaignRecord, 'id' | 'createdAt' | 'updatedAt'>

/** Fields that may be patched on an existing campaign. */
export type UpdateCampaignInput = Partial<Omit<CampaignRecord, 'id' | 'createdAt'>>

// ─── Aggregate types ──────────────────────────────────────────────────────────

/** Summary statistics derived from all campaign records. */
export interface CampaignStats {
  totalCampaigns: number
  activeCampaigns: number
  totalPostsPublished: number
  totalEngagements: number
  avgEngagementRate: number
  topPlatform: Platform | null
}

// ─── Schema version ───────────────────────────────────────────────────────────

/**
 * Increment this constant whenever a breaking change is made to CampaignRecord.
 * The migration runner in `CampaignModel` checks this version and re-seeds
 * sample data when the stored version is older.
 */
export const DB_SCHEMA_VERSION = 1
