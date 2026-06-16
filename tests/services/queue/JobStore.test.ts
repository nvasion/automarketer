import { describe, it, expect } from 'vitest'
import { JobStore, generateId } from '../../../src/services/queue/JobStore'
import type { ScheduledJob } from '../../../src/services/queue/types'

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const now = new Date().toISOString()
  return {
    id: overrides.id ?? generateId(),
    platform: 'twitter',
    request: { content: 'Hello world' },
    scheduledAt: now,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('generateId()', () => {
  it('returns a unique-looking string', () => {
    const a = generateId()
    const b = generateId()
    expect(a).toMatch(/[a-f0-9-]/i)
    expect(a).not.toBe(b)
  })

  it('returns an RFC 4122 v4 UUID (version + variant nibbles correct)', () => {
    const id = generateId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('produces no collisions across a 1k-sample batch (CSPRNG quality)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1_000; i++) seen.add(generateId())
    expect(seen.size).toBe(1_000)
  })
})

describe('JobStore', () => {
  it('adds and retrieves jobs by id', () => {
    const store = new JobStore()
    const job = makeJob()
    store.add(job)
    expect(store.get(job.id)).toEqual(job)
  })

  it('throws when adding a duplicate id', () => {
    const store = new JobStore()
    const job = makeJob({ id: 'fixed-id' })
    store.add(job)
    expect(() => store.add(makeJob({ id: 'fixed-id' }))).toThrow(/duplicate/i)
  })

  it('updates an existing job and bumps updatedAt', async () => {
    const store = new JobStore()
    const job = makeJob({ updatedAt: '2020-01-01T00:00:00.000Z' })
    store.add(job)
    // Ensure a clock tick before updating so the timestamp changes
    await new Promise((r) => setTimeout(r, 10))
    const updated = store.update(job.id, { status: 'succeeded', attempts: 1 })
    expect(updated.status).toBe('succeeded')
    expect(updated.attempts).toBe(1)
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(job.updatedAt).getTime()
    )
  })

  it('throws when updating a non-existent job', () => {
    const store = new JobStore()
    expect(() => store.update('missing', { status: 'failed' })).toThrow(/not found/)
  })

  it('removes jobs', () => {
    const store = new JobStore()
    const job = makeJob()
    store.add(job)
    store.remove(job.id)
    expect(store.get(job.id)).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  it('filters by status, platform, and dueness', () => {
    const store = new JobStore()
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    const dueJob = makeJob({ id: 'a', status: 'pending', nextAttemptAt: past, platform: 'twitter' })
    const futureJob = makeJob({ id: 'b', status: 'pending', nextAttemptAt: future, platform: 'twitter' })
    const finishedJob = makeJob({ id: 'c', status: 'succeeded', nextAttemptAt: past, platform: 'linkedin' })
    store.add(dueJob)
    store.add(futureJob)
    store.add(finishedJob)

    expect(store.byStatus('pending').map((j) => j.id).sort()).toEqual(['a', 'b'])
    expect(store.byPlatform('linkedin').map((j) => j.id)).toEqual(['c'])
    const due = store.due()
    expect(due.map((j) => j.id)).toEqual(['a'])
  })

  it('due() sorts by nextAttemptAt ascending', () => {
    const store = new JobStore()
    const t0 = Date.now() - 10_000
    store.add(makeJob({ id: 'late', nextAttemptAt: new Date(t0 + 1_000).toISOString() }))
    store.add(makeJob({ id: 'early', nextAttemptAt: new Date(t0).toISOString() }))
    const due = store.due()
    expect(due.map((j) => j.id)).toEqual(['early', 'late'])
  })

  it('due() returns retrying jobs whose nextAttemptAt is in the past', () => {
    const store = new JobStore()
    const past = new Date(Date.now() - 60_000).toISOString()
    store.add(makeJob({ id: 'r', status: 'retrying', nextAttemptAt: past }))
    expect(store.due().map((j) => j.id)).toEqual(['r'])
  })

  it('due() ignores cancelled / succeeded / failed jobs', () => {
    const store = new JobStore()
    const past = new Date(Date.now() - 60_000).toISOString()
    store.add(makeJob({ id: '1', status: 'cancelled', nextAttemptAt: past }))
    store.add(makeJob({ id: '2', status: 'succeeded', nextAttemptAt: past }))
    store.add(makeJob({ id: '3', status: 'failed', nextAttemptAt: past }))
    expect(store.due()).toHaveLength(0)
  })

  it('clear() removes all jobs', () => {
    const store = new JobStore()
    store.add(makeJob())
    store.add(makeJob())
    store.clear()
    expect(store.size()).toBe(0)
  })
})
