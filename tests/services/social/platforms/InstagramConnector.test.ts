import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  InstagramConnector,
  INSTAGRAM_GRAPH_BASE,
  INSTAGRAM_CHAR_LIMIT,
} from '../../../../src/services/social/platforms/InstagramConnector'
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

describe('InstagramConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let connector: InstagramConnector

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    connector = new InstagramConnector({ maxRetries: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Identity ────────────────────────────────────────────────────────────────

  it('has platform "instagram"', () => {
    expect(connector.platform).toBe('instagram')
  })

  it(`has charLimit ${INSTAGRAM_CHAR_LIMIT}`, () => {
    expect(connector.charLimit).toBe(INSTAGRAM_CHAR_LIMIT)
  })

  // ── Validation guards ────────────────────────────────────────────────────────

  it('throws SocialError when instagram.userId is missing', async () => {
    await expect(
      connector.post(
        { content: 'Hello', instagram: { userId: '', imageUrl: 'https://example.com/img.jpg' } },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError when instagram.imageUrl is missing', async () => {
    await expect(
      connector.post(
        { content: 'Hello', instagram: { userId: 'user-1', imageUrl: '' } },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError with platform "instagram" when required fields are missing', async () => {
    try {
      await connector.post({ content: 'Hello' }, { getAccessToken: async () => 'token' })
    } catch (err) {
      expect((err as SocialError).platform).toBe('instagram')
    }
  })

  // ── Two-step publish flow ────────────────────────────────────────────────────

  it('makes exactly two fetch calls (container creation + publish)', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'container-111' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-222' }))

    await connector.post(
      {
        content: 'Hello Instagram!',
        instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'token' }
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends the container creation request to the correct endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'container-111' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-222' }))

    await connector.post(
      {
        content: 'Caption',
        instagram: { userId: 'uid-42', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'token' }
    )

    const [firstUrl] = fetchMock.mock.calls[0] as [string]
    expect(firstUrl).toBe(`${INSTAGRAM_GRAPH_BASE}/uid-42/media`)
  })

  it('sends the publish request to the correct endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'container-111' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-222' }))

    await connector.post(
      {
        content: 'Caption',
        instagram: { userId: 'uid-42', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'token' }
    )

    const [secondUrl] = fetchMock.mock.calls[1] as [string]
    expect(secondUrl).toBe(`${INSTAGRAM_GRAPH_BASE}/uid-42/media_publish`)
  })

  it('passes the container ID to the publish step', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'ctr-abc' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-xyz' }))

    await connector.post(
      {
        content: 'Caption',
        instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'token' }
    )

    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(secondInit.body as string)
    expect(body.creation_id).toBe('ctr-abc')
  })

  it('includes caption and image_url in the container creation body', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'ctr-1' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-1' }))

    await connector.post(
      {
        content: 'My caption',
        instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'my-token' }
    )

    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(firstInit.body as string)
    expect(body.caption).toContain('My caption')
    expect(body.image_url).toBe('https://img.example.com/photo.jpg')
    expect(body.access_token).toBe('my-token')
  })

  // ── Response parsing ─────────────────────────────────────────────────────────

  it('returns success:true and the published media ID', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'ctr-1' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'ig-media-999' }))

    const result = await connector.post(
      {
        content: 'Caption',
        instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'token' }
    )

    expect(result.success).toBe(true)
    expect(result.postId).toBe('ig-media-999')
    expect(result.platform).toBe('instagram')
  })

  it('includes the Instagram URL in the result', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'ctr-1' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'ig-post-123' }))

    const result = await connector.post(
      {
        content: 'Caption',
        instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'token' }
    )

    expect(result.url).toContain('ig-post-123')
  })

  // ── Error handling ────────────────────────────────────────────────────────────

  it('throws SocialError when container creation fails (network)', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    await expect(
      connector.post(
        {
          content: 'Caption',
          instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
        },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError when container creation returns non-ok', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(400, 'Invalid image URL'))
    try {
      await connector.post(
        {
          content: 'Caption',
          instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
        },
        { getAccessToken: async () => 'token' }
      )
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).httpStatus).toBe(400)
      expect((err as SocialError).platform).toBe('instagram')
    }
  })

  it('throws SocialError when publish step returns non-ok', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'ctr-1' }))
      .mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'))

    try {
      await connector.post(
        {
          content: 'Caption',
          instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
        },
        { getAccessToken: async () => 'token' }
      )
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).httpStatus).toBe(500)
    }
  })

  it('throws SocialError when container creation returns no ID', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({}))
    await expect(
      connector.post(
        {
          content: 'Caption',
          instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
        },
        { getAccessToken: async () => 'token' }
      )
    ).rejects.toThrow(SocialError)
  })

  // ── Character limit enforcement ───────────────────────────────────────────────

  it('enforces the 2,200 character limit on the caption', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'ctr-1' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-1' }))

    const longContent = 'word '.repeat(600).trim()
    await connector.post(
      {
        content: longContent,
        instagram: { userId: 'uid-1', imageUrl: 'https://img.example.com/photo.jpg' },
      },
      { getAccessToken: async () => 'token' }
    )

    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(firstInit.body as string)
    expect((body.caption as string).length).toBeLessThanOrEqual(INSTAGRAM_CHAR_LIMIT)
  })
})
