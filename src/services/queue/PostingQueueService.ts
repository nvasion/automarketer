import type { Platform } from '../../types'
import type { SocialConnector } from '../social/SocialConnector'
import type { CredentialProvider } from '../social/types'
import { SocialError } from '../social/types'
import { ExecutionLog } from './ExecutionLog'
import { JobStore, generateId } from './JobStore'
import { RateLimiter } from './RateLimiter'
import type {
  ExecutionLogEntry,
  QueueConfig,
  ScheduleJobInput,
  ScheduledJob,
} from './types'
import { DEFAULT_QUEUE_CONFIG } from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIso(input: string | Date | undefined, fallback: number): string {
  if (input instanceof Date) return input.toISOString()
  if (typeof input === 'string') {
    const parsed = new Date(input)
    if (!isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date(fallback).toISOString()
}

function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Dependencies passed in at construction.
 *
 * `connectors` and `credentials` are partial because the queue may be used
 * with only a subset of platforms.  A job targeting a platform without a
 * registered connector fails fast with a clear error.
 */
export interface PostingQueueDeps {
  connectors: Partial<Record<Platform, SocialConnector>>
  credentials: Partial<Record<Platform, CredentialProvider>>
  rateLimiter?: RateLimiter
  store?: JobStore
  log?: ExecutionLog
  config?: Partial<QueueConfig>
}

/**
 * Orchestrates content scheduling and posting across multiple social platforms.
 *
 * Responsibilities:
 *  - Accept new jobs via {@link schedule}.
 *  - Drain due jobs in {@link tick} — used by {@link start} for periodic runs.
 *  - Honour per-platform rate limits via the {@link RateLimiter}.
 *  - Retry retryable errors with exponential back-off (queue-level on top of
 *    the connector's own HTTP-layer retries).
 *  - Record every attempt to the {@link ExecutionLog}.
 *
 * The service is intentionally pull-based: callers either invoke
 * {@link tick} directly (e.g. from tests or a Cron job) or rely on
 * {@link start}/{@link stop} for an internal polling loop.
 */
export class PostingQueueService {
  readonly store: JobStore
  readonly log: ExecutionLog
  readonly rateLimiter: RateLimiter
  readonly config: QueueConfig

  private readonly connectors: Partial<Record<Platform, SocialConnector>>
  private readonly credentials: Partial<Record<Platform, CredentialProvider>>
  private pollHandle: ReturnType<typeof setInterval> | null = null
  private tickInProgress = false

  constructor(deps: PostingQueueDeps) {
    this.connectors = deps.connectors
    this.credentials = deps.credentials
    this.store = deps.store ?? new JobStore()
    this.log = deps.log ?? new ExecutionLog()
    this.rateLimiter = deps.rateLimiter ?? new RateLimiter()
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...deps.config }
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  /**
   * Schedule a new post.  Returns the persisted {@link ScheduledJob}.
   *
   * The job will not run before `scheduledAt`.  Once `scheduledAt` has passed
   * the worker will pick it up on the next tick.
   */
  schedule(input: ScheduleJobInput): ScheduledJob {
    const now = Date.now()
    const scheduledAtIso = toIso(input.scheduledAt, now)
    const maxAttempts = input.maxAttempts ?? this.config.defaultMaxAttempts
    if (maxAttempts < 1) {
      throw new Error('PostingQueueService.schedule: maxAttempts must be ≥ 1')
    }
    if (!this.connectors[input.platform]) {
      throw new Error(
        `PostingQueueService.schedule: no connector registered for platform "${input.platform}"`
      )
    }
    if (!this.credentials[input.platform]) {
      throw new Error(
        `PostingQueueService.schedule: no credentials registered for platform "${input.platform}"`
      )
    }
    const nowIso = new Date(now).toISOString()
    const job: ScheduledJob = {
      id: generateId(),
      platform: input.platform,
      request: input.request,
      scheduledAt: scheduledAtIso,
      status: 'pending',
      attempts: 0,
      maxAttempts,
      nextAttemptAt: scheduledAtIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    this.store.add(job)
    return job
  }

  /**
   * Mark a pending / retrying job as cancelled.
   *
   * Returns true if the job was cancellable (still pending/ready/retrying),
   * false otherwise (already running, succeeded, failed, or unknown id).
   */
  cancel(jobId: string): boolean {
    const job = this.store.get(jobId)
    if (!job) return false
    if (job.status !== 'pending' && job.status !== 'ready' && job.status !== 'retrying') {
      return false
    }
    this.store.update(jobId, { status: 'cancelled' })
    return true
  }

  // ── Polling loop ───────────────────────────────────────────────────────────

  /** Start the internal poller.  No-op if already running. */
  start(): void {
    if (this.pollHandle) return
    this.pollHandle = setInterval(() => {
      void this.tick()
    }, this.config.pollIntervalMs)
  }

  /** Stop the internal poller.  Safe to call multiple times. */
  stop(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle)
      this.pollHandle = null
    }
  }

  /**
   * Process every due job once.  Returns the execution-log entries created.
   *
   * Re-entrant calls are coalesced — a second invocation while a tick is in
   * progress resolves to an empty array.  This protects the queue from
   * overlapping execution when the poll interval is shorter than the
   * collective HTTP latency of the due jobs.
   */
  async tick(now: number = Date.now()): Promise<ExecutionLogEntry[]> {
    if (this.tickInProgress) return []
    this.tickInProgress = true
    try {
      const due = this.store.due(now)
      const entries: ExecutionLogEntry[] = []
      for (const job of due) {
        const entry = await this.runJob(job, now)
        if (entry) entries.push(entry)
      }
      return entries
    } finally {
      this.tickInProgress = false
    }
  }

  // ── Per-job execution ──────────────────────────────────────────────────────

  private async runJob(job: ScheduledJob, now: number): Promise<ExecutionLogEntry | null> {
    // Rate-limit gate
    if (!this.rateLimiter.canSend(job.platform, now)) {
      const nextAvailable = this.rateLimiter.nextAvailable(job.platform, now)
      const newNextAttempt = new Date(nextAvailable).toISOString()
      this.store.update(job.id, {
        status: 'retrying',
        // Don't increment attempts — the connector was never called.
        nextAttemptAt: maxIso(job.nextAttemptAt, newNextAttempt),
        lastError: 'rate-limit hold',
      })
      return this.log.record({
        jobId: job.id,
        platform: job.platform,
        attempt: job.attempts, // unchanged — no real attempt yet
        outcome: 'rate_limited',
        durationMs: 0,
        errorMessage: `Rate limit reached for ${job.platform}; deferred to ${newNextAttempt}`,
      })
    }

    const connector = this.connectors[job.platform]
    const credentials = this.credentials[job.platform]
    if (!connector || !credentials) {
      // Should be unreachable because schedule() validates registration, but
      // we defend against the dependencies being mutated between scheduling
      // and execution.
      this.store.update(job.id, {
        status: 'failed',
        lastError: `Missing connector or credentials for ${job.platform}`,
      })
      return this.log.record({
        jobId: job.id,
        platform: job.platform,
        attempt: job.attempts + 1,
        outcome: 'failure',
        durationMs: 0,
        errorMessage: `Missing connector or credentials for ${job.platform}`,
      })
    }

    // Mark running and record the send against the rate limiter up front so
    // concurrent ticks do not over-spend the budget.
    const attemptNumber = job.attempts + 1
    this.store.update(job.id, { status: 'running', attempts: attemptNumber })
    this.rateLimiter.recordSend(job.platform, now)

    const startedAt = Date.now()
    try {
      const result = await connector.post(job.request, credentials)
      const durationMs = Date.now() - startedAt
      this.store.update(job.id, { status: 'succeeded', result, lastError: undefined })
      return this.log.record({
        jobId: job.id,
        platform: job.platform,
        attempt: attemptNumber,
        outcome: 'success',
        result,
        durationMs,
      })
    } catch (err) {
      const durationMs = Date.now() - startedAt
      const isSocialError = err instanceof SocialError
      const retryable = isSocialError ? err.retryable : false
      const message = err instanceof Error ? err.message : String(err)
      const httpStatus = isSocialError ? err.httpStatus : undefined

      const exhausted = attemptNumber >= job.maxAttempts
      if (retryable && !exhausted) {
        const backoff = this.backoffMs(attemptNumber)
        this.store.update(job.id, {
          status: 'retrying',
          nextAttemptAt: new Date(now + backoff).toISOString(),
          lastError: message,
        })
        return this.log.record({
          jobId: job.id,
          platform: job.platform,
          attempt: attemptNumber,
          outcome: 'retry',
          durationMs,
          errorMessage: message,
          httpStatus,
        })
      }

      // Either non-retryable or retries exhausted.
      this.store.update(job.id, { status: 'failed', lastError: message })
      return this.log.record({
        jobId: job.id,
        platform: job.platform,
        attempt: attemptNumber,
        outcome: 'failure',
        durationMs,
        errorMessage: message,
        httpStatus,
      })
    }
  }

  /**
   * Compute the back-off (ms) to apply after the `attemptNumber`-th failure.
   *
   * attemptNumber=1 → initialDelay
   * attemptNumber=2 → initialDelay * multiplier
   * …capped at retryMaxDelayMs.
   */
  backoffMs(attemptNumber: number): number {
    const safeAttempt = Math.max(1, attemptNumber)
    const raw =
      this.config.retryInitialDelayMs *
      Math.pow(this.config.retryBackoffMultiplier, safeAttempt - 1)
    return Math.min(raw, this.config.retryMaxDelayMs)
  }
}
