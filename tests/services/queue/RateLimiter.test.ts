import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../../../src/services/queue/RateLimiter'

describe('RateLimiter', () => {
  it('allows requests up to the configured maximum', () => {
    const limiter = new RateLimiter({
      twitter: { maxRequests: 3, windowMs: 60_000 },
    })
    const now = 1_000_000
    expect(limiter.canSend('twitter', now)).toBe(true)
    limiter.recordSend('twitter', now)
    limiter.recordSend('twitter', now)
    limiter.recordSend('twitter', now)
    expect(limiter.canSend('twitter', now)).toBe(false)
  })

  it('reports next-available time when saturated', () => {
    const limiter = new RateLimiter({
      twitter: { maxRequests: 2, windowMs: 60_000 },
    })
    const now = 1_000_000
    limiter.recordSend('twitter', now)
    limiter.recordSend('twitter', now + 1_000)
    expect(limiter.canSend('twitter', now + 1_000)).toBe(false)
    // First hit was at `now`; next available = now + 60_000
    expect(limiter.nextAvailable('twitter', now + 1_000)).toBe(now + 60_000)
  })

  it('prunes hits older than the window so capacity is restored', () => {
    const limiter = new RateLimiter({
      twitter: { maxRequests: 1, windowMs: 1_000 },
    })
    const now = 1_000_000
    limiter.recordSend('twitter', now)
    expect(limiter.canSend('twitter', now)).toBe(false)
    // After window elapses, hit is pruned
    expect(limiter.canSend('twitter', now + 1_001)).toBe(true)
  })

  it('tracks distinct counters per platform', () => {
    const limiter = new RateLimiter({
      twitter: { maxRequests: 1, windowMs: 60_000 },
      reddit: { maxRequests: 1, windowMs: 60_000 },
    })
    const now = 1_000_000
    limiter.recordSend('twitter', now)
    expect(limiter.canSend('twitter', now)).toBe(false)
    expect(limiter.canSend('reddit', now)).toBe(true)
  })

  it('nextAvailable returns now when not saturated', () => {
    const limiter = new RateLimiter({
      twitter: { maxRequests: 5, windowMs: 60_000 },
    })
    const now = 1_000_000
    expect(limiter.nextAvailable('twitter', now)).toBe(now)
  })

  it('reset() clears every counter', () => {
    const limiter = new RateLimiter({
      twitter: { maxRequests: 1, windowMs: 60_000 },
    })
    const now = 1_000_000
    limiter.recordSend('twitter', now)
    expect(limiter.canSend('twitter', now)).toBe(false)
    limiter.reset()
    expect(limiter.canSend('twitter', now)).toBe(true)
  })

  it('currentUsage reflects active hits within the window', () => {
    const limiter = new RateLimiter({
      twitter: { maxRequests: 5, windowMs: 1_000 },
    })
    const now = 1_000_000
    limiter.recordSend('twitter', now)
    limiter.recordSend('twitter', now + 100)
    expect(limiter.currentUsage('twitter', now + 100)).toBe(2)
    // After the window, both pruned
    expect(limiter.currentUsage('twitter', now + 2_000)).toBe(0)
  })

  it('uses default rate-limit config for platforms when no override given', () => {
    const limiter = new RateLimiter()
    // twitter default is 17 / 24h — should accept at least the first request
    expect(limiter.canSend('twitter', 1_000_000)).toBe(true)
  })
})
