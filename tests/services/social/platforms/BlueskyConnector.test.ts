import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BlueskyConnector,
  BLUESKY_CHAR_LIMIT,
  countGraphemes,
} from '../../../../src/services/social/platforms/BlueskyConnector'
import type { BlueskyCredentials } from '../../../../src/services/social/platforms/BlueskyConnector'
import { SocialError } from '../../../../src/services/social/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => null },
  }
}

function makeErrorResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
    headers: { get: (k: string) => headers[k] ?? null },
  }
}

/** A minimal BlueskyCredentials implementation for tests. */
function makeCredentials(token = 'test-dpop-token'): BlueskyCredentials {
  return {
    async getAccessToken() {
      return token
    },
    createDPoPProof(_method: string, _url: string, _token: string, _nonce?: string) {
      return 'mock-dpop-proof'
    },
  }
}

const MOCK_DID = 'did:plc:abc123'
const MOCK_PDS = 'https://bsky.social'
const MOCK_URI = `at://${MOCK_DID}/app.bsky.feed.post/rkey123`
const MOCK_CID = 'bafyreiabc123'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BlueskyConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let connector: BlueskyConnector

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    connector = new BlueskyConnector({ maxRetries: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Identity ─────────────────────────────────────────────────────────────────

  it('has platform "bluesky"', () => {
    expect(connector.platform).toBe('bluesky')
  })

  it(`has charLimit ${BLUESKY_CHAR_LIMIT}`, () => {
    expect(connector.charLimit).toBe(BLUESKY_CHAR_LIMIT)
  })

  // ── Grapheme counting ─────────────────────────────────────────────────────────

  describe('countGraphemes', () => {
    it('counts ASCII characters', () => {
      expect(countGraphemes('hello')).toBe(5)
    })

    it('counts emoji as single graphemes', () => {
      // 🦋 is a single grapheme cluster
      expect(countGraphemes('🦋')).toBe(1)
      expect(countGraphemes('hello 🦋')).toBe(7)
    })

    it('counts an empty string as 0', () => {
      expect(countGraphemes('')).toBe(0)
    })
  })

  it('uses grapheme counting for character limit', () => {
    const text = '🦋'.repeat(300)
    const validation = connector.validateContent(text)
    expect(validation.valid).toBe(true)
    expect(validation.characterCount).toBe(300)
  })

  // ── HTTP request shape ────────────────────────────────────────────────────────

  it('posts to the correct AT Protocol endpoint', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    await connector.post(
      { content: 'Hello Bluesky!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials(),
    )
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${MOCK_PDS}/xrpc/com.atproto.repo.createRecord`)
  })

  it('uses POST method', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    await connector.post(
      { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials(),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('sends DPoP Authorization header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    await connector.post(
      { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials('my-dpop-token'),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('DPoP my-dpop-token')
  })

  it('sends DPoP proof header', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    await connector.post(
      { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials(),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect((init.headers as Record<string, string>)['DPoP']).toBe('mock-dpop-proof')
  })

  it('sends the correct record body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    await connector.post(
      { content: 'Test post', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials(),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      repo: string
      collection: string
      record: { $type: string; text: string; createdAt: string }
    }
    expect(body.repo).toBe(MOCK_DID)
    expect(body.collection).toBe('app.bsky.feed.post')
    expect(body.record.$type).toBe('app.bsky.feed.post')
    expect(body.record.text).toBe('Test post')
    expect(typeof body.record.createdAt).toBe('string')
  })

  it('appends hashtags to the post text', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    await connector.post(
      { content: 'Hello!', hashtags: ['#Bluesky', '#Test'], bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials(),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { record: { text: string } }
    expect(body.record.text).toBe('Hello!\n\n#Bluesky #Test')
  })

  // ── Successful result ─────────────────────────────────────────────────────────

  it('returns success with postId and web URL', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    const result = await connector.post(
      { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials(),
    )
    expect(result.success).toBe(true)
    expect(result.platform).toBe('bluesky')
    expect(result.postId).toBe(MOCK_CID)
    expect(result.url).toBe(`https://bsky.app/profile/${encodeURIComponent(MOCK_DID)}/post/rkey123`)
  })

  // ── Error cases ───────────────────────────────────────────────────────────────

  it('throws SocialError when bluesky options are missing', async () => {
    await expect(
      connector.post({ content: 'Hello!' }, makeCredentials()),
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError when credentials do not support DPoP', async () => {
    const basicCreds = { async getAccessToken() { return 'token' } }
    await expect(
      connector.post(
        { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
        basicCreds,
      ),
    ).rejects.toThrow(SocialError)
  })

  it('throws SocialError on API failure', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(400, '{"error":"InvalidRequest","message":"Bad request"}'))
    await expect(
      connector.post(
        { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
        makeCredentials(),
      ),
    ).rejects.toThrow(SocialError)
  })

  it('throws retryable SocialError on 429', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(429, 'Rate limited'))
    try {
      await connector.post(
        { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
        makeCredentials(),
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).retryable).toBe(true)
    }
  })

  it('throws retryable SocialError on 500', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'Server error'))
    try {
      await connector.post(
        { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
        makeCredentials(),
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(SocialError)
      expect((err as SocialError).retryable).toBe(true)
    }
  })

  // ── DPoP nonce retry ──────────────────────────────────────────────────────────

  it('retries once with DPoP nonce on use_dpop_nonce error', async () => {
    // First call returns 401 use_dpop_nonce with a nonce header
    const nonceChallengeResponse = {
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'use_dpop_nonce' }),
      text: () => Promise.resolve(JSON.stringify({ error: 'use_dpop_nonce' })),
      headers: { get: (k: string) => (k === 'DPoP-Nonce' ? 'server-nonce-value' : null) },
    }
    // Second call (with nonce) succeeds
    fetchMock
      .mockResolvedValueOnce(nonceChallengeResponse)
      .mockResolvedValueOnce(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))

    let capturedNonce: string | undefined
    const creds: BlueskyCredentials = {
      async getAccessToken() { return 'token' },
      createDPoPProof(_m, _u, _t, nonce) {
        capturedNonce = nonce
        return 'mock-dpop-proof'
      },
    }

    const result = await connector.post(
      { content: 'Hello!', bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      creds,
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(capturedNonce).toBe('server-nonce-value')
    expect(result.success).toBe(true)
  })

  // ── Character limit enforcement ───────────────────────────────────────────────

  it('enforces the 300-grapheme limit', async () => {
    fetchMock.mockResolvedValue(makeOkResponse({ uri: MOCK_URI, cid: MOCK_CID }))
    // Build a string longer than 300 graphemes
    const longContent = 'a'.repeat(350)
    await connector.post(
      { content: longContent, bluesky: { did: MOCK_DID, pdsUrl: MOCK_PDS } },
      makeCredentials(),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { record: { text: string } }
    expect(countGraphemes(body.record.text)).toBeLessThanOrEqual(BLUESKY_CHAR_LIMIT)
  })
})
