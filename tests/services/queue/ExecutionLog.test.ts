import { describe, it, expect } from 'vitest'
import { ExecutionLog } from '../../../src/services/queue/ExecutionLog'

describe('ExecutionLog', () => {
  it('records and returns entries in insertion order', () => {
    const log = new ExecutionLog()
    log.record({
      jobId: 'job-1',
      platform: 'twitter',
      attempt: 1,
      outcome: 'success',
      durationMs: 25,
      result: { success: true, platform: 'twitter', postId: 'tw-1' },
    })
    log.record({
      jobId: 'job-2',
      platform: 'linkedin',
      attempt: 1,
      outcome: 'failure',
      durationMs: 12,
      errorMessage: 'boom',
      httpStatus: 500,
    })
    const all = log.all()
    expect(all).toHaveLength(2)
    expect(all[0].jobId).toBe('job-1')
    expect(all[1].jobId).toBe('job-2')
  })

  it('assigns an id and a timestamp on each record', () => {
    const log = new ExecutionLog()
    const entry = log.record({
      jobId: 'job-1',
      platform: 'twitter',
      attempt: 1,
      outcome: 'success',
      durationMs: 5,
    })
    expect(entry.id).toBeTruthy()
    expect(entry.timestamp).toBeTruthy()
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow()
  })

  it('filters by jobId, platform, and outcome', () => {
    const log = new ExecutionLog()
    log.record({ jobId: 'a', platform: 'twitter', attempt: 1, outcome: 'success', durationMs: 1 })
    log.record({ jobId: 'a', platform: 'twitter', attempt: 2, outcome: 'retry', durationMs: 1 })
    log.record({ jobId: 'b', platform: 'linkedin', attempt: 1, outcome: 'failure', durationMs: 1 })
    log.record({ jobId: 'c', platform: 'twitter', attempt: 1, outcome: 'rate_limited', durationMs: 0 })

    expect(log.forJob('a')).toHaveLength(2)
    expect(log.forPlatform('linkedin').map((e) => e.jobId)).toEqual(['b'])
    expect(log.byOutcome('success').map((e) => e.jobId)).toEqual(['a'])
    expect(log.byOutcome('rate_limited')).toHaveLength(1)
  })

  it('size() reflects the number of recorded entries', () => {
    const log = new ExecutionLog()
    expect(log.size()).toBe(0)
    log.record({ jobId: 'a', platform: 'twitter', attempt: 1, outcome: 'success', durationMs: 1 })
    expect(log.size()).toBe(1)
  })

  it('clear() empties the log', () => {
    const log = new ExecutionLog()
    log.record({ jobId: 'a', platform: 'twitter', attempt: 1, outcome: 'success', durationMs: 1 })
    log.clear()
    expect(log.size()).toBe(0)
  })

  it('all() returns a copy — mutating it does not modify the log', () => {
    const log = new ExecutionLog()
    log.record({ jobId: 'a', platform: 'twitter', attempt: 1, outcome: 'success', durationMs: 1 })
    const copy = log.all()
    copy.pop()
    expect(log.size()).toBe(1)
  })

  describe('error message hardening', () => {
    it('strips HTML/script tags from errorMessage before storing (XSS safety)', () => {
      const log = new ExecutionLog()
      const entry = log.record({
        jobId: 'job-x',
        platform: 'twitter',
        attempt: 1,
        outcome: 'failure',
        durationMs: 5,
        errorMessage: 'API error: <script>alert(1)</script> bad request',
      })
      expect(entry.errorMessage).not.toContain('<script')
      expect(entry.errorMessage).not.toContain('alert(1)')
      expect(entry.errorMessage).toContain('API error')
      expect(entry.errorMessage).toContain('bad request')
    })

    it('redacts bearer tokens and api keys from errorMessage (secret leakage)', () => {
      const log = new ExecutionLog()
      const entry = log.record({
        jobId: 'job-y',
        platform: 'linkedin',
        attempt: 1,
        outcome: 'failure',
        durationMs: 5,
        errorMessage:
          'Auth failed: Bearer abcdef1234567890 (api_key=sk_live_supersecret)',
      })
      expect(entry.errorMessage).not.toContain('abcdef1234567890')
      expect(entry.errorMessage).not.toContain('sk_live_supersecret')
      expect(entry.errorMessage).toContain('[REDACTED]')
    })

    it('truncates excessively long errorMessage strings', () => {
      const log = new ExecutionLog()
      const entry = log.record({
        jobId: 'job-z',
        platform: 'twitter',
        attempt: 1,
        outcome: 'failure',
        durationMs: 5,
        errorMessage: 'X'.repeat(10_000),
      })
      // Bounded to the sanitizer's max length (500); we accept ≤ to keep this
      // test resilient to future tightening of the bound.
      expect(entry.errorMessage!.length).toBeLessThanOrEqual(500)
    })

    it('preserves undefined errorMessage', () => {
      const log = new ExecutionLog()
      const entry = log.record({
        jobId: 'job-q',
        platform: 'twitter',
        attempt: 1,
        outcome: 'success',
        durationMs: 1,
      })
      expect(entry.errorMessage).toBeUndefined()
    })
  })
})
