// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostingQueueService } from '../../../src/services/queue/PostingQueueService'
import { JobStore } from '../../../src/services/queue/JobStore'
import { ExecutionLog } from '../../../src/services/queue/ExecutionLog'
import { RateLimiter } from '../../../src/services/queue/RateLimiter'
import type { SocialConnector } from '../../../src/services/social/SocialConnector'
import { SocialError, StaticCredentialProvider } from '../../../src/services/social/types'
import type {
  SocialPostRequest,
  SocialPostResult,
} from '../../../src/services/social/types'
import type { Platform } from '../../../src/types'

// ─── Stub connector helpers ───────────────────────────────────────────────────

interface StubConfig {
  platform: Platform
  charLimit: number
  /**
   * If `post()` is called, this is the implementation.  Defaults to a
   * success-returning function.
   */
  postImpl?: (request: SocialPostRequest) => Promise<SocialPostResult>
}

function makeConnector(cfg: StubConfig): SocialConnector & { postSpy: ReturnType<typeof vi.fn> } {
  const postSpy = vi.fn(
    cfg.postImpl ??
      (async () => ({ success: true, platform: cfg.platform, postId: `${cfg.platform}-id` }))
  )
  return {
    platform: cfg.platform,
    charLimit: cfg.charLimit,
    countCharacters: (s: string) => s.length,
    validateContent: () => ({ valid: true, characterCount: 0, limit: cfg.charLimit, overflowBy: 0 }),
    enforceLimit: (content: string, hashtags: string[] = []) => ({ content, hashtags, truncated: false }),
    post: postSpy,
    postSpy,
  }
}

const CREDS = new StaticCredentialProvider('test-token')

function makeQueue(connectors: Partial<Record<Platform, SocialConnector>>, opts: {
  rateLimiter?: RateLimiter
  store?: JobStore
  log?: ExecutionLog
  config?: Partial<ConstructorParameters<typeof PostingQueueService>[0]['config']>
} = {}) {
  const credentials: Partial<Record<Platform, StaticCredentialProvider>> = {}
  for (const k of Object.keys(connectors) as Platform[]) credentials[k] = CREDS
  return new PostingQueueService({
    connectors,
    credentials,
    rateLimiter: opts.rateLimiter,
    store: opts.store,
    log: opts.log,
    config: { pollIntervalMs: 50, retryInitialDelayMs: 0, retryMaxDelayMs: 0, ...opts.config },
  })
}

beforeEach(() => {
  vi.useRealTimers()
})

// ─── schedule() ───────────────────────────────────────────────────────────────

describe('PostingQueueService.schedule()', () => {
  it('creates a job with status=pending and stores it', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
    expect(queue.store.get(job.id)).toBeDefined()
  })

  it('defaults scheduledAt to now when not provided', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const before = Date.now()
    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })
    const t = new Date(job.scheduledAt).getTime()
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(Date.now() + 1_000)
  })

  it('accepts Date and ISO string forms for scheduledAt', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const future = new Date(Date.now() + 60_000)
    const j1 = queue.schedule({ platform: 'twitter', request: { content: 'a' }, scheduledAt: future })
    const j2 = queue.schedule({
      platform: 'twitter',
      request: { content: 'b' },
      scheduledAt: future.toISOString(),
    })
    expect(j1.scheduledAt).toBe(future.toISOString())
    expect(j2.scheduledAt).toBe(future.toISOString())
  })

  it('throws when no connector is registered for the platform', () => {
    const queue = makeQueue({}) // empty registry
    expect(() =>
      queue.schedule({ platform: 'twitter', request: { content: 'x' } })
    ).toThrow(/no connector registered/i)
  })

  it('throws when maxAttempts is < 1', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    expect(() =>
      queue.schedule({ platform: 'twitter', request: { content: 'x' }, maxAttempts: 0 })
    ).toThrow(/maxAttempts/)
  })
})

// ─── tick() — happy path ──────────────────────────────────────────────────────

describe('PostingQueueService.tick() — successful execution', () => {
  it('runs a due job, marks it succeeded, and records a success log entry', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })

    const entries = await queue.tick()

    expect(conn.postSpy).toHaveBeenCalledTimes(1)
    expect(queue.store.get(job.id)?.status).toBe('succeeded')
    expect(entries).toHaveLength(1)
    expect(entries[0].outcome).toBe('success')
    expect(entries[0].result?.postId).toBe('twitter-id')
  })

  it('does not run jobs whose scheduledAt is in the future', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const future = new Date(Date.now() + 60_000)
    queue.schedule({ platform: 'twitter', request: { content: 'hi' }, scheduledAt: future })

    const entries = await queue.tick()
    expect(conn.postSpy).not.toHaveBeenCalled()
    expect(entries).toHaveLength(0)
  })

  it('records job result on the stored job', async () => {
    const conn = makeConnector({
      platform: 'twitter',
      charLimit: 280,
      postImpl: async () => ({ success: true, platform: 'twitter', postId: 'X-1', url: 'https://x.com/X-1' }),
    })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })

    await queue.tick()
    expect(queue.store.get(job.id)?.result?.postId).toBe('X-1')
  })

  it('passes the request and credentials through to the connector', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const req = { content: 'hi', hashtags: ['#a'] }
    queue.schedule({ platform: 'twitter', request: req })

    await queue.tick()
    const [calledReq, calledCreds] = conn.postSpy.mock.calls[0] as [
      SocialPostRequest,
      StaticCredentialProvider
    ]
    expect(calledReq).toEqual(req)
    expect(await calledCreds.getAccessToken()).toBe('test-token')
  })
})

