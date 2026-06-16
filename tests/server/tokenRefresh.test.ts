// @vitest-environment node
/**
 * Tests for automatic OAuth token refresh:
 *   - refreshAccessToken() against the provider token endpoint (mocked fetch)
 *   - accessTokenStore.getValidAccessToken() refreshing an expired token
 *
 * Runs in-memory (DATABASE_URL unset) and mocks global fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { refreshAccessToken } from '../../server/utils/tokenRefresh'
import { accessTokenStore } from '../../server/models/accessTokenStore'

const USER = 'user-1'

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  accessTokenStore._clear()
  for (const k of ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET']) {
    savedEnv[k] = process.env[k]
  }
  process.env.REDDIT_CLIENT_ID = 'rid'
  process.env.REDDIT_CLIENT_SECRET = 'rsecret'
  process.env.TWITTER_CLIENT_ID = 'tid'
  process.env.TWITTER_CLIENT_SECRET = 'tsecret'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  accessTokenStore._clear()
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('refreshAccessToken()', () => {
  it('returns null for an unsupported platform', async () => {
    expect(await refreshAccessToken('facebook', 'rt')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the new token on a successful Reddit refresh', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { access_token: 'fresh', expires_in: 3600 }))
    const result = await refreshAccessToken('reddit', 'rt')
    expect(result?.accessToken).toBe('fresh')
    expect(result?.expiresAt).toBeTruthy()
    // Reddit authenticates with HTTP Basic.
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
  })

  it('returns null when the provider rejects the refresh', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(400, { error: 'invalid_grant' }))
    expect(await refreshAccessToken('reddit', 'bad')).toBeNull()
  })
})

describe('accessTokenStore.getValidAccessToken()', () => {
  it('returns an unexpired token without refreshing', async () => {
    await accessTokenStore.setAccessToken(USER, 'reddit', 'good', {
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshToken: 'rt',
    })
    expect(await accessTokenStore.getValidAccessToken(USER, 'reddit')).toBe('good')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes an expired token and stores the new one', async () => {
    await accessTokenStore.setAccessToken(USER, 'reddit', 'stale', {
      expiresAt: '2000-01-01T00:00:00.000Z',
      refreshToken: 'rt',
    })
    fetchMock.mockResolvedValueOnce(jsonRes(200, { access_token: 'renewed', expires_in: 3600 }))

    const token = await accessTokenStore.getValidAccessToken(USER, 'reddit')
    expect(token).toBe('renewed')
    // The store now holds the renewed, unexpired token.
    expect(accessTokenStore.getAccessToken(USER, 'reddit')).toBe('renewed')
    expect(accessTokenStore.listConnectedPlatforms(USER)).toContain('reddit')
  })

  it('persists a rotated refresh token (X) so the next refresh uses the new one', async () => {
    await accessTokenStore.setAccessToken(USER, 'twitter', 'stale', {
      expiresAt: '2000-01-01T00:00:00.000Z',
      refreshToken: 'old-rt',
    })
    fetchMock.mockResolvedValueOnce(jsonRes(200, { access_token: 'a2', expires_in: 1, refresh_token: 'new-rt' }))
    await accessTokenStore.getValidAccessToken(USER, 'twitter')

    // a2 expires in ~1s, so the next call refreshes again — using the rotated token.
    fetchMock.mockResolvedValueOnce(jsonRes(200, { access_token: 'a3', expires_in: 3600 }))
    await accessTokenStore.getValidAccessToken(USER, 'twitter')

    const secondBody = String(fetchMock.mock.calls[1][1].body)
    expect(secondBody).toContain('refresh_token=new-rt')
  })

  it('returns null when expired with no refresh token', async () => {
    await accessTokenStore.setAccessToken(USER, 'reddit', 'stale', {
      expiresAt: '2000-01-01T00:00:00.000Z',
    })
    expect(await accessTokenStore.getValidAccessToken(USER, 'reddit')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
