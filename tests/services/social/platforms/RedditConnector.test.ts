import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RedditConnector,
  REDDIT_API_BASE,
  REDDIT_CHAR_LIMIT,
} from '../../../../src/services/social/platforms/RedditConnector'
import { SocialError } from '../../../../src/services/social/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function makeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not ok')),
    text: () => Promise.resolve(body),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RedditConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let connector: RedditConnector

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    connector = new RedditConnector({ maxRetries: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Identity ────────────────────────────────────────────────────────────────

  it('has platform "reddit"', () => {
    expect(connector.platform).toBe('reddit')
  })

  it(`has charLimit ${REDDIT_CHAR_LIMIT}`, () => {
    expect(connector.charLimit).toBe(REDDIT_CHAR_LIMIT)
  })

  // ── Validation guards ────────────────────────────────────────────────────────

  it('throws SocialError when reddit.subreddit is missing', async () => {
    await expect(
      connector.post(
        { content: 'Hello', reddit: { subreddit: '', title: 'My Post' } },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError when reddit.title is missing', async () => {
    await expect(
      connector.post(
        { content: 'Hello', reddit: { subreddit: 'programming', title: '' } },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError with platform "reddit" when required fields are missing', async () => {
    try {
      await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    } catch (err) {
      expect((err as SocialError).platform).toBe('reddit')
    }
  })

  // ── HTTP request shape ───────────────────────────────────────────────────────

  it('sends POST to the correct Reddit endpoint', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ json: { data: { id: 'abc123', url: 'https://reddit.com/r/test/comments/abc123/' }, errors: [] } })
    )
    await connector.post(
      { content: 'Hello', reddit: { subreddit: 'test', title: 'My Post' } },
      { getAccessToken: async () => 'token' }
    )
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${REDDIT_API_BASE}/api/submit`)
  })

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ json: { data: { id: 'abc' }, errors: [] } })
    )
    await connector.post(
      { content: 'Hello', reddit: { subreddit: 'test', title: 'Title' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('sends Authorization header with Bearer token', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ json: { data: { id: 'abc' }, errors: [] } })
    )
    await connector.post(
      { content: 'Hello', reddit: { subreddit: 'test', title: 'Title' } },
      { getAccessToken: async () => 'my-reddit-token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-reddit-token')
  })

  it('sends subreddit and title in the form-encoded body', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ json: { data: { id: 'abc' }, errors: [] } })
    )
    await connector.post(
      { content: 'Post body', reddit: { subreddit: 'programming', title: 'My Title' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URLSearchParams(init.body as string)
    expect(params.get('sr')).toBe('programming')
    expect(params.get('title')).toBe('My Title')
    expect(params.get('kind')).toBe('self')
  })

  it('includes post text in the form body', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ json: { data: { id: 'abc' }, errors: [] } })
    )
    await connector.post(
      { content: 'Hello Reddit!', reddit: { subreddit: 'test', title: 'Title' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URLSearchParams(init.body as string)
    expect(params.get('text')).toContain('Hello Reddit!')
  })

  it('defaults nsfw to false', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ json: { data: { id: 'abc' }, errors: [] } })
    )
    await connector.post(
      { content: 'Post', reddit: { subreddit: 'test', title: 'Title' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URLSearchParams(init.body as string)
    expect(params.get('nsfw')).toBe('false')
  })

  // ── Response parsing ─────────────────────────────────────────────────────────

  it('returns success:true and post ID on success', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({
        json: {
          data: { id: 'rd-999', url: 'https://reddit.com/r/test/comments/rd-999/' },
          errors: [],
        },
      })
    )
    const result = await connector.post(
      { content: 'Hello', reddit: { subreddit: 'test', title: 'Title' } },
      { getAccessToken: async () => 'token' }
    )
    expect(result.success).toBe(true)
    expect(result.postId).toBe('rd-999')
    expect(result.platform).toBe('reddit')
  })

  it('throws SocialError when Reddit returns errors in the JSON body', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({
        json: { data: {}, errors: [['SUBREDDIT_NOTALLOWED', 'Not allowed', 'sr']] },
      })
    )
    await expect(
      connector.post(
        { content: 'Hello', reddit: { subreddit: 'locked', title: 'Title' } },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  // ── Error handling ────────────────────────────────────────────────────────────

  it('throws SocialError on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    await expect(
      connector.post(
        { content: 'Hello', reddit: { subreddit: 'test', title: 'Title' } },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError with status code on non-ok response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(429, 'Too Many Requests'))
    try {
      await connector.post(
        { content: 'Hello', reddit: { subreddit: 'test', title: 'Title' } },
        { getAccessToken: async () => 'token' }
      )
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).httpStatus).toBe(429)
    }
  })

  // ── Character limit enforcement ───────────────────────────────────────────────

  it('enforces the 40,000 character limit before posting', async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({ json: { data: { id: 'abc' }, errors: [] } })
    )
    const longContent = 'word '.repeat(10000).trim()
    await connector.post(
      { content: longContent, reddit: { subreddit: 'test', title: 'Title' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URLSearchParams(init.body as string)
    expect((params.get('text') ?? '').length).toBeLessThanOrEqual(REDDIT_CHAR_LIMIT)
  })
})
