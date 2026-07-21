// ── X (Twitter) Agent Service ─────────────────────────────────────────────────
// Agent-based (username/password + client credentials) integration with X, as
// opposed to the user-facing OAuth authorization-code flow implemented in
// `server/utils/platformOAuth.ts` / `server/models/accessTokenStore.ts`.
//
// Agent credentials (see `server/types/agentAuth.ts`) let the server
// authenticate directly with X's OAuth 2.0 token endpoint using a
// password-style grant (mirroring the "script app" model used for Reddit in
// `redditAgentService.ts`), without a browser redirect. This module is
// responsible for:
//   1. Authenticating with stored agent credentials to obtain an access token.
//   2. Posting tweets to X using that token (delegating the actual API call
//      to the existing `TwitterConnector`, so char-limit enforcement, media
//      upload, and response parsing stay in one place).
//   3. Tracking X's rate limits so repeated calls made while X is already
//      rate-limiting this agent fail fast locally instead of hammering the API.
//
// Credentials are never logged — only the platform, HTTP status, and X's own
// (non-sensitive) error code are included in thrown errors.

import type { AgentCredentials } from '../../types/agentAuth.js'
import { TwitterConnector } from '../../../src/services/social/platforms/TwitterConnector.js'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../../../src/services/social/types.js'
import { SocialError } from '../../../src/services/social/types.js'

/** X's OAuth 2.0 token endpoint. */
export const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'

/** X requires a descriptive User-Agent on every API request. */
const X_USER_AGENT = 'AutoMarketer-Agent/1.0'

/** Renew the cached token this many ms before its actual expiry. */
const TOKEN_EXPIRY_SKEW_MS = 60_000

/** Fallback token lifetime (seconds) when X omits `expires_in`. */
const DEFAULT_TOKEN_TTL_SECONDS = 7200

/**
 * Conservative cooldown applied after a 429, used when X's exact reset time
 * isn't available to us (the underlying `SocialError` only carries the HTTP
 * status, not response headers). Matches X's standard 15-minute rate-limit
 * window for user-context endpoints, so we don't hammer the API again before
 * the limit is likely to have cleared.
 */
export const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000

interface XTokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

interface CachedAgentToken {
  accessToken: string
  expiresAt: number // epoch ms
}

// In-memory cache of agent access tokens keyed by clientId+username, so that
// repeated postMessage()/validateCredentials() calls within a token's
// lifetime don't re-authenticate against X's token endpoint on every call.
const tokenCache = new Map<string, CachedAgentToken>()

// In-memory record of an active rate-limit cooldown per credential pair, so
// callers fail fast locally instead of re-hitting X while it is still
// rejecting requests with 429s.
const rateLimitCooldowns = new Map<string, number>() // key -> epoch ms when the cooldown ends

