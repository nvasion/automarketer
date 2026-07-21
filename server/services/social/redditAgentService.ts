// ── Reddit Agent Service ──────────────────────────────────────────────────────
// Agent-based (username/password + script-app client credentials) integration
// with Reddit, as opposed to the user-facing OAuth authorization-code flow
// implemented in `server/utils/platformOAuth.ts` / `server/models/accessTokenStore.ts`.
//
// Agent credentials (see `server/types/agentAuth.ts`) let the server
// authenticate directly with Reddit's OAuth "password" grant (the flow Reddit
// documents for "script" type apps: https://github.com/reddit-archive/reddit/wiki/OAuth2#authorization-implicit-grant-flow),
// without a browser redirect. This module is responsible for:
//   1. Authenticating with stored agent credentials to obtain an access token.
//   2. Posting messages to Reddit using that token.
//   3. Translating Reddit/network failures into `SocialError`s with context.
//
// Credentials are never logged — only the platform, HTTP status, and Reddit's
// own (non-sensitive) error code are included in thrown errors.

import type { AgentCredentials } from '../../types/agentAuth.js'
import { RedditConnector } from '../../../src/services/social/platforms/RedditConnector.js'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../../../src/services/social/types.js'
import { SocialError } from '../../../src/services/social/types.js'

/** Reddit's OAuth token endpoint (script-app "password" grant). */
export const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'

/** Reddit requires a descriptive User-Agent on every API request. */
const REDDIT_USER_AGENT = 'AutoMarketer-Agent/1.0'

/** Renew the cached token this many ms before its actual expiry. */
const TOKEN_EXPIRY_SKEW_MS = 60_000

/** Fallback token lifetime (seconds) when Reddit omits `expires_in`. */
const DEFAULT_TOKEN_TTL_SECONDS = 3600

interface RedditTokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
}

interface CachedAgentToken {
  accessToken: string
  expiresAt: number // epoch ms
}

// In-memory cache of agent access tokens keyed by clientId+username, so that
// repeated postMessage()/validateCredentials() calls within a token's
// lifetime don't re-authenticate against Reddit's token endpoint on every
// call (the password grant is rate-limited separately from the submit API).
const tokenCache = new Map<string, CachedAgentToken>()

function cacheKey(credentials: AgentCredentials): string {
  return `${credentials.clientId}:${credentials.username}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validate that a value has all fields required for agent authentication.
 * Exported so callers (routes, tests) can fail fast with a clear message
 * instead of an opaque Reddit API error.
 */
export function isValidAgentCredentials(credentials: unknown): credentials is AgentCredentials {
  if (!credentials || typeof credentials !== 'object') return false
  const c = credentials as Record<string, unknown>
  return (
    isNonEmptyString(c.username) &&
    isNonEmptyString(c.password) &&
    isNonEmptyString(c.clientId) &&
    isNonEmptyString(c.clientSecret)
  )
}

/**
 * Authenticate against Reddit's OAuth "password" grant using stored agent
 * credentials, returning a valid access token. Tokens are cached in-memory
 * per clientId/username pair and reused until shortly before they expire.
 *
 * @throws {SocialError} when credentials are malformed, Reddit rejects them,
 *   or the request otherwise fails.
 */
export async function authenticateAgent(credentials: AgentCredentials): Promise<string> {
  if (!isValidAgentCredentials(credentials)) {
    throw new SocialError(
      'Reddit agent authentication requires username, password, clientId, and clientSecret',
      { platform: 'reddit', retryable: false }
    )
  }

  const key = cacheKey(credentials)
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username: credentials.username,
    password: credentials.password,
  })

  let response: Response
  try {
    response = await fetch(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
        'User-Agent': REDDIT_USER_AGENT,
      },
      body: body.toString(),
    })
  } catch (err) {
    throw new SocialError(
      `Network error authenticating with Reddit: ${err instanceof Error ? err.message : String(err)}`,
      { platform: 'reddit', retryable: true }
    )
  }

  let data: RedditTokenResponse
  try {
    data = (await response.json()) as RedditTokenResponse
  } catch (err) {
    throw new SocialError(
      `Reddit returned a non-JSON response during authentication (HTTP ${response.status}): ${
        err instanceof Error ? err.message : String(err)
      }`,
      { platform: 'reddit', httpStatus: response.status, retryable: false }
    )
  }

  if (!response.ok || !data.access_token) {
    // Intentionally omit request body/credentials from the error — only
    // Reddit's own (non-sensitive) error code and HTTP status are surfaced.
    throw new SocialError(
      `Reddit agent authentication failed${data.error ? `: ${data.error}` : ` (HTTP ${response.status})`}`,
      {
        platform: 'reddit',
        httpStatus: response.status,
        apiErrorCode: data.error,
        retryable: response.status === 429 || response.status >= 500,
      }
    )
  }

  const ttlSeconds = data.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS
  tokenCache.set(key, {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(ttlSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS, 0),
  })

  return data.access_token
}

/**
 * Test whether the given agent credentials can authenticate with Reddit.
 * Used by the agent-connect and status routes to confirm credentials work
 * before (or after) they are persisted.
 *
 * Resolves to `false` on any authentication/network failure rather than
 * throwing, so callers can render a simple valid/invalid result; unexpected
 * (non-SocialError) failures are still surfaced as thrown errors.
 */
export async function validateCredentials(credentials: AgentCredentials): Promise<boolean> {
  try {
    await authenticateAgent(credentials)
    return true
  } catch (err) {
    if (err instanceof SocialError) return false
    throw new SocialError(
      `Unexpected error validating Reddit agent credentials: ${err instanceof Error ? err.message : String(err)}`,
      { platform: 'reddit', retryable: false }
    )
  }
}

/**
 * `CredentialProvider` backed by agent credentials — authenticates lazily
 * (and caches) the first time `getAccessToken()` is called.
 */
class AgentCredentialProvider implements CredentialProvider {
  constructor(private readonly credentials: AgentCredentials) {}

  async getAccessToken(): Promise<string> {
    return authenticateAgent(this.credentials)
  }
}

/**
 * Post a message to Reddit on behalf of an agent, authenticating with the
 * given stored credentials first and delegating the actual submission to
 * {@link RedditConnector}.
 *
 * @throws {SocialError} on invalid credentials, an invalid request (missing
 *   subreddit/title), or a Reddit API failure.
 */
export async function postMessage(
  credentials: AgentCredentials,
  request: SocialPostRequest
): Promise<SocialPostResult> {
  if (!isValidAgentCredentials(credentials)) {
    throw new SocialError(
      'Reddit agent post requires username, password, clientId, and clientSecret',
      { platform: 'reddit', retryable: false }
    )
  }

  const connector = new RedditConnector()
  const provider = new AgentCredentialProvider(credentials)

  try {
    return await connector.post(request, provider)
  } catch (err) {
    if (err instanceof SocialError) throw err
    throw new SocialError(
      `Unexpected error posting to Reddit via agent credentials: ${err instanceof Error ? err.message : String(err)}`,
      { platform: 'reddit', retryable: false }
    )
  }
}

/** Clear cached agent tokens. Exported for tests only. */
export function _clearTokenCache(): void {
  tokenCache.clear()
}
