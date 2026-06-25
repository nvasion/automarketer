// @vitest-environment node
/**
 * End-to-end tests for the multi-platform social media posting workflow.
 *
 * These tests exercise the complete posting pipeline:
 *   Content → enforceLimit() → Platform Connector → HTTP POST → SocialPostResult
 *
 * All five platform connectors (LinkedIn, Twitter/X, Reddit, Facebook,
 * Instagram) are covered.  The outbound HTTP layer is replaced with a fetch
 * mock so tests run offline without real API credentials.
 *
 * Coverage goals:
 *   - Each platform connector returns a success result with correct fields
 *   - Character limits are enforced before the HTTP call for every platform
 *   - Platform-specific payload shapes reach the HTTP layer correctly
 *   - Non-OK HTTP responses surface as SocialError with the right status code
 *   - Network failures are wrapped in SocialError
 *   - Retry logic retries 5xx responses before giving up
 *   - Rate-limit (429) handling waits before retrying
 *   - Missing required platform fields throw a SocialError immediately
 *   - Full end-to-end: ContentGenerationService output feeds a connector post()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TwitterConnector, TWITTER_CHAR_LIMIT, TWITTER_API_BASE } from '../../src/services/social/platforms/TwitterConnector'
import { LinkedInConnector, LINKEDIN_CHAR_LIMIT, LINKEDIN_API_BASE } from '../../src/services/social/platforms/LinkedInConnector'
import { RedditConnector, REDDIT_CHAR_LIMIT, REDDIT_API_BASE } from '../../src/services/social/platforms/RedditConnector'
import { FacebookConnector, FACEBOOK_CHAR_LIMIT, FACEBOOK_GRAPH_BASE } from '../../src/services/social/platforms/FacebookConnector'
import { InstagramConnector, INSTAGRAM_CHAR_LIMIT, INSTAGRAM_GRAPH_BASE } from '../../src/services/social/platforms/InstagramConnector'
import { StaticCredentialProvider, SocialError } from '../../src/services/social/types'
import { ContentGenerationService } from '../../src/services/ai/ContentGenerationService'
import type { InferenceClient } from '../../src/services/ai/InferenceClient'
import type { InferenceResponse } from '../../src/services/ai/types'
import type { ContentGenerationParams } from '../../src/services/ai/ContentGenerationService'
import { PLATFORM_CONFIGS } from '../../src/data/sampleData'

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response
}

function makeErrorResponse(status: number, body = 'Error'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not ok')),
    text: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response
}

function makeRateLimitResponse(retryAfterSeconds?: number): Response {
  const headers = new Headers()
  if (retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(retryAfterSeconds))
  }
  return {
    ok: false,
    status: 429,
    json: () => Promise.reject(new Error('rate limited')),
    text: () => Promise.resolve('Rate limited'),
    headers,
  } as unknown as Response
}

// ─── Credential helper ────────────────────────────────────────────────────────

const TEST_CREDS = new StaticCredentialProvider('test-access-token')

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ─── Workflow 1: Twitter/X posting ───────────────────────────────────────────

describe('Twitter/X posting workflow', () => {
  it('posts a tweet and returns success with postId and URL', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'tweet-42', text: 'Hello world' } }))
    const connector = new TwitterConnector({ maxRetries: 0 })

    const result = await connector.post(
      { content: 'Hello world', hashtags: ['#OpenSource'] },
      TEST_CREDS
    )

    expect(result.success).toBe(true)
    expect(result.platform).toBe('twitter')
    expect(result.postId).toBe('tweet-42')
    expect(result.url).toContain('tweet-42')
  })

  it('sends the correct HTTP method and URL', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    const connector = new TwitterConnector({ maxRetries: 0 })
    await connector.post({ content: 'Test tweet' }, TEST_CREDS)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${TWITTER_API_BASE}/2/tweets`)
    expect(init.method).toBe('POST')
  })

  it('sends Authorization Bearer header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    const connector = new TwitterConnector({ maxRetries: 0 })
    await connector.post({ content: 'Test' }, new StaticCredentialProvider('my-bearer-token'))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-bearer-token')
  })

  it('enforces the 280-character limit — oversized content is truncated before HTTP call', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    const connector = new TwitterConnector({ maxRetries: 0 })
    const oversized = 'word '.repeat(100).trim()

    await connector.post({ content: oversized }, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { text: string }
    expect(body.text.length).toBeLessThanOrEqual(TWITTER_CHAR_LIMIT)
  })

  it('combines content and hashtags inline (Twitter convention)', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'twt-1' } }))
    const connector = new TwitterConnector({ maxRetries: 0 })
    await connector.post({ content: 'Hello', hashtags: ['#AI', '#Launch'] }, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { text: string }
    // Twitter uses inline hashtags (space-separated, not double-newline)
    expect(body.text).toBe('Hello #AI #Launch')
  })

  it('throws SocialError on non-ok response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(403, 'Forbidden'))
    const connector = new TwitterConnector({ maxRetries: 0 })
    await expect(connector.post({ content: 'Test' }, TEST_CREDS)).rejects.toBeInstanceOf(SocialError)
  })

  it('throws SocialError on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Network unreachable'))
    const connector = new TwitterConnector({ maxRetries: 0 })
    await expect(connector.post({ content: 'Test' }, TEST_CREDS)).rejects.toBeInstanceOf(SocialError)
  })

  it('counts URLs as 23 characters (Twitter weighted count)', () => {
    const connector = new TwitterConnector()
    const url = 'https://example.com/very/long/path/that/exceeds/23/characters'
    expect(connector.countCharacters(url)).toBe(23)
  })
})

// ─── Workflow 2: LinkedIn posting ─────────────────────────────────────────────

describe('LinkedIn posting workflow', () => {
  const linkedInRequest = {
    content: 'Exciting LinkedIn announcement for our professional network.',
    hashtags: ['#ProductLaunch', '#SaaS'],
    linkedIn: { authorId: 'urn:li:person:abc123' },
  }

  it('posts and returns success with postId', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'li-post-99' }))
    const connector = new LinkedInConnector({ maxRetries: 0 })

    const result = await connector.post(linkedInRequest, TEST_CREDS)
    expect(result.success).toBe(true)
    expect(result.platform).toBe('linkedin')
    expect(result.postId).toBe('li-post-99')
  })

  it('sends request to LinkedIn UGC Posts endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'li-1' }))
    const connector = new LinkedInConnector({ maxRetries: 0 })
    await connector.post(linkedInRequest, TEST_CREDS)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${LINKEDIN_API_BASE}/v2/ugcPosts`)
  })

  it('includes the author URN in the request body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'li-1' }))
    const connector = new LinkedInConnector({ maxRetries: 0 })
    await connector.post(linkedInRequest, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { author: string }
    expect(body.author).toBe('urn:li:person:abc123')
  })

  it('throws SocialError immediately when authorId is missing (no HTTP call)', async () => {
    const connector = new LinkedInConnector({ maxRetries: 0 })
    await expect(
      connector.post({ content: 'Post without author' }, TEST_CREDS)
    ).rejects.toThrow('LinkedIn post requires request.linkedIn.authorId')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces the 3000-character limit before posting', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'li-1' }))
    const connector = new LinkedInConnector({ maxRetries: 0 })
    const oversized = 'word '.repeat(700).trim() // ~3500 chars

    await connector.post({ ...linkedInRequest, content: oversized }, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: string } } }
    }
    const text = body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text
    expect(text.length).toBeLessThanOrEqual(LINKEDIN_CHAR_LIMIT)
  })

  it('throws SocialError on 401 Unauthorized', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'))
    const connector = new LinkedInConnector({ maxRetries: 0 })
    const err = await connector.post(linkedInRequest, TEST_CREDS).catch((e) => e) as SocialError
    expect(err).toBeInstanceOf(SocialError)
    expect(err.httpStatus).toBe(401)
    expect(err.platform).toBe('linkedin')
  })
})

// ─── Workflow 3: Reddit posting ───────────────────────────────────────────────

describe('Reddit posting workflow', () => {
  const redditRequest = {
    content: 'A detailed Reddit post with Markdown **formatting** and bullet points.',
    hashtags: [],
    reddit: {
      subreddit: 'programming',
      title: 'AutoMarketer — automated marketing for developers',
      nsfw: false,
    },
  }

  it('posts a self-post and returns success with postId and URL', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({
      json: { data: { id: 'abc123', url: 'https://reddit.com/r/programming/comments/abc123/' } }
    }))
    const connector = new RedditConnector({ maxRetries: 0 })
    const result = await connector.post(redditRequest, TEST_CREDS)

    expect(result.success).toBe(true)
    expect(result.platform).toBe('reddit')
    expect(result.postId).toBe('abc123')
    expect(result.url).toContain('reddit.com')
  })

  it('sends POST to the Reddit submit endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ json: { data: { id: 'r1' } } }))
    const connector = new RedditConnector({ maxRetries: 0 })
    await connector.post(redditRequest, TEST_CREDS)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${REDDIT_API_BASE}/api/submit`)
  })

  it('includes subreddit, title, and text in the form body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ json: { data: { id: 'r1' } } }))
    const connector = new RedditConnector({ maxRetries: 0 })
    await connector.post(redditRequest, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URLSearchParams(init.body as string)
    expect(params.get('sr')).toBe('programming')
    expect(params.get('title')).toBe('AutoMarketer — automated marketing for developers')
    expect(params.get('text')).toContain('detailed Reddit post')
    expect(params.get('kind')).toBe('self')
  })

  it('throws SocialError immediately when subreddit is missing', async () => {
    const connector = new RedditConnector({ maxRetries: 0 })
    await expect(
      connector.post({ content: 'Post', reddit: { title: 'Title', subreddit: '' } }, TEST_CREDS)
    ).rejects.toThrow('Reddit post requires request.reddit.subreddit')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws SocialError immediately when title is missing', async () => {
    const connector = new RedditConnector({ maxRetries: 0 })
    await expect(
      connector.post({ content: 'Post', reddit: { subreddit: 'test', title: '' } }, TEST_CREDS)
    ).rejects.toThrow('Reddit post requires request.reddit.title')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws SocialError for in-body Reddit API errors even on 200 response', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({
      json: { errors: [['SUBREDDIT_NOEXIST', 'that subreddit doesn\'t exist', 'sr']], data: null }
    }))
    const connector = new RedditConnector({ maxRetries: 0 })
    await expect(connector.post(redditRequest, TEST_CREDS)).rejects.toBeInstanceOf(SocialError)
  })

  it('enforces the 40,000-character limit', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ json: { data: { id: 'r1' } } }))
    const connector = new RedditConnector({ maxRetries: 0 })
    const oversized = 'word '.repeat(10_000).trim()

    await connector.post({ ...redditRequest, content: oversized }, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URLSearchParams(init.body as string)
    const text = params.get('text') ?? ''
    expect(text.length).toBeLessThanOrEqual(REDDIT_CHAR_LIMIT)
  })
})

// ─── Workflow 4: Facebook posting ────────────────────────────────────────────

describe('Facebook posting workflow', () => {
  const facebookRequest = {
    content: 'Exciting Facebook update for our community! Check out what we\'ve been building.',
    hashtags: ['#Community', '#Launch'],
    facebook: { pageId: 'my-page-id-123' },
  }

  it('posts and returns success with postId', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-post-1' }))
    const connector = new FacebookConnector({ maxRetries: 0 })
    const result = await connector.post(facebookRequest, TEST_CREDS)

    expect(result.success).toBe(true)
    expect(result.platform).toBe('facebook')
    expect(result.postId).toBe('fb-post-1')
    expect(result.url).toContain('facebook.com')
  })

  it('posts to the correct Graph API endpoint for the page', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-1' }))
    const connector = new FacebookConnector({ maxRetries: 0 })
    await connector.post(facebookRequest, TEST_CREDS)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${FACEBOOK_GRAPH_BASE}/my-page-id-123/feed`)
  })

  it('includes the combined message in the request body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-1' }))
    const connector = new FacebookConnector({ maxRetries: 0 })
    await connector.post(facebookRequest, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { message: string }
    expect(body.message).toContain('Exciting Facebook update')
    expect(body.message).toContain('#Community')
  })

  it('includes optional link when provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-1' }))
    const connector = new FacebookConnector({ maxRetries: 0 })
    await connector.post(
      { ...facebookRequest, facebook: { pageId: 'my-page-id-123', link: 'https://example.com' } },
      TEST_CREDS
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { link: string }
    expect(body.link).toBe('https://example.com')
  })

  it('throws SocialError when pageId is missing', async () => {
    const connector = new FacebookConnector({ maxRetries: 0 })
    await expect(
      connector.post({ content: 'Post without pageId' }, TEST_CREDS)
    ).rejects.toThrow('Facebook post requires request.facebook.pageId')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces the 63,206-character limit', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'fb-1' }))
    const connector = new FacebookConnector({ maxRetries: 0 })
    const oversized = 'word '.repeat(15_000).trim()

    await connector.post({ ...facebookRequest, content: oversized }, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { message: string }
    expect(body.message.length).toBeLessThanOrEqual(FACEBOOK_CHAR_LIMIT)
  })
})

// ─── Workflow 5: Instagram posting ────────────────────────────────────────────

describe('Instagram posting workflow', () => {
  const instagramRequest = {
    content: 'Link in bio ✨ Discover your next favourite tool.',
    hashtags: ['#Productivity', '#AppLaunch'],
    instagram: {
      userId: 'ig-user-789',
      imageUrl: 'https://cdn.example.com/launch-banner.png',
    },
  }

  it('executes the two-step publish flow and returns success', async () => {
    // Step 1: media container creation
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'container-id-111' }))
      // Step 2: publish
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-id-222' }))

    const connector = new InstagramConnector({ maxRetries: 0 })
    const result = await connector.post(instagramRequest, TEST_CREDS)

    expect(result.success).toBe(true)
    expect(result.platform).toBe('instagram')
    expect(result.postId).toBe('media-id-222')
    expect(result.url).toContain('media-id-222')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('step 1 posts to the media container endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'container-id' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-id' }))

    const connector = new InstagramConnector({ maxRetries: 0 })
    await connector.post(instagramRequest, TEST_CREDS)

    const [url1] = fetchMock.mock.calls[0] as [string]
    expect(url1).toBe(`${INSTAGRAM_GRAPH_BASE}/ig-user-789/media`)
  })

  it('step 2 posts to the media_publish endpoint with the container ID', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'container-abc' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'media-xyz' }))

    const connector = new InstagramConnector({ maxRetries: 0 })
    await connector.post(instagramRequest, TEST_CREDS)

    const [url2, init2] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url2).toBe(`${INSTAGRAM_GRAPH_BASE}/ig-user-789/media_publish`)
    const body = JSON.parse(init2.body as string) as { creation_id: string }
    expect(body.creation_id).toBe('container-abc')
  })

  it('throws SocialError when userId is missing', async () => {
    const connector = new InstagramConnector({ maxRetries: 0 })
    await expect(
      connector.post(
        { content: 'Post', instagram: { userId: '', imageUrl: 'https://img.com/img.png' } },
        TEST_CREDS
      )
    ).rejects.toThrow('Instagram post requires request.instagram.userId')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws SocialError when imageUrl is missing', async () => {
    const connector = new InstagramConnector({ maxRetries: 0 })
    await expect(
      connector.post(
        { content: 'Post', instagram: { userId: 'user-1', imageUrl: '' } },
        TEST_CREDS
      )
    ).rejects.toThrow('Instagram post requires request.instagram.imageUrl')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws SocialError when step 1 fails with non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(400, 'Invalid image URL'))
    const connector = new InstagramConnector({ maxRetries: 0 })
    const err = await connector.post(instagramRequest, TEST_CREDS).catch((e) => e) as SocialError
    expect(err).toBeInstanceOf(SocialError)
    expect(err.httpStatus).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1) // step 2 never reached
  })

  it('throws SocialError when step 1 returns no container ID', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({ id: undefined }))
    const connector = new InstagramConnector({ maxRetries: 0 })
    await expect(connector.post(instagramRequest, TEST_CREDS)).rejects.toThrow(
      'Instagram media container creation returned no ID'
    )
  })

  it('enforces the 2200-character caption limit', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOkResponse({ id: 'c-1' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'm-1' }))

    const connector = new InstagramConnector({ maxRetries: 0 })
    const oversized = 'word '.repeat(500).trim() // ~2500 chars

    await connector.post({ ...instagramRequest, content: oversized }, TEST_CREDS)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { caption: string }
    expect(body.caption.length).toBeLessThanOrEqual(INSTAGRAM_CHAR_LIMIT)
  })
})

// ─── Workflow 6: Retry logic ──────────────────────────────────────────────────

describe('Retry logic', () => {
  it('retries on 5xx responses and succeeds on a subsequent attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(makeErrorResponse(503, 'Service unavailable'))
      .mockResolvedValueOnce(makeOkResponse({ data: { id: 'twt-retry' } }))

    // maxRetries=1 → 1 retry after the initial failure
    const connector = new TwitterConnector({ maxRetries: 1, initialDelayMs: 0 })
    const result = await connector.post({ content: 'Hello retry' }, TEST_CREDS)

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws SocialError after exhausting all retries on 5xx', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'Internal server error'))

    // maxRetries=2 → 3 total attempts (initial + 2 retries)
    const connector = new TwitterConnector({ maxRetries: 2, initialDelayMs: 0 })
    await expect(connector.post({ content: 'Hello' }, TEST_CREDS)).rejects.toBeInstanceOf(SocialError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries on 429 rate-limit response with no Retry-After header', async () => {
    fetchMock
      .mockResolvedValueOnce(makeRateLimitResponse())
      .mockResolvedValueOnce(makeOkResponse({ data: { id: 'twt-after-rate-limit' } }))

    const connector = new TwitterConnector({ maxRetries: 1, initialDelayMs: 0 })
    const result = await connector.post({ content: 'Hello' }, TEST_CREDS)
    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry on non-transient 4xx errors (0 additional attempts)', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(403, 'Forbidden'))

    const connector = new TwitterConnector({ maxRetries: 3, initialDelayMs: 0 })
    await expect(connector.post({ content: 'Hello' }, TEST_CREDS)).rejects.toBeInstanceOf(SocialError)
    // 403 is not retryable — only 1 attempt should be made
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on network failures up to maxRetries', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeOkResponse({ data: { id: 'twt-after-net' } }))

    const connector = new TwitterConnector({ maxRetries: 1, initialDelayMs: 0 })
    const result = await connector.post({ content: 'Hello' }, TEST_CREDS)
    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ─── Workflow 7: SocialError properties ───────────────────────────────────────

describe('SocialError properties', () => {
  it('SocialError is an instance of Error', () => {
    const err = new SocialError('Test error', { platform: 'twitter' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SocialError')
  })

  it('retryable=true for 429 and 5xx errors', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(429, 'Rate limited'))
    const connector = new TwitterConnector({ maxRetries: 0 })

    const err = await connector.post({ content: 'Test' }, TEST_CREDS).catch((e) => e) as SocialError
    expect(err.retryable).toBe(true)
    expect(err.httpStatus).toBe(429)
  })

  it('retryable=false for 4xx client errors', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'))
    const connector = new TwitterConnector({ maxRetries: 0 })

    const err = await connector.post({ content: 'Test' }, TEST_CREDS).catch((e) => e) as SocialError
    expect(err.retryable).toBe(false)
    expect(err.httpStatus).toBe(401)
  })

  it('includes rawResponse in the error for debugging', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(422, 'Unprocessable entity'))
    const connector = new TwitterConnector({ maxRetries: 0 })

    const err = await connector.post({ content: 'Test' }, TEST_CREDS).catch((e) => e) as SocialError
    expect(err.rawResponse).toBe('Unprocessable entity')
  })
})

// ─── Workflow 8: StaticCredentialProvider ────────────────────────────────────

describe('StaticCredentialProvider', () => {
  it('returns the provided token as-is', async () => {
    const creds = new StaticCredentialProvider('my-static-token')
    expect(await creds.getAccessToken()).toBe('my-static-token')
  })

  it('returns the same token on repeated calls', async () => {
    const creds = new StaticCredentialProvider('stable-token')
    const t1 = await creds.getAccessToken()
    const t2 = await creds.getAccessToken()
    expect(t1).toBe(t2)
  })
})

// ─── Workflow 9: Full pipeline — AI generation → social post ─────────────────

describe('End-to-end: AI generation feeds into social posting', () => {
  /**
   * This test exercises the full pipeline:
   *   1. ContentGenerationService produces a GeneratedPostDraft
   *   2. The draft content is passed directly to a platform connector
   *   3. The connector enforces limits and posts to the (mocked) API
   */

  function makeInferenceClient(response: string): InferenceClient {
    return {
      provider: 'openrouter',
      complete: vi.fn(async (): Promise<InferenceResponse> => ({ content: response })),
    }
  }

  const CAMPAIGN_PARAMS: ContentGenerationParams = {
    campaignName: 'VelocityApp',
    websiteUrl: 'https://velocityapp.io',
    description: 'The fastest CI/CD pipeline for modern development teams',
    targetAudience: 'DevOps engineers',
    platforms: ['twitter'],
    tone: 'professional',
    emojiUsage: 'none',
    autoHashtags: true,
  }

  it('generates a Twitter draft and posts it successfully', async () => {
    // AI returns a well-formed tweet with hashtags
    const inferenceClient = makeInferenceClient(
      'Supercharge your CI/CD with VelocityApp — 10× faster builds guaranteed.\n\n#DevOps #CICD #Velocity'
    )
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'pipeline-tweet-1' } }))

    const genSvc = new ContentGenerationService(inferenceClient)
    const draft = await genSvc.generatePost('twitter', CAMPAIGN_PARAMS)

    // Verify the draft is shaped correctly
    expect(draft.platform).toBe('twitter')
    expect(draft.content).toContain('Supercharge your CI/CD')
    expect(draft.hashtags).toContain('#DevOps')

    // Post the draft via the connector
    const connector = new TwitterConnector({ maxRetries: 0 })
    const result = await connector.post(
      { content: draft.content, hashtags: draft.hashtags },
      TEST_CREDS
    )

    expect(result.success).toBe(true)
    expect(result.platform).toBe('twitter')
    expect(result.postId).toBe('pipeline-tweet-1')

    // Verify the HTTP payload respects the char limit
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { text: string }
    expect(body.text.length).toBeLessThanOrEqual(TWITTER_CHAR_LIMIT)
  })

  it('handles oversized AI response — generation truncates, connector posts valid content', async () => {
    // AI produces content that exceeds Twitter's 280-char limit
    const twitterLimit = PLATFORM_CONFIGS.find((p) => p.id === 'twitter')!.charLimit
    const oversized = 'word '.repeat(twitterLimit).trim()
    const inferenceClient = makeInferenceClient(oversized)
    fetchMock.mockResolvedValue(makeOkResponse({ data: { id: 'truncated-tweet' } }))

    const genSvc = new ContentGenerationService(inferenceClient)
    const draft = await genSvc.generatePost('twitter', { ...CAMPAIGN_PARAMS, autoHashtags: false })

    // Content generation should have already truncated
    expect(draft.content.length).toBeLessThanOrEqual(twitterLimit)

    const connector = new TwitterConnector({ maxRetries: 0 })
    const result = await connector.post({ content: draft.content }, TEST_CREDS)
    expect(result.success).toBe(true)

    // Confirm HTTP payload is within limit
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { text: string }
    expect(body.text.length).toBeLessThanOrEqual(TWITTER_CHAR_LIMIT)
  })

  it('generates posts for LinkedIn and verifies char limit in HTTP payload', async () => {
    const linkedinLimit = PLATFORM_CONFIGS.find((p) => p.id === 'linkedin')!.charLimit
    const inferenceClient = makeInferenceClient(
      'Thrilled to announce VelocityApp — the CI/CD tool your team has been waiting for.'
    )
    fetchMock.mockResolvedValue(makeOkResponse({ id: 'li-launch-post' }))

    const genSvc = new ContentGenerationService(inferenceClient)
    const draft = await genSvc.generatePost('linkedin', {
      ...CAMPAIGN_PARAMS,
      platforms: ['linkedin'],
    })

    const connector = new LinkedInConnector({ maxRetries: 0 })
    const result = await connector.post(
      {
        content: draft.content,
        hashtags: draft.hashtags,
        linkedIn: { authorId: 'urn:li:person:velocity-author' },
      },
      TEST_CREDS
    )

    expect(result.success).toBe(true)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: string } } }
    }
    const text = body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text
    expect(text.length).toBeLessThanOrEqual(linkedinLimit)
  })
})
