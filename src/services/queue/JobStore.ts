import { randomBytes, randomUUID as nodeRandomUUID } from 'node:crypto'
import type { Platform } from '../../types'
import type { JobStatus, ScheduledJob } from './types'

/**
 * Cryptographically secure identifier generator.
 *
 * Resolution order, all of which use a CSPRNG:
 *   1. Web Crypto `globalThis.crypto.randomUUID()` (Node ≥19, modern browsers).
 *   2. Node `crypto.randomUUID()` (Node ≥14.17 / 16.7).
 *   3. Node `crypto.randomBytes()` formatted as an RFC 4122 v4 UUID.
 *
 * The previous Math.random()-based fallback was rejected by security review
 * because predictable IDs would let an attacker enumerate jobs.  Every branch
 * here now relies on the platform CSPRNG, so callers can safely expose ids
 * via APIs without leaking entropy.
 */
export function generateId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (typeof nodeRandomUUID === 'function') return nodeRandomUUID()
  // RFC 4122 v4 UUID synthesised from CSPRNG bytes.
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = bytes.toString('hex')
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  )
}

/**
 * In-memory storage for {@link ScheduledJob} records.
 *
 * The store is intentionally minimal — the queue service holds the only
 * reference and is therefore responsible for locking semantics during a tick.
 * If a persistent backend is needed later, swap in another implementation that
 * conforms to the same public surface.
 */
export class JobStore {
  private readonly jobs = new Map<string, ScheduledJob>()

  /** Insert a new job.  Throws if a job with the same id is already present. */
  add(job: ScheduledJob): void {
    if (this.jobs.has(job.id)) {
      throw new Error(`JobStore: duplicate job id ${job.id}`)
    }
    this.jobs.set(job.id, job)
  }

  /** Retrieve a job by id, or undefined when not found. */
  get(id: string): ScheduledJob | undefined {
    return this.jobs.get(id)
  }

  /**
   * Update an existing job in place using a patch object.
   *
   * Always bumps `updatedAt` to the current ISO timestamp.
   * Throws when the job does not exist.
   */
  update(id: string, patch: Partial<Omit<ScheduledJob, 'id' | 'createdAt'>>): ScheduledJob {
    const existing = this.jobs.get(id)
    if (!existing) throw new Error(`JobStore: job ${id} not found`)
    const updated: ScheduledJob = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    this.jobs.set(id, updated)
    return updated
  }

  /** Remove a job from the store. No-op when the id is unknown. */
  remove(id: string): void {
    this.jobs.delete(id)
  }

  /** Return every job currently stored, in insertion order. */
  all(): ScheduledJob[] {
    return [...this.jobs.values()]
  }

  /** Filter jobs by status. */
  byStatus(status: JobStatus): ScheduledJob[] {
    return this.all().filter((j) => j.status === status)
  }

  /** Filter jobs by platform. */
  byPlatform(platform: Platform): ScheduledJob[] {
    return this.all().filter((j) => j.platform === platform)
  }

  /**
   * Return jobs that are due for processing — i.e. status is `pending`,
   * `ready` or `retrying` and `nextAttemptAt <= now`.
   * Sorted by `nextAttemptAt` ascending so the worker drains oldest first.
   */
  due(now: number = Date.now()): ScheduledJob[] {
    return this.all()
      .filter(
        (j) =>
          (j.status === 'pending' || j.status === 'ready' || j.status === 'retrying') &&
          new Date(j.nextAttemptAt).getTime() <= now
      )
      .sort(
        (a, b) =>
          new Date(a.nextAttemptAt).getTime() - new Date(b.nextAttemptAt).getTime()
      )
  }

  /** Total job count. */
  size(): number {
    return this.jobs.size
  }

  /** Remove every job — primarily for tests. */
  clear(): void {
    this.jobs.clear()
  }
}
