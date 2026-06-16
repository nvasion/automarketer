/**
 * Content scheduling and posting queue service.
 *
 * Public surface area:
 *  - {@link PostingQueueService} — schedule and execute posts across platforms.
 *  - {@link JobStore}            — in-memory store for ScheduledJob records.
 *  - {@link RateLimiter}         — sliding-window per-platform rate limiter.
 *  - {@link ExecutionLog}        — append-only audit trail of every attempt.
 *
 * Types: ScheduledJob, JobStatus, ScheduleJobInput, ExecutionLogEntry,
 * ExecutionOutcome, QueueConfig, RateLimitConfig.
 *
 * Defaults: DEFAULT_QUEUE_CONFIG, DEFAULT_RATE_LIMITS.
 */

export { PostingQueueService } from './PostingQueueService'
export type { PostingQueueDeps } from './PostingQueueService'
export { JobStore, generateId } from './JobStore'
export { RateLimiter } from './RateLimiter'
export { ExecutionLog } from './ExecutionLog'
export {
  sanitizeErrorMessage,
  MAX_ERROR_MESSAGE_LENGTH,
  REDACTED_PLACEHOLDER,
} from './sanitize'

export type {
  JobStatus,
  ScheduledJob,
  ScheduleJobInput,
  ExecutionLogEntry,
  ExecutionOutcome,
  QueueConfig,
  RateLimitConfig,
} from './types'

export { DEFAULT_QUEUE_CONFIG, DEFAULT_RATE_LIMITS } from './types'
