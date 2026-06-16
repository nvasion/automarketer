import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LinkedInConnector,
  LINKEDIN_API_BASE,
  LINKEDIN_CHAR_LIMIT,
} from '../../../../src/services/social/platforms/LinkedInConnector'
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

describe('LinkedInConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let connector: LinkedInConnector

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    connector = new LinkedInConnector({ maxRetries: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Identity ────────────────────────────────────────────────────────────────

  it('has platform "linkedin"', () => {
    expect(connector.platform).toBe('linkedin')
  })

  it(`has charLimit ${LINKEDIN_CHAR_LIMIT}`, () => {
    expect(connector.charLimit).toBe(LINKEDIN_CHAR_LIMIT)
  })

  // ── Validation guard ────────────────────────────────────────────────────────

  it('throws SocialError when linkedIn.authorId is missing', async () => {
    await expect(
      connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError with platform "linkedin" when authorId is missing', async () => {
    try {
      await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    } catch (err) {
      expect((err as SocialError).platform).toBe('linkedin')
    }
  })

  // ── HTTP request shape ───────────────────────────────────────────────────────

  it('sends POST to the correct LinkedIn endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-123' }))
    await connector.post(
      { content: 'Test', linkedIn: { authorId: 'urn:li:person:abc' } },
      { getAccessToken: async () => 'token' }
    )
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${LINKEDIN_API_BASE}/v2/ugcPosts`)
  })

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-123' }))
    await connector.post(
      { content: 'Test', linkedIn: { authorId: 'urn:li:person:abc' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('sends Authorization header with Bearer token', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-123' }))
    await connector.post(
      { content: 'Test', linkedIn: { authorId: 'urn:li:person:abc' } },
      { getAccessToken: async () => 'my-access-token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-access-token')
  })

  it('includes the author URN in the request body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-123' }))
    await connector.post(
      { content: 'Test', linkedIn: { authorId: 'urn:li:person:xyz' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.author).toBe('urn:li:person:xyz')
  })

  it('posts the content text in shareCommentary', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-123' }))
    await connector.post(
      { content: 'My post', linkedIn: { authorId: 'urn:li:person:abc' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const text = body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text
    expect(text).toContain('My post')
  })

  it('appends hashtags to the post text', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-123' }))
    await connector.post(
      {
        content: 'My post',
        hashtags: ['#SaaS', '#LinkedIn'],
        linkedIn: { authorId: 'urn:li:person:abc' },
      },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const text = body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text
    expect(text).toContain('#SaaS')
    expect(text).toContain('#LinkedIn')
  })

  it('sets lifecycleState to PUBLISHED', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-123' }))
    await connector.post(
      { content: 'Test', linkedIn: { authorId: 'urn:li:person:abc' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.lifecycleState).toBe('PUBLISHED')
  })

  // ── Response parsing ─────────────────────────────────────────────────────────

  it('returns success:true and the post ID on success', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-456' }))
    const result = await connector.post(
      { content: 'Test', linkedIn: { authorId: 'urn:li:person:abc' } },
      { getAccessToken: async () => 'token' }
    )
    expect(result.success).toBe(true)
    expect(result.postId).toBe('ugc-456')
    expect(result.platform).toBe('linkedin')
  })

  // ── Error handling ────────────────────────────────────────────────────────────

  it('throws SocialError on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    await expect(
      connector.post(
        { content: 'Test', linkedIn: { authorId: 'urn:li:person:abc' } },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError with status code on non-ok response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'))
    try {
      await connector.post(
        { content: 'Test', linkedIn: { authorId: 'urn:li:person:abc' } },
        { getAccessToken: async () => 'bad-token' }
      )
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).httpStatus).toBe(401)
      expect((err as SocialError).platform).toBe('linkedin')
    }
  })

  // ── Character limit enforcement ───────────────────────────────────────────────

  it('enforces the character limit — content over 3000 chars is truncated before posting', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'ugc-789' }))
    const longContent = 'A'.repeat(4000)
    await connector.post(
      { content: longContent, linkedIn: { authorId: 'urn:li:person:abc' } },
      { getAccessToken: async () => 'token' }
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const text: string = body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text
    expect(text.length).toBeLessThanOrEqual(LINKEDIN_CHAR_LIMIT)
  })
})