// ─── tick() — retry path ──────────────────────────────────────────────────────

describe('PostingQueueService.tick() — retry on retryable errors', () => {
  it('retries a retryable failure and succeeds on the next attempt', async () => {
    let calls = 0
    const conn = makeConnector({
      platform: 'twitter',
      charLimit: 280,
      postImpl: async () => {
        calls++
        if (calls === 1) {
          throw new SocialError('rate limited', {
            platform: 'twitter',
            httpStatus: 429,
            retryable: true,
          })
        }
        return { success: true, platform: 'twitter', postId: 'after-retry' }
      },
    })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })

    // First tick → retryable failure
    let entries = await queue.tick()
    expect(entries).toHaveLength(1)
    expect(entries[0].outcome).toBe('retry')
    expect(queue.store.get(job.id)?.status).toBe('retrying')

    // Second tick — job becomes due immediately because backoff=0
    entries = await queue.tick()
    expect(entries).toHaveLength(1)
    expect(entries[0].outcome).toBe('success')
    expect(queue.store.get(job.id)?.status).toBe('succeeded')
  })

  it('marks failed once retries are exhausted', async () => {
    const conn = makeConnector({
      platform: 'twitter',
      charLimit: 280,
      postImpl: async () => {
        throw new SocialError('still bad', {
          platform: 'twitter',
          httpStatus: 500,
          retryable: true,
        })
      },
    })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({
      platform: 'twitter',
      request: { content: 'hi' },
      maxAttempts: 2,
    })

    // tick #1 → retry
    await queue.tick()
    expect(queue.store.get(job.id)?.status).toBe('retrying')

    // tick #2 → exhausted → failed
    const entries = await queue.tick()
    expect(entries).toHaveLength(1)
    expect(entries[0].outcome).toBe('failure')
    expect(queue.store.get(job.id)?.status).toBe('failed')
    expect(queue.store.get(job.id)?.attempts).toBe(2)
  })

  it('does not retry non-retryable errors', async () => {
    const conn = makeConnector({
      platform: 'twitter',
      charLimit: 280,
      postImpl: async () => {
        throw new SocialError('forbidden', {
          platform: 'twitter',
          httpStatus: 403,
          retryable: false,
        })
      },
    })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({
      platform: 'twitter',
      request: { content: 'hi' },
      maxAttempts: 5,
    })

    const entries = await queue.tick()
    expect(entries[0].outcome).toBe('failure')
    expect(queue.store.get(job.id)?.status).toBe('failed')
    expect(queue.store.get(job.id)?.attempts).toBe(1)
  })

  it('wraps non-SocialError exceptions and marks them non-retryable', async () => {
    const conn = makeConnector({
      platform: 'twitter',
      charLimit: 280,
      postImpl: async () => {
        throw new Error('boom')
      },
    })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })

    const entries = await queue.tick()
    expect(entries[0].outcome).toBe('failure')
    expect(entries[0].errorMessage).toBe('boom')
    expect(queue.store.get(job.id)?.status).toBe('failed')
  })
})

// ─── tick() — rate-limit handling ─────────────────────────────────────────────

describe('PostingQueueService.tick() — rate-limit handling', () => {
  it('defers a job when the platform is rate-limited and does not call the connector', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const limiter = new RateLimiter({ twitter: { maxRequests: 1, windowMs: 60_000 } })
    const queue = makeQueue({ twitter: conn }, { rateLimiter: limiter })

    // Saturate the limiter ahead of time
    limiter.recordSend('twitter', Date.now())

    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })
    const entries = await queue.tick()

    expect(conn.postSpy).not.toHaveBeenCalled()
    expect(entries).toHaveLength(1)
    expect(entries[0].outcome).toBe('rate_limited')

    const updated = queue.store.get(job.id)!
    expect(updated.status).toBe('retrying')
    expect(updated.attempts).toBe(0) // no attempt counted
  })

  it('reschedules a rate-limited job to nextAvailable', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const limiter = new RateLimiter({ twitter: { maxRequests: 1, windowMs: 60_000 } })
    const queue = makeQueue({ twitter: conn }, { rateLimiter: limiter })

    const now = Date.now()
    limiter.recordSend('twitter', now)

    const job = queue.schedule({ platform: 'twitter', request: { content: 'hi' } })
    await queue.tick(now)

    const updated = queue.store.get(job.id)!
    // nextAttemptAt should be ≥ now + window
    expect(new Date(updated.nextAttemptAt).getTime()).toBeGreaterThanOrEqual(now + 60_000)
  })

  it('records a successful send against the rate limiter', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const limiter = new RateLimiter({ twitter: { maxRequests: 2, windowMs: 60_000 } })
    const queue = makeQueue({ twitter: conn }, { rateLimiter: limiter })

    queue.schedule({ platform: 'twitter', request: { content: 'a' } })
    queue.schedule({ platform: 'twitter', request: { content: 'b' } })
    queue.schedule({ platform: 'twitter', request: { content: 'c' } })

    const entries = await queue.tick()
    const outcomes = entries.map((e) => e.outcome).sort()
    // First two go through, third is rate-limited
    expect(outcomes).toEqual(['rate_limited', 'success', 'success'].sort())
  })
})

