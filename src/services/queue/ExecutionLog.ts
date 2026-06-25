import type { Platform } from '../../types'
import type { ExecutionLogEntry, ExecutionOutcome } from './types'
import type { SocialPostResult } from '../social/types'
import { generateId } from './JobStore'
import { sanitizeErrorMessage } from './sanitize'

/**
 * Append-only log of every attempt the queue worker makes against a connector.
 *
 * Stored entirely in memory.  Each entry records:
 *  - which job and platform was processed,
 *  - which attempt number it was,
 *  - the outcome (success / retry / failure / rate_limited),
 *  - timing,
 *  - the error message and HTTP status when applicable.
 *
 * **Security note:** error messages received from upstream APIs are passed
 * through {@link sanitizeErrorMessage} before being stored.  This:
 *  - strips HTML / script tags so the log is safe to render in a UI without
 *    additional escaping (prevents XSS via maliciously crafted upstream error
 *    bodies),
 *  - redacts common secret patterns (bearer tokens, JWTs, api_key/password
 *    parameters, URL-embedded credentials) so leaking the log does not leak
 *    access tokens, and
 *  - truncates excessively long messages to bound storage.
 *
 * The log gives operators an audit trail for debugging delivery problems and
 * is the primary surface area for the success-criteria metric "execution
 * status logging".
 */
export class ExecutionLog {
  private readonly entries: ExecutionLogEntry[] = []

  /**
   * Append a new entry to the log and return it.
   *
   * The entry's id and timestamp are generated here so callers cannot forge
   * conflicting timestamps.  Error messages are sanitized — see the class
   * docstring for what that involves.
   */
  record(input: {
    jobId: string
    platform: Platform
    attempt: number
    outcome: ExecutionOutcome
    durationMs: number
    result?: SocialPostResult
    errorMessage?: string
    httpStatus?: number
  }): ExecutionLogEntry {
    const entry: ExecutionLogEntry = {
      id: generateId(),
      jobId: input.jobId,
      platform: input.platform,
      attempt: input.attempt,
      outcome: input.outcome,
      durationMs: input.durationMs,
      result: input.result,
      errorMessage: sanitizeErrorMessage(input.errorMessage),
      httpStatus: input.httpStatus,
      timestamp: new Date().toISOString(),
    }
    this.entries.push(entry)
    return entry
  }

  /** Return every entry recorded so far in insertion order. */
  all(): ExecutionLogEntry[] {
    return [...this.entries]
  }

  /** Filter entries by job id. */
  forJob(jobId: string): ExecutionLogEntry[] {
    return this.entries.filter((e) => e.jobId === jobId)
  }

  /** Filter entries by platform. */
  forPlatform(platform: Platform): ExecutionLogEntry[] {
    return this.entries.filter((e) => e.platform === platform)
  }

  /** Filter entries by outcome. */
  byOutcome(outcome: ExecutionOutcome): ExecutionLogEntry[] {
    return this.entries.filter((e) => e.outcome === outcome)
  }

  /** Total entry count. */
  size(): number {
    return this.entries.length
  }

  /** Remove every entry — primarily for tests. */
  clear(): void {
    this.entries.length = 0
  }
}
