/**
 * Tests for per-platform image attachment (SocialPostRequest.media).
 *
 * Each connector handles media differently; these tests mock `fetch` and assert
 * the request shapes that carry the image through to the platform API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LinkedInConnector } from '../../../src/services/social/platforms/LinkedInConnector'
import { TwitterConnector } from '../../../src/services/social/platforms/TwitterConnector'
import { FacebookConnector } from '../../../src/services/social/platforms/FacebookConnector'
import { InstagramConnector } from '../../../src/services/social/platforms/InstagramConnector'

const CREDS = { getAccessToken: async () => 'token' }
const IMAGE_URL = 'https://media.example.com/api/media/abc'

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function okBlob() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
  }
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body)
}

describe('connector media upload', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('LinkedIn registers an upload and attaches the asset as IMAGE media', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('registerUpload')) {
        return Promise.resolve(
          ok({
            value: {
              asset: 'urn:li:digitalmediaAsset:A',
              uploadMechanism: {
                'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
                  uploadUrl: 'https://upload.linkedin.example/1',
                },
              },
            },
          }),
        )
      }
      if (url.includes('upload.linkedin.example')) return Promise.resolve(ok({}))
      if (url.includes('/v2/ugcPosts')) return Promise.resolve(ok({ id: 'ugc:1' }))
      if (url.includes('media.example.com')) return Promise.resolve(okBlob())
      return Promise.resolve(okBlob())
    })

    const connector = new LinkedInConnector({ maxRetries: 0 })
    const res = await connector.post(
      { content: 'Hi', linkedIn: { authorId: 'urn:li:person:x' }, media: [{ url: IMAGE_URL }] },
      CREDS,
    )

    expect(res.success).toBe(true)
    const ugcCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/v2/ugcPosts'))!
    const share = (bodyOf(ugcCall).specificContent as Record<string, Record<string, unknown>>)[
      'com.linkedin.ugc.ShareContent'
    ]
    expect(share.shareMediaCategory).toBe('IMAGE')
    expect((share.media as Array<{ media: string }>)[0].media).toBe('urn:li:digitalmediaAsset:A')
  })

  it('Twitter uploads media and includes media_ids in the tweet', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('media.example.com')) return Promise.resolve(okBlob())
      if (url.includes('upload.twitter.com')) return Promise.resolve(ok({ media_id_string: '999' }))
      if (url.includes('/2/tweets')) return Promise.resolve(ok({ data: { id: 't1' } }))
      return Promise.resolve(okBlob())
    })

    const connector = new TwitterConnector({ maxRetries: 0 })
    const res = await connector.post({ content: 'Hi', media: [{ url: IMAGE_URL }] }, CREDS)

    expect(res.success).toBe(true)
    const tweetCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/2/tweets'))!
    expect(bodyOf(tweetCall).media).toEqual({ media_ids: ['999'] })
  })

  it('Twitter posts text only (no media field) when no images are attached', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/2/tweets')) return Promise.resolve(ok({ data: { id: 't2' } }))
      return Promise.resolve(ok({}))
    })

    const connector = new TwitterConnector({ maxRetries: 0 })
    await connector.post({ content: 'No image' }, CREDS)

    const tweetCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/2/tweets'))!
    expect(bodyOf(tweetCall).media).toBeUndefined()
  })

  it('Facebook posts to /photos with the image url when media is attached', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/photos')) return Promise.resolve(ok({ id: 'photo1', post_id: 'page_1' }))
      return Promise.resolve(ok({ id: 'feed1' }))
    })

    const connector = new FacebookConnector({ maxRetries: 0 })
    const res = await connector.post(
      { content: 'Hi', facebook: { pageId: 'PAGE' }, media: [{ url: IMAGE_URL }] },
      CREDS,
    )

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/photos'))!
    expect(String(call[0])).toContain('/PAGE/photos')
    expect(bodyOf(call).url).toBe(IMAGE_URL)
    expect(res.postId).toBe('page_1')
  })

  it('Facebook posts to /feed (no photo) when no media is attached', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/feed')) return Promise.resolve(ok({ id: 'feed1' }))
      return Promise.resolve(ok({}))
    })

    const connector = new FacebookConnector({ maxRetries: 0 })
    await connector.post({ content: 'Hi', facebook: { pageId: 'PAGE' } }, CREDS)

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/PAGE/feed'))).toBe(true)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/photos'))).toBe(false)
  })

  it('Instagram uses media[0] as the image when instagram.imageUrl is absent', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/media_publish')) return Promise.resolve(ok({ id: 'ig1' }))
      if (url.includes('/media')) return Promise.resolve(ok({ id: 'container1' }))
      return Promise.resolve(ok({}))
    })

    const connector = new InstagramConnector({ maxRetries: 0 })
    const res = await connector.post(
      { content: 'Hi', instagram: { userId: 'IGUSER' }, media: [{ url: IMAGE_URL }] },
      CREDS,
    )

    expect(res.success).toBe(true)
    const containerCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes('/media') && !String(c[0]).includes('/media_publish'),
    )!
    expect(bodyOf(containerCall).image_url).toBe(IMAGE_URL)
  })
})