// ─── cancel() ─────────────────────────────────────────────────────────────────

describe('PostingQueueService.cancel()', () => {
  it('cancels a pending job and prevents execution', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({ platform: 'twitter', request: { content: 'x' } })

    expect(queue.cancel(job.id)).toBe(true)
    expect(queue.store.get(job.id)?.status).toBe('cancelled')

    await queue.tick()
    expect(conn.postSpy).not.toHaveBeenCalled()
  })

  it('returns false when cancelling a completed job', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    const job = queue.schedule({ platform: 'twitter', request: { content: 'x' } })
    await queue.tick()
    expect(queue.cancel(job.id)).toBe(false)
  })

  it('returns false for unknown ids', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    expect(queue.cancel('nope')).toBe(false)
  })
})

// ─── start() / stop() ─────────────────────────────────────────────────────────

describe('PostingQueueService.start()/stop()', () => {
  it('start() invokes tick() periodically until stop() is called', async () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn }, { config: { pollIntervalMs: 5 } })
    queue.schedule({ platform: 'twitter', request: { content: 'hi' } })

    queue.start()
    // Allow the interval to fire at least once
    await new Promise((r) => setTimeout(r, 50))
    queue.stop()

    expect(conn.postSpy).toHaveBeenCalled()
  })

  it('start() is idempotent', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    queue.start()
    queue.start()
    queue.stop()
  })

  it('stop() is idempotent', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue({ twitter: conn })
    queue.stop()
    queue.stop()
  })
})

// ─── backoff calculation ──────────────────────────────────────────────────────

describe('PostingQueueService.backoffMs()', () => {
  it('grows exponentially up to retryMaxDelayMs', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue(
      { twitter: conn },
      {
        config: {
          retryInitialDelayMs: 100,
          retryBackoffMultiplier: 3,
          retryMaxDelayMs: 5_000,
        },
      }
    )

    expect(queue.backoffMs(1)).toBe(100)
    expect(queue.backoffMs(2)).toBe(300)
    expect(queue.backoffMs(3)).toBe(900)
    expect(queue.backoffMs(4)).toBe(2_700)
    // 5th attempt would be 8100 — capped
    expect(queue.backoffMs(5)).toBe(5_000)
  })

  it('clamps attempt < 1 to attempt=1', () => {
    const conn = makeConnector({ platform: 'twitter', charLimit: 280 })
    const queue = makeQueue(
      { twitter: conn },
      { config: { retryInitialDelayMs: 1_000, retryBackoffMultiplier: 2, retryMaxDelayMs: 60_000 } }
    )
    expect(queue.backoffMs(0)).toBe(1_000)
  })
})

// ─── multi-platform ───────────────────────────────────────────────────────────

describe('PostingQueueService — multi-platform', () => {
  it('routes each job to its platform-specific connector', async () => {
    const twitter = makeConnector({ platform: 'twitter', charLimit: 280 })
    const linkedin = makeConnector({ platform: 'linkedin', charLimit: 3_000 })
    const queue = makeQueue({ twitter, linkedin })

    queue.schedule({ platform: 'twitter', request: { content: 'tw' } })
    queue.schedule({ platform: 'linkedin', request: { content: 'li' } })

    await queue.tick()
    expect(twitter.postSpy).toHaveBeenCalledTimes(1)
    expect(linkedin.postSpy).toHaveBeenCalledTimes(1)
  })

  it('rate limits are tracked per platform', async () => {
    const twitter = makeConnector({ platform: 'twitter', charLimit: 280 })
    const linkedin = makeConnector({ platform: 'linkedin', charLimit: 3_000 })
    const limiter = new RateLimiter({
      twitter: { maxRequests: 1, windowMs: 60_000 },
      linkedin: { maxRequests: 5, windowMs: 60_000 },
    })
    const queue = makeQueue({ twitter, linkedin }, { rateLimiter: limiter })

    queue.schedule({ platform: 'twitter', request: { content: 'a' } })
    queue.schedule({ platform: 'twitter', request: { content: 'b' } })
    queue.schedule({ platform: 'linkedin', request: { content: 'x' } })

    await queue.tick()
    expect(twitter.postSpy).toHaveBeenCalledTimes(1)
    expect(linkedin.postSpy).toHaveBeenCalledTimes(1)
  })
})