function cacheKey(credentials: AgentCredentials): string {
  return `${credentials.clientId}:${credentials.username}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validate that a value has all fields required for agent authentication.
 * Exported so callers (routes, tests) can fail fast with a clear message
 * instead of an opaque X API error.
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

// ── Rate limit tracking ──────────────────────────────────────────────────────

/**
 * Record that X has rate-limited this credential pair, starting a cooldown
 * after which calls are allowed to reach X again.
 */
function startRateLimitCooldown(key: string, durationMs: number = RATE_LIMIT_COOLDOWN_MS): void {
  rateLimitCooldowns.set(key, Date.now() + Math.max(durationMs, 0))
}

/**
 * Milliseconds remaining in an active rate-limit cooldown for this credential
 * pair, or 0 if there is none (or it has already elapsed).
 */
function rateLimitCooldownRemainingMs(key: string): number {
  const until = rateLimitCooldowns.get(key)
  if (until === undefined) return 0
  const remaining = until - Date.now()
  if (remaining <= 0) {
    rateLimitCooldowns.delete(key)
    return 0
  }
  return remaining
}

/**
 * Throws a non-retryable-until-later `SocialError` if this credential pair is
 * currently within a known rate-limit cooldown, so callers fail fast instead
 * of making a request X will just reject again.
 */
function assertNotRateLimited(key: string): void {
  const remainingMs = rateLimitCooldownRemainingMs(key)
  if (remainingMs > 0) {
    throw new SocialError(
      `X agent requests are rate-limited; retry in ${Math.ceil(remainingMs / 1000)}s`,
      { platform: 'twitter', httpStatus: 429, retryable: true }
    )
  }
}

/** Clear any tracked rate-limit cooldowns. Exported for tests only. */
export function _clearRateLimitCooldowns(): void {
  rateLimitCooldowns.clear()
}

// ── Authentication ────────────────────────────────────────────────────────────

/**
 * Authenticate against X's OAuth 2.0 token endpoint using stored agent
 * credentials, returning a valid access token. Tokens are cached in-memory
 * per clientId/username pair and reused until shortly before they expire.
 *
 * @throws {SocialError} when credentials are malformed, X rejects them,
 *   the agent is currently within a rate-limit cooldown, or the request
 *   otherwise fails.
 */
export async function authenticateAgent(credentials: AgentCredentials): Promise<string> {
  if (!isValidAgentCredentials(credentials)) {
    throw new SocialError(
      'X agent authentication requires username, password, clientId, and clientSecret',
      { platform: 'twitter', retryable: false }
    )
  }

  const key = cacheKey(credentials)
  assertNotRateLimited(key)

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
    response = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
        'User-Agent': X_USER_AGENT,
      },
      body: body.toString(),
    })
  } catch (err) {
    throw new SocialError(
      `Network error authenticating with X: ${err instanceof Error ? err.message : String(err)}`,
      { platform: 'twitter', retryable: true }
    )
  }

  if (response.status === 429) {
    startRateLimitCooldown(key)
  }

  let data: XTokenResponse
  try {
    data = (await response.json()) as XTokenResponse
  } catch (err) {
    throw new SocialError(
      `X returned a non-JSON response during authentication (HTTP ${response.status}): ${
        err instanceof Error ? err.message : String(err)
      }`,
      { platform: 'twitter', httpStatus: response.status, retryable: false }
    )
  }

  if (!response.ok || !data.access_token) {
    // Intentionally omit request body/credentials from the error — only X's
    // own (non-sensitive) error code and HTTP status are surfaced.
    throw new SocialError(
      `X agent authentication failed${data.error ? `: ${data.error}` : ` (HTTP ${response.status})`}`,
      {
        httpStatus: response.status,
        platform: 'twitter',
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
 * Test whether the given agent credentials can authenticate with X.
 * Used by the agent-connect and status routes to confirm credentials work
 * before (or after) they are persisted.
 *
 * Resolves to `false` on any authentication/network/rate-limit failure
 * rather than throwing, so callers can render a simple valid/invalid result;
 * unexpected (non-SocialError) failures are still surfaced as thrown errors.
 */
export async function validateCredentials(credentials: AgentCredentials): Promise<boolean> {
  try {
    await authenticateAgent(credentials)
    return true
  } catch (err) {
    if (err instanceof SocialError) return false
    throw new SocialError(
      `Unexpected error validating X agent credentials: ${err instanceof Error ? err.message : String(err)}`,
      { platform: 'twitter', retryable: false }
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

// ── Posting ───────────────────────────────────────────────────────────────────

/**
 * Post a tweet to X on behalf of an agent, authenticating with the given
 * stored credentials first and delegating the actual submission to
 * {@link TwitterConnector}.
 *
 * If this credential pair is currently within a known rate-limit cooldown
 * (recorded from a previous 429), the request fails fast locally without
 * calling X again; otherwise a 429 response from this call starts a new
 * cooldown for subsequent calls.
 *
 * @throws {SocialError} on invalid credentials, an active rate-limit
 *   cooldown, or an X API failure.
 */
export async function postMessage(
  credentials: AgentCredentials,
  request: SocialPostRequest
): Promise<SocialPostResult> {
  if (!isValidAgentCredentials(credentials)) {
    throw new SocialError(
      'X agent post requires username, password, clientId, and clientSecret',
      { platform: 'twitter', retryable: false }
    )
  }

  const key = cacheKey(credentials)
  assertNotRateLimited(key)

  const connector = new TwitterConnector()
  const provider = new AgentCredentialProvider(credentials)

  try {
    return await connector.post(request, provider)
  } catch (err) {
    if (err instanceof SocialError) {
      if (err.httpStatus === 429) {
        startRateLimitCooldown(key)
      }
      throw err
    }
    throw new SocialError(
      `Unexpected error posting to X via agent credentials: ${err instanceof Error ? err.message : String(err)}`,
      { platform: 'twitter', retryable: false }
    )
  }
}

/** Clear cached agent tokens. Exported for tests only. */
export function _clearTokenCache(): void {
  tokenCache.clear()
}
