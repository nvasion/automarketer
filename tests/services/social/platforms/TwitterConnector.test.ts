import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TwitterConnector,
  TWITTER_API_BASE,
  TWITTER_CHAR_LIMIT,
} from '../../../../src/services/social/platforms/TwitterConnector'
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

describe('TwitterConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let connector: TwitterConnector

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    connector = new TwitterConnector({ maxRetries: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Identity ────────────────────────────────────────────────────────────────

  it('has platform "twitter"', () => {
    expect(connector.platform).toBe('twitter')
  })

  it(`has charLimit ${TWITTER_CHAR_LIMIT}`, () => {
    expect(connector.charLimit).toBe(TWITTER_CHAR_LIMIT)
  })

  // ── HTTP request shape ───────────────────────────────────────────────────────

  it('sends POST to the correct Twitter v2 endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1', text: 'Hello' } }))
    await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${TWITTER_API_BASE}/2/tweets`)
  })

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('sends Authorization header with Bearer token', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'my-bearer-token' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-bearer-token')
  })

  it('sends the tweet text in the request body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    await connector.post({ content: 'Great tweet!' }, { getAccessToken: async () => 'token' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.text).toContain('Great tweet!')
  })

  it('combines content and hashtags into a single text field', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    await connector.post({ content: 'Hello', hashtags: ['#OpenSource'] }, { getAccessToken: async () => 'token' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.text).toContain('Hello')
    expect(body.text).toContain('#OpenSource')
  })

  // ── Response parsing ─────────────────────────────────────────────────────────

  it('returns success:true and the tweet ID on success', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-42', text: 'Hi' } }))
    const result = await connector.post({ content: 'Hi' }, { getAccessToken: async () => 'token' })
    expect(result.success).toBe(true)
    expect(result.postId).toBe('twt-42')
    expect(result.platform).toBe('twitter')
  })

  it('includes the tweet URL in the result when ID is available', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-99' } }))
    const result = await connector.post({ content: 'Hi' }, { getAccessToken: async () => 'token' })
    expect(result.url).toContain('twt-99')
  })

  // ── Error handling ────────────────────────────────────────────────────────────

  it('throws SocialError on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    await expect(connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })).rejects.toThrow(SocialError)
  })

  it('includes platform "twitter" in the network error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'))
    try {
      await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    } catch (err) {
      expect((err as SocialError).platform).toBe('twitter')
    }
  })

  it('throws SocialError with status code on non-ok response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(403, 'Forbidden'))
    try {
      await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'bad-token' })
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).httpStatus).toBe(403)
    }
  })

  // ── Character limit enforcement ───────────────────────────────────────────────

  it('enforces the 280-character limit — oversized tweets are truncated', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    const longContent = 'word '.repeat(100).trim()
    await connector.post({ content: longContent }, { getAccessToken: async () => 'token' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect((body.text as string).length).toBeLessThanOrEqual(TWITTER_CHAR_LIMIT)
  })

  it('does not truncate tweets within the limit', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    const shortContent = 'Short tweet #cool'
    await connector.post({ content: shortContent }, { getAccessToken: async () => 'token' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.text).toBe(shortContent)
  })
})

// ── Twitter character counting ────────────────────────────────────────────────

const charCountConnector = new TwitterConnector()

describe('TwitterConnector.countCharacters()', () => {
  it('counts normal text using string length', () => {
    expect(charCountConnector.countCharacters('Hello world')).toBe(11)
  })

  it('counts a URL as exactly 23 characters regardless of length', () => {
    const longUrl = 'https://example.com/very-long-path-that-exceeds-normal-length'
    expect(charCountConnector.countCharacters(longUrl)).toBe(23)
  })

  it('counts text + URL correctly', () => {
    const text = 'Check this out https://example.com/path'
    // "Check this out " = 15 chars + URL = 23 chars
    expect(charCountConnector.countCharacters(text)).toBe(15 + 23)
  })

  it('counts multiple URLs each as 23 characters', () => {
    const text = 'See https://a.com and https://b.com for details'
    // "See " (4) + url1 (23) + " and " (5) + url2 (23) + " for details" (12) = 67
    expect(charCountConnector.countCharacters(text)).toBe(4 + 23 + 5 + 23 + 12)
  })

  it('counts plain text without URLs using .length', () => {
    const text = 'No URLs here, just text #hashtag'
    expect(charCountConnector.countCharacters(text)).toBe(text.length)
  })
})
