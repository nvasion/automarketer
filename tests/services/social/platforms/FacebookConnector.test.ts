import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FacebookConnector,
  FACEBOOK_GRAPH_BASE,
  FACEBOOK_CHAR_LIMIT,
} from '../../../../src/services/social/platforms/FacebookConnector'
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

describe('FacebookConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let connector: FacebookConnector

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    connector = new FacebookConnector({ maxRetries: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Identity ────────────────────────────────────────────────────────────────

  it('has platform "facebook"', () => {
    expect(connector.platform).toBe('facebook')
  })

  it(`has charLimit ${FACEBOOK_CHAR_LIMIT}`, () => {
    expect(connector.charLimit).toBe(FACEBOOK_CHAR_LIMIT)
  })

  // ── Validation guard ────────────────────────────────────────────────────────

  it('throws SocialError when facebook.pageId is missing', async () => {
    await expect(
      connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError with platform "facebook" when pageId is missing', async () => {
    try {
      await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    } catch (err) {
      expect((err as SocialError).platform).toBe('facebook')
    }
  })

  // ── HTTP request shape ───────────────────────────────────────────────────────

  it('sends POST to the correct Facebook Graph endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'pg-123_post-456' }))
    await connector.post(
      { content: 'Hello', facebook: { pageId: '12345' } },
      { getAccessToken: async () => 'token' }
    )
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${FACEBOOK_GRAPH_BASE}/12345/feed`)
  })

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'pg-123_post-1' }))
    await connector.post(
      { content: 'Hello', facebook: { pageId: '12345' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('includes message and access_token in the request body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'pg-123_post-1' }))
    await connector.post(
      { content: 'Facebook post body', facebook: { pageId: '99' } },
      { getAccessToken: async () => 'page-access-token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.message).toContain('Facebook post body')
    expect(body.access_token).toBe('page-access-token')
  })

  it('appends hashtags to the message', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'pg-1_post-1' }))
    await connector.post(
      {
        content: 'Hello',
        hashtags: ['#Marketing', '#Social'],
        facebook: { pageId: '99' },
      },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.message).toContain('#Marketing')
    expect(body.message).toContain('#Social')
  })

  it('includes link in the body when facebook.link is provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'pg-1_post-2' }))
    await connector.post(
      {
        content: 'Check this out',
        facebook: { pageId: '99', link: 'https://example.com' },
      },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.link).toBe('https://example.com')
  })

  it('does not include link when facebook.link is not provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'pg-1_post-3' }))
    await connector.post(
      { content: 'Hello', facebook: { pageId: '99' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.link).toBeUndefined()
  })

  // ── Response parsing ─────────────────────────────────────────────────────────

  it('returns success:true and the post ID on success', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-page_post-789' }))
    const result = await connector.post(
      { content: 'Hello', facebook: { pageId: '99' } },
      { getAccessToken: async () => 'token' }
    )
    expect(result.success).toBe(true)
    expect(result.postId).toBe('fb-page_post-789')
    expect(result.platform).toBe('facebook')
  })

  it('includes the post URL when ID is available', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-99_post-1' }))
    const result = await connector.post(
      { content: 'Hello', facebook: { pageId: '99' } },
      { getAccessToken: async () => 'token' }
    )
    expect(result.url).toContain('fb-99_post-1')
  })

  // ── Error handling ────────────────────────────────────────────────────────────

  it('throws SocialError on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    await expect(
      connector.post({ content: 'Hello', facebook: { pageId: '99' } }, { getAccessToken: async () => 'token' })
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError with status code on non-ok response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(400, 'Bad Request'))
    try {
      await connector.post(
        { content: 'Hello', facebook: { pageId: '99' } },
        { getAccessToken: async () => 'token' }
      )
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).httpStatus).toBe(400)
      expect((err as SocialError).platform).toBe('facebook')
    }
  })

  // ── Character limit enforcement ───────────────────────────────────────────────

  it('enforces the 63,206 character limit before posting', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-1_post-1' }))
    const longContent = 'word '.repeat(15000).trim()
    await connector.post(
      { content: longContent, facebook: { pageId: '99' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect((body.message as string).length).toBeLessThanOrEqual(FACEBOOK_CHAR_LIMIT)
  })
})
