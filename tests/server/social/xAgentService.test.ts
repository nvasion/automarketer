import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  authenticateAgent,
  validateCredentials,
  postMessage,
  isValidAgentCredentials,
  X_TOKEN_URL,
  RATE_LIMIT_COOLDOWN_MS,
  _clearTokenCache,
  _clearRateLimitCooldowns,
} from '../../../server/services/social/xAgentService'
import { SocialError } from '../../../src/services/social/types'
import type { AgentCredentials } from '../../../server/types/agentAuth'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CREDENTIALS: AgentCredentials = {
  username: 'agent-user',
  password: 'super-secret',
  clientId: 'client-id',
  clientSecret: 'client-secret',
}

function makeOkResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function makeErrorResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function tokenResponseBody(overrides: Partial<{ access_token: string; expires_in: number }> = {}) {
  return {
    access_token: 'agent-access-token',
    token_type: 'bearer',
    expires_in: 7200,
    scope: 'tweet.write',
    ...overrides,
  }
}

function tweetResponseBody() {
  return { data: { id: 'tweet-123', text: 'Hello X!' } }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('xAgentService', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    _clearTokenCache()
    _clearRateLimitCooldowns()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── isValidAgentCredentials ────────────────────────────────────────────────

  describe('isValidAgentCredentials', () => {
    it('accepts a fully populated credentials object', () => {
      expect(isValidAgentCredentials(VALID_CREDENTIALS)).toBe(true)
    })

    it('rejects null/undefined/non-object values', () => {
      expect(isValidAgentCredentials(null)).toBe(false)
      expect(isValidAgentCredentials(undefined)).toBe(false)
      expect(isValidAgentCredentials('a string')).toBe(false)
      expect(isValidAgentCredentials(42)).toBe(false)
    })

    it.each(['username', 'password', 'clientId', 'clientSecret'] as const)(
      'rejects credentials missing %s',
      (field) => {
        const creds = { ...VALID_CREDENTIALS, [field]: '' }
        expect(isValidAgentCredentials(creds)).toBe(false)
      }
    )

    it('rejects credentials with whitespace-only fields', () => {
      expect(isValidAgentCredentials({ ...VALID_CREDENTIALS, username: '   ' })).toBe(false)
    })
  })

  // ── authenticateAgent ──────────────────────────────────────────────────────

  describe('authenticateAgent', () => {
    it('throws SocialError for invalid credentials without making a network call', async () => {
      await expect(
        authenticateAgent({ username: '', password: '', clientId: '', clientSecret: '' })
      ).rejects.toThrow(SocialError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('requests a token from the X OAuth endpoint', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody()))
      await authenticateAgent(VALID_CREDENTIALS)
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe(X_TOKEN_URL)
    })

    it('sends grant_type=password with username and password in the body', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody()))
      await authenticateAgent(VALID_CREDENTIALS)
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const params = new URLSearchParams(init.body as string)
      expect(params.get('grant_type')).toBe('password')
      expect(params.get('username')).toBe(VALID_CREDENTIALS.username)
      expect(params.get('password')).toBe(VALID_CREDENTIALS.password)
    })

    it('sends HTTP Basic auth built from clientId and clientSecret', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody()))
      await authenticateAgent(VALID_CREDENTIALS)
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
      const expected = `Basic ${Buffer.from(`${VALID_CREDENTIALS.clientId}:${VALID_CREDENTIALS.clientSecret}`).toString('base64')}`
      expect(init.headers.Authorization).toBe(expected)
    })

    it('returns the access token on success', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody({ access_token: 'tok-123' })))
      const token = await authenticateAgent(VALID_CREDENTIALS)
      expect(token).toBe('tok-123')
    })

    it('caches the token and does not re-authenticate on a second call', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody({ access_token: 'tok-cached' })))
      const first = await authenticateAgent(VALID_CREDENTIALS)
      const second = await authenticateAgent(VALID_CREDENTIALS)
      expect(first).toBe('tok-cached')
      expect(second).toBe('tok-cached')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('re-authenticates once the cached token has expired', async () => {
      fetchMock
        .mockResolvedValueOnce(makeOkResponse(tokenResponseBody({ access_token: 'tok-1', expires_in: -10 })))
        .mockResolvedValueOnce(makeOkResponse(tokenResponseBody({ access_token: 'tok-2' })))
      const first = await authenticateAgent(VALID_CREDENTIALS)
      const second = await authenticateAgent(VALID_CREDENTIALS)
      expect(first).toBe('tok-1')
      expect(second).toBe('tok-2')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('throws SocialError with platform "twitter" on non-ok response', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(401, { error: 'invalid_grant' }))
      try {
        await authenticateAgent(VALID_CREDENTIALS)
        expect.unreachable('authenticateAgent should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(SocialError)
        expect((err as SocialError).platform).toBe('twitter')
        expect((err as SocialError).httpStatus).toBe(401)
        expect((err as SocialError).apiErrorCode).toBe('invalid_grant')
      }
    })

    it('marks 429/5xx responses as retryable and 4xx responses as non-retryable', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(429, { error: 'RATE_LIMITED' }))
      try {
        await authenticateAgent(VALID_CREDENTIALS)
        expect.unreachable('authenticateAgent should have thrown')
      } catch (err) {
        expect((err as SocialError).retryable).toBe(true)
      }

      _clearRateLimitCooldowns()
      fetchMock.mockResolvedValue(makeErrorResponse(403, { error: 'FORBIDDEN' }))
      try {
        await authenticateAgent(VALID_CREDENTIALS)
        expect.unreachable('authenticateAgent should have thrown')
      } catch (err) {
        expect((err as SocialError).retryable).toBe(false)
      }
    })

    it('never includes the password in a thrown error message', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(401, { error: 'invalid_grant' }))
      try {
        await authenticateAgent(VALID_CREDENTIALS)
        expect.unreachable('authenticateAgent should have thrown')
      } catch (err) {
        expect((err as SocialError).message).not.toContain(VALID_CREDENTIALS.password)
      }
    })

    it('throws SocialError on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
      await expect(authenticateAgent(VALID_CREDENTIALS)).rejects.toThrow(SocialError)
    })

    it('throws SocialError when the response body is not valid JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('Unexpected token')),
        text: () => Promise.resolve('not json'),
      })
      await expect(authenticateAgent(VALID_CREDENTIALS)).rejects.toThrow(SocialError)
    })

    it('throws SocialError when the response is ok but omits access_token', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ token_type: 'bearer' }))
      await expect(authenticateAgent(VALID_CREDENTIALS)).rejects.toThrow(SocialError)
    })
  })

  // ── validateCredentials ────────────────────────────────────────────────────

  describe('validateCredentials', () => {
    it('resolves true when authentication succeeds', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody()))
      await expect(validateCredentials(VALID_CREDENTIALS)).resolves.toBe(true)
    })

    it('resolves false when authentication fails with a SocialError', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(401, { error: 'invalid_grant' }))
      await expect(validateCredentials(VALID_CREDENTIALS)).resolves.toBe(false)
    })

    it('resolves false for malformed credentials rather than throwing', async () => {
      await expect(
        validateCredentials({ username: '', password: '', clientId: '', clientSecret: '' })
      ).resolves.toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('resolves false on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))
      await expect(validateCredentials(VALID_CREDENTIALS)).resolves.toBe(false)
    })
  })

  // ── postMessage ─────────────────────────────────────────────────────────────

  describe('postMessage', () => {
    it('throws SocialError for invalid credentials without making a network call', async () => {
      await expect(
        postMessage({ username: '', password: '', clientId: '', clientSecret: '' }, { content: 'Hello' })
      ).rejects.toThrow(SocialError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('authenticates then submits the tweet, returning the connector result', async () => {
      fetchMock
        .mockResolvedValueOnce(makeOkResponse(tokenResponseBody({ access_token: 'tok-post' })))
        .mockResolvedValueOnce(makeOkResponse(tweetResponseBody()))

      const result = await postMessage(VALID_CREDENTIALS, { content: 'Hello X!' })

      expect(result.success).toBe(true)
      expect(result.postId).toBe('tweet-123')
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // First call authenticates, second call submits with the resulting token.
      const [tweetUrl, tweetInit] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }]
      expect(tweetUrl).toContain('/2/tweets')
      expect(tweetInit.headers.Authorization).toBe('Bearer tok-post')
    })

    it('propagates SocialError when authentication fails before posting', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(401, { error: 'invalid_grant' }))
      await expect(postMessage(VALID_CREDENTIALS, { content: 'Hello' })).rejects.toThrow(SocialError)
    })

    it('propagates SocialError when X rejects the submission', async () => {
      fetchMock
        .mockResolvedValueOnce(makeOkResponse(tokenResponseBody()))
        .mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'))
      await expect(postMessage(VALID_CREDENTIALS, { content: 'Hello' })).rejects.toThrow(SocialError)
    })

    // ── Rate limit handling ───────────────────────────────────────────────────

    // The underlying TwitterConnector retries 429s internally (with real
    // delays) before giving up, so these tests use fake timers to fast-forward
    // through that built-in backoff and reach the final rejection instantly.

    it('starts a cooldown after a 429 from the post endpoint, and fails fast on the next call', async () => {
      vi.useFakeTimers()
      try {
        fetchMock
          .mockResolvedValueOnce(makeOkResponse(tokenResponseBody({ access_token: 'tok-rl' })))
          .mockResolvedValue(makeErrorResponse(429, { title: 'Too Many Requests' }))

        const firstCall = postMessage(VALID_CREDENTIALS, { content: 'Hello' }).catch((err: unknown) => err)
        await vi.runAllTimersAsync()
        const firstError = await firstCall
        expect(firstError).toBeInstanceOf(SocialError)

        // Next call should short-circuit locally (no extra fetch calls) because
        // we're within the cooldown window recorded from the 429 above.
        const callsBefore = fetchMock.mock.calls.length
        try {
          await postMessage(VALID_CREDENTIALS, { content: 'Hello again' })
          expect.unreachable('postMessage should have thrown while rate-limited')
        } catch (err) {
          expect(err).toBeInstanceOf(SocialError)
          expect((err as SocialError).httpStatus).toBe(429)
          expect((err as SocialError).retryable).toBe(true)
        }
        expect(fetchMock.mock.calls.length).toBe(callsBefore)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not rate-limit a different credential pair', async () => {
      vi.useFakeTimers()
      try {
        fetchMock
          .mockResolvedValueOnce(makeOkResponse(tokenResponseBody({ access_token: 'tok-rl' })))
          .mockResolvedValue(makeErrorResponse(429, { title: 'Too Many Requests' }))

        const firstCall = postMessage(VALID_CREDENTIALS, { content: 'Hello' }).catch((err: unknown) => err)
        await vi.runAllTimersAsync()
        const firstError = await firstCall
        expect(firstError).toBeInstanceOf(SocialError)
      } finally {
        vi.useRealTimers()
      }

      const otherCredentials: AgentCredentials = { ...VALID_CREDENTIALS, username: 'someone-else' }
      fetchMock
        .mockResolvedValueOnce(makeOkResponse(tokenResponseBody({ access_token: 'tok-other' })))
        .mockResolvedValueOnce(makeOkResponse(tweetResponseBody()))

      const result = await postMessage(otherCredentials, { content: 'Hi from someone else' })
      expect(result.success).toBe(true)
    })

    it('exposes the standard 15-minute cooldown window', () => {
      expect(RATE_LIMIT_COOLDOWN_MS).toBe(15 * 60 * 1000)
    })
  })
})
