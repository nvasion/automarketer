import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  authenticateAgent,
  validateCredentials,
  postMessage,
  isValidAgentCredentials,
  REDDIT_TOKEN_URL,
  _clearTokenCache,
} from '../../../server/services/social/redditAgentService'
import { SocialError } from '../../../src/services/social/types'
import type { AgentCredentials } from '../../../server/types/agentAuth'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CREDENTIALS: AgentCredentials = {
  username: 'agent-user',
  password: 'super-secret',
  clientId: 'client-id',
  clientSecret: 'client-secret',
}

function makeOkResponse(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function makeErrorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function tokenResponseBody(overrides: Partial<{ access_token: string; expires_in: number }> = {}) {
  return {
    access_token: 'agent-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    scope: 'submit',
    ...overrides,
  }
}

function submitResponseBody() {
  return { json: { data: { id: 'abc123', url: 'https://reddit.com/r/test/comments/abc123/' }, errors: [] } }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('redditAgentService', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    _clearTokenCache()
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

    it('requests a token from the Reddit OAuth endpoint', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody()))
      await authenticateAgent(VALID_CREDENTIALS)
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe(REDDIT_TOKEN_URL)
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

    it('throws SocialError with platform "reddit" on non-ok response', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(401, { error: 'invalid_grant' }))
      try {
        await authenticateAgent(VALID_CREDENTIALS)
        expect.unreachable('authenticateAgent should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(SocialError)
        expect((err as SocialError).platform).toBe('reddit')
        expect((err as SocialError).httpStatus).toBe(401)
        expect((err as SocialError).apiErrorCode).toBe('invalid_grant')
      }
    })

    it('marks 429/5xx responses as retryable and 4xx responses as non-retryable', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(429, { error: 'RATELIMIT' }))
      try {
        await authenticateAgent(VALID_CREDENTIALS)
        expect.unreachable('authenticateAgent should have thrown')
      } catch (err) {
        expect((err as SocialError).retryable).toBe(true)
      }

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
        postMessage(
          { username: '', password: '', clientId: '', clientSecret: '' },
          { content: 'Hello', reddit: { subreddit: 'test', title: 'Title' } }
        )
      ).rejects.toThrow(SocialError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('authenticates then submits the post, returning the connector result', async () => {
      fetchMock
        .mockResolvedValueOnce(makeOkResponse(tokenResponseBody({ access_token: 'tok-post' })))
        .mockResolvedValueOnce(makeOkResponse(submitResponseBody()))

      const result = await postMessage(VALID_CREDENTIALS, {
        content: 'Hello Reddit!',
        reddit: { subreddit: 'test', title: 'My Post' },
      })

      expect(result.success).toBe(true)
      expect(result.postId).toBe('abc123')
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // First call authenticates, second call submits with the resulting token.
      const [submitUrl, submitInit] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }]
      expect(submitUrl).toContain('/api/submit')
      expect(submitInit.headers.Authorization).toBe('Bearer tok-post')
    })

    it('propagates SocialError from the connector when the request is invalid', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(tokenResponseBody()))
      await expect(
        postMessage(VALID_CREDENTIALS, { content: 'Hello', reddit: { subreddit: '', title: 'Title' } })
      ).rejects.toThrow(SocialError)
    })

    it('propagates SocialError when authentication fails before posting', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(401, { error: 'invalid_grant' }))
      await expect(
        postMessage(VALID_CREDENTIALS, { content: 'Hello', reddit: { subreddit: 'test', title: 'Title' } })
      ).rejects.toThrow(SocialError)
    })

    it('propagates SocialError when Reddit rejects the submission', async () => {
      fetchMock
        .mockResolvedValueOnce(makeOkResponse(tokenResponseBody()))
        .mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'))
      await expect(
        postMessage(VALID_CREDENTIALS, { content: 'Hello', reddit: { subreddit: 'locked', title: 'Title' } })
      ).rejects.toThrow(SocialError)
    })
  })
})
