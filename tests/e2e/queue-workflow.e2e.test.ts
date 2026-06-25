// @vitest-environment node
/**
 * End-to-end tests for the content scheduling and posting queue.
 *
 * Exercises the full pipeline:
 *   schedule() → tick() → SocialConnector.post() → ExecutionLog
 *
 * Uses real platform connectors with a mocked fetch layer so retries,
 * rate-limit responses, and JSON payloads all flow through the same code
 * paths as production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PostingQueueService } from '../../src/services/queue/PostingQueueService'
import { RateLimiter } from '../../src/services/queue/RateLimiter'
import { TwitterConnector } from '../../src/services/social/platforms/TwitterConnector'
import { LinkedInConnector } from '../../src/services/social/platforms/LinkedInConnector'
import { StaticCredentialProvider } from '../../src/services/social/types'

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response
}

function errResponse(status: number, body = 'err'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not ok')),
    text: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response
}

const TEST_CREDS = new StaticCredentialProvider('e2e-token')

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Queue + real connectors — end-to-end', () => {
  it('schedules and publishes a Twitter post via the queue', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ data: { id: 'tw-99' } }))

    // Disable connector-level retries so we exercise queue-level retry only.
    const twitter = new TwitterConnector({ maxRetries: 0 })
    const queue = new PostingQueueService({
      connectors: { twitter },
      credentials: { twitter: TEST_CREDS },
      config: { retryInitialDelayMs: 0, retryMaxDelayMs: 0 },
    })

    const job = queue.schedule({
      platform: 'twitter',
      request: { content: 'Hello via queue!' },
    })

    const entries = await queue.tick()
    expect(entries).toHaveLength(1)
    expect(entries[0].outcome).toBe('success')
    expect(queue.store.get(job.id)?.status).toBe('succeeded')
    expect(queue.store.get(job.id)?.result?.postId).toBe('tw-99')
  })

  it('retries a 500 response and succeeds on the next tick', async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(500, 'Server error'))
      .mockResolvedValueOnce(okResponse({ data: { id: 'tw-retry' } }))

    const twitter = new TwitterConnector({ maxRetries: 0 })
    const queue = new PostingQueueService({
      connectors: { twitter },
      credentials: { twitter: TEST_CREDS },
      config: { retryInitialDelayMs: 0, retryMaxDelayMs: 0, defaultMaxAttempts: 3 },
    })

    queue.schedule({ platform: 'twitter', request: { content: 'Retry me' } })

    // First tick → retry
    let entries = await queue.tick()
    expect(entries[0].outcome).toBe('retry')

    // Second tick → success
    entries = await queue.tick()
    expect(entries[0].outcome).toBe('success')
  })

  it('does not call the connector when the platform is rate-limited', async () => {
    const twitter = new TwitterConnector({ maxRetries: 0 })
    const limiter = new RateLimiter({ twitter: { maxRequests: 1, windowMs: 3_600_000 } })
    // Pre-saturate
    limiter.recordSend('twitter', Date.now())

    const queue = new PostingQueueService({
      connectors: { twitter },
      credentials: { twitter: TEST_CREDS },
      rateLimiter: limiter,
    })

    queue.schedule({ platform: 'twitter', request: { content: 'Rate-limited' } })
    const entries = await queue.tick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(entries[0].outcome).toBe('rate_limited')
  })

  it('drains multiple platforms in a single tick', async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ data: { id: 'tw-1' } }))
      .mockResolvedValueOnce(okResponse({ id: 'li-1' }))

    const twitter = new TwitterConnector({ maxRetries: 0 })
    const linkedin = new LinkedInConnector({ maxRetries: 0 })
    const queue = new PostingQueueService({
      connectors: { twitter, linkedin },
      credentials: { twitter: TEST_CREDS, linkedin: TEST_CREDS },
    })

    queue.schedule({ platform: 'twitter', request: { content: 'tweet' } })
    queue.schedule({
      platform: 'linkedin',
      request: {
        content: 'LinkedIn announcement',
        linkedIn: { authorId: 'urn:li:person:abc' },
      },
    })

    const entries = await queue.tick()
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.outcome === 'success')).toBe(true)
  })

  it('records every execution attempt in the log (audit trail)', async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(okResponse({ data: { id: 'tw-final' } }))

    const twitter = new TwitterConnector({ maxRetries: 0 })
    const queue = new PostingQueueService({
      connectors: { twitter },
      credentials: { twitter: TEST_CREDS },
      config: { retryInitialDelayMs: 0, retryMaxDelayMs: 0, defaultMaxAttempts: 5 },
    })

    const job = queue.schedule({ platform: 'twitter', request: { content: 'audit me' } })
    await queue.tick()
    await queue.tick()
    await queue.tick()

    const log = queue.log.forJob(job.id)
    expect(log).toHaveLength(3)
    expect(log.map((e) => e.outcome)).toEqual(['retry', 'retry', 'success'])
    expect(log.map((e) => e.attempt)).toEqual([1, 2, 3])
  })

  it('marks a job failed after retries are exhausted (queue level)', async () => {
    fetchMock.mockResolvedValue(errResponse(503))

    const twitter = new TwitterConnector({ maxRetries: 0 })
    const queue = new PostingQueueService({
      connectors: { twitter },
      credentials: { twitter: TEST_CREDS },
      config: { retryInitialDelayMs: 0, retryMaxDelayMs: 0, defaultMaxAttempts: 2 },
    })

    const job = queue.schedule({ platform: 'twitter', request: { content: 'doomed' } })
    await queue.tick() // retry
    await queue.tick() // failure
    expect(queue.store.get(job.id)?.status).toBe('failed')
    const log = queue.log.forJob(job.id)
    expect(log[log.length - 1].outcome).toBe('failure')
  })
})
