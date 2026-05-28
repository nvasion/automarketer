import type { Platform } from '../../types'
import type { RateLimitConfig } from './types'
import { DEFAULT_RATE_LIMITS } from './types'

/**
 * Per-platform sliding-window rate limiter.
 *
 * Used by {@link PostingQueueService} to defer jobs when their target platform
 * has reached the configured request ceiling.  The implementation is
 * intentionally simple and synchronous — it does not perform any I/O and is
 * safe to call frequently from the queue worker.
 *
 * The limiter tracks request timestamps in a per-platform array; entries older
 * than the window are pruned on every call so memory does not grow unboundedly.
 */
export class RateLimiter {
  private readonly configs: Record<Platform, RateLimitConfig>
  private readonly hits: Record<Platform, number[]> = {
    linkedin: [],
    twitter: [],
    reddit: [],
    facebook: [],
    instagram: [],
  }

  constructor(configs: Partial<Record<Platform, RateLimitConfig>> = {}) {
    this.configs = { ...DEFAULT_RATE_LIMITS, ...configs }
  }

  /**
   * Return true if `platform` can accept another request immediately.
   *
   * Always returns true when the platform has no rate-limit configuration.
   */
  canSend(platform: Platform, now: number = Date.now()): boolean {
    const config = this.configs[platform]
    if (!config) return true
    this.prune(platform, now)
    return this.hits[platform].length < config.maxRequests
  }

  /**
   * Record that a request was sent to `platform` at `now`.
   * Use after a successful (or failure-counted) call to a connector.
   */
  recordSend(platform: Platform, now: number = Date.now()): void {
    this.hits[platform].push(now)
  }

  /**
   * Return the earliest timestamp (ms epoch) at which the next request to
   * `platform` will be allowed.  Returns `now` when the limiter is not
   * currently saturated.
   */
  nextAvailable(platform: Platform, now: number = Date.now()): number {
    const config = this.configs[platform]
    if (!config) return now
    this.prune(platform, now)
    const recent = this.hits[platform]
    if (recent.length < config.maxRequests) return now
    // The earliest hit in the window is what's blocking us — once it expires,
    // we get capacity back.
    return recent[0] + config.windowMs
  }

  /**
   * Return the number of requests currently counted within the window for the
   * given platform.  Primarily exposed for tests and diagnostics.
   */
  currentUsage(platform: Platform, now: number = Date.now()): number {
    this.prune(platform, now)
    return this.hits[platform].length
  }

  /** Reset counters for all platforms.  Primarily for testing. */
  reset(): void {
    for (const platform of Object.keys(this.hits) as Platform[]) {
      this.hits[platform] = []
    }
  }

  // Drop hits that have rolled out of the sliding window.
  private prune(platform: Platform, now: number): void {
    const config = this.configs[platform]
    if (!config) return
    const cutoff = now - config.windowMs
    const arr = this.hits[platform]
    while (arr.length > 0 && arr[0] <= cutoff) arr.shift()
  }
}
