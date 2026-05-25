import type { Platform } from '../../types'
import type {
  SocialPostRequest,
  SocialPostResult,
} from '../social/types'

/**
 * Core types for the content scheduling and posting queue service.
 *
 * The queue is the orchestration layer that ties together scheduling,
 * platform-specific posting, rate-limit compliance, retry/back-off and
 * execution-status logging.
 */

// ─── Job lifecycle ────────────────────────────────────────────────────────────

/** State of a scheduled posting job. */
export type JobStatus =
  /** Created but not yet due, or waiting for the worker to pick it up. */
  | 'pending'
  /** Due (or earlier) and waiting for the next worker tick. */
  | 'ready'
  /** Currently being processed by the worker. */
  | 'running'
  /** Failed but eligible for retry — will be retried after `nextAttemptAt`. */
  | 'retrying'
  /** Successfully published to the platform. */
  | 'succeeded'
  /** Permanently failed — retries exhausted or non-retryable error. */
  | 'failed'
  /** Cancelled by the caller before completion. */
  | 'cancelled'

// ─── Job model ────────────────────────────────────────────────────────────────

/** Payload for a single scheduled post. */
export interface ScheduledJob {
  /** Stable identifier (UUID-shaped string). */
  readonly id: string
  /** Platform the post will be published to. */
  readonly platform: Platform
  /** Post request payload — passed verbatim to the connector. */
  readonly request: SocialPostRequest
  /** Earliest time the worker should attempt the job (ISO 8601). */
  scheduledAt: string
  /** Current status. */
  status: JobStatus
  /** Number of attempts already made. */
  attempts: number
  /**
   * Maximum number of attempts allowed before marking the job `failed`.
   * Includes the initial attempt — so `maxAttempts: 3` means 1 try + 2 retries.
   */
  readonly maxAttempts: number
  /** Earliest time the next attempt should run (ISO 8601). */
  nextAttemptAt: string
  /** Most recent error message, if any. */
  lastError?: string
  /** Result returned by the connector on success. */
  result?: SocialPostResult
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string
  /** Last-modified timestamp (ISO 8601). */
  updatedAt: string
}

/** Input for {@link PostingQueueService.schedule}. */
export interface ScheduleJobInput {
  platform: Platform
  request: SocialPostRequest
  /**
   * Earliest time at which the worker should run this job.
   * Pass an ISO 8601 string or a Date. Defaults to "now" for immediate posting.
   */
  scheduledAt?: string | Date
  /**
   * Override the queue-level default max attempts.
   * Must be ≥ 1.
   */
  maxAttempts?: number
}

// ─── Execution log ────────────────────────────────────────────────────────────

/** Outcome category for an execution-log entry. */
export type ExecutionOutcome =
  /** Connector returned a successful post result. */
  | 'success'
  /** Connector threw a retryable error — job re-queued. */
  | 'retry'
  /** Connector threw a non-retryable error or retries exhausted. */
  | 'failure'
  /** Job was skipped this tick because of a rate-limit hold. */
  | 'rate_limited'

/** A single record of an attempted job execution. */
export interface ExecutionLogEntry {
  readonly id: string
  readonly jobId: string
  readonly platform: Platform
  /** Attempt number (1-indexed) that produced this log entry. */
  readonly attempt: number
  readonly outcome: ExecutionOutcome
  /** Result if outcome === 'success'. */
  readonly result?: SocialPostResult
  /** Error message captured when outcome is 'retry' or 'failure'. */
  readonly errorMessage?: string
  /** HTTP status code, when the error originated from a platform API. */
  readonly httpStatus?: number
  /** Duration of the attempt in milliseconds. */
  readonly durationMs: number
  readonly timestamp: string
}

// ─── Queue configuration ──────────────────────────────────────────────────────

/** Tunable parameters for the queue worker. */
export interface QueueConfig {
  /** How often the worker checks for due jobs, in milliseconds. */
  pollIntervalMs: number
  /**
   * Default maximum attempts for jobs that do not override it via
   * {@link ScheduleJobInput.maxAttempts}.
   */
  defaultMaxAttempts: number
  /** Initial back-off delay in ms when a job fails with a retryable error. */
  retryInitialDelayMs: number
  /** Multiplier applied to the back-off after each subsequent failure. */
  retryBackoffMultiplier: number
  /** Maximum back-off delay between retries, in milliseconds. */
  retryMaxDelayMs: number
}

/** Default queue configuration. */
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  pollIntervalMs: 1_000,
  defaultMaxAttempts: 3,
  retryInitialDelayMs: 1_000,
  retryBackoffMultiplier: 2,
  retryMaxDelayMs: 60_000,
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

/** Configuration for a single platform's rate-limit bucket. */
export interface RateLimitConfig {
  /** Maximum number of posts allowed within `windowMs`. */
  maxRequests: number
  /** Sliding-window size in milliseconds. */
  windowMs: number
}

/**
 * Default rate-limit configuration per platform.
 *
 * These figures are conservative reads of the public documentation — adjust
 * as needed for production credentials.
 *
 * Sources:
 *  - LinkedIn:  ~150 posts/24h for personal accounts (community management API).
 *  - Twitter/X: 17 tweets / 24h for free tier; 300 / 3 h for premium app.
 *               We use the free-tier ceiling as a safe default.
 *  - Reddit:    ~1 submission per 10 min from any single account.
 *  - Facebook:  ~200 posts per page per hour (Graph API).
 *  - Instagram: 25 media publishes per IG user account per 24 h.
 */
export const DEFAULT_RATE_LIMITS: Record<Platform, RateLimitConfig> = {
  linkedin: { maxRequests: 150, windowMs: 24 * 60 * 60 * 1_000 },
  twitter: { maxRequests: 17, windowMs: 24 * 60 * 60 * 1_000 },
  reddit: { maxRequests: 1, windowMs: 10 * 60 * 1_000 },
  facebook: { maxRequests: 200, windowMs: 60 * 60 * 1_000 },
  instagram: { maxRequests: 25, windowMs: 24 * 60 * 60 * 1_000 },
}
