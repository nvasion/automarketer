// ── OAuth token refresh ──────────────────────────────────────────────────────
// Exchanges a stored refresh token for a fresh access token using the OAuth 2.0
// `refresh_token` grant, so connections don't go stale when the short-lived
// access token expires (X ~2h, Reddit ~1h, LinkedIn ~60d, Bluesky ~1h).
//
// Per-platform quirks:
//   - Reddit & X authenticate the refresh request with HTTP Basic auth.
//   - X ROTATES the refresh token (returns a new one each time) — callers MUST
//     persist the returned refresh_token.
//   - LinkedIn passes client credentials in the body and only issues refresh
//     tokens when the app is enrolled in refresh tokens.
//   - Bluesky uses DPoP (RFC 9449) — no client secret; the stored ES256 private
//     key is used to sign a DPoP proof for each token request.

import { getPlatformClientId, getPlatformClientSecret } from './platformOAuth.js';
import { createDPoPProof, fetchAuthServerMetadata } from './blueskyOAuth.js';

export interface RefreshResult {
  accessToken: string;
  expiresAt?: string;
  /** Present when the provider rotates the refresh token (e.g. X). */
  refreshToken?: string;
}

/** Extra params required only for Bluesky's DPoP-based refresh flow. */
export interface BlueskyRefreshMeta {
  /** ES256 private key JWK used to sign DPoP proofs. */
  dpopPrivateKeyJwk: string;
  /** PDS base URL (used to discover the token endpoint). */
  pdsUrl: string;
}

/**
 * Refresh an access token for a platform. Returns the new token (and possibly a
 * rotated refresh token), or null when refresh is unsupported, unconfigured, or
 * rejected by the provider. Never throws — callers treat null as "reconnect".
 *
 * @param platform       The platform identifier (e.g. "bluesky", "twitter").
 * @param refreshToken   The stored refresh token.
 * @param blueskyMeta    Required when platform === "bluesky". Contains the
 *                       DPoP key JWK and PDS URL needed to construct the request.
 */
export async function refreshAccessToken(
  platform: string,
  refreshToken: string,
  blueskyMeta?: BlueskyRefreshMeta,
): Promise<RefreshResult | null> {
  // ── Bluesky (AT Protocol OAuth with DPoP) ────────────────────────────────
  if (platform === 'bluesky') {
    return refreshBlueskyToken(refreshToken, blueskyMeta);
  }

  // ── Standard OAuth 2.0 platforms ─────────────────────────────────────────
  const clientId = getPlatformClientId(platform);
  if (!clientId) {
    console.warn(`[tokenRefresh] cannot refresh ${platform}: client ID not configured.`);
    return null;
  }
  const clientSecret = getPlatformClientSecret(platform);

  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken };
  let tokenUrl: string;

  switch (platform) {
    case 'reddit':
      tokenUrl = 'https://www.reddit.com/api/v1/access_token';
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      headers['User-Agent'] = 'AutoMarketer/1.0';
      break;
    case 'twitter':
      tokenUrl = 'https://api.twitter.com/2/oauth2/token';
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      break;
    case 'linkedin':
      tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
      body.client_id = clientId;
      body.client_secret = clientSecret;
      break;
    default:
      console.warn(`[tokenRefresh] refresh not supported for platform "${platform}".`);
      return null;
  }

  let res: Response;
  try {
    res = await fetch(tokenUrl, { method: 'POST', headers, body: new URLSearchParams(body).toString() });
  } catch (err) {
    console.error(`[tokenRefresh] network error refreshing ${platform}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[tokenRefresh] ${platform} refresh failed: HTTP ${res.status} — ${text}`);
    return null;
  }

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!data.access_token) {
    console.error(`[tokenRefresh] ${platform} refresh returned no access_token.`);
    return null;
  }

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
    refreshToken: data.refresh_token,
  };
}

// ── Bluesky token refresh ─────────────────────────────────────────────────────

async function refreshBlueskyToken(
  refreshToken: string,
  meta: BlueskyRefreshMeta | undefined,
): Promise<RefreshResult | null> {
  if (!meta) {
    console.warn('[tokenRefresh] bluesky refresh skipped: missing DPoP key / PDS URL metadata.');
    return null;
  }

  const clientId = process.env.BLUESKY_CLIENT_ID?.trim();
  if (!clientId) {
    console.warn('[tokenRefresh] bluesky refresh skipped: BLUESKY_CLIENT_ID not configured.');
    return null;
  }

  let tokenEndpoint: string;
  try {
    const authMeta = await fetchAuthServerMetadata(meta.pdsUrl);
    tokenEndpoint = authMeta.token_endpoint;
  } catch (err) {
    console.error(`[tokenRefresh] bluesky: failed to discover token endpoint from PDS "${meta.pdsUrl}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  let privateKeyJwk: JsonWebKey;
  try {
    privateKeyJwk = JSON.parse(meta.dpopPrivateKeyJwk) as JsonWebKey;
  } catch {
    console.error('[tokenRefresh] bluesky: stored DPoP key JWK is not valid JSON — reconnect required.');
    return null;
  }

  // We need the public key JWK to embed in the DPoP header. Derive it from the
  // private key by stripping the private component (`d`).
  const { d: _d, ...publicKeyJwk } = privateKeyJwk as JsonWebKey & { d?: string };

  const htu = tokenEndpoint.split('?')[0];

  const makeRequest = async (nonce?: string): Promise<Response> => {
    const dpopProof = createDPoPProof(privateKeyJwk, publicKeyJwk, 'POST', htu, nonce);
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': dpopProof,
        'User-Agent': 'AutoMarketer/1.0',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });
  };

  let res: Response;
  try {
    res = await makeRequest();
    // Handle DPoP nonce challenge — retry once with the server-supplied nonce.
    if (!res.ok) {
      const nonce = res.headers.get('DPoP-Nonce');
      if (nonce) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        if (errBody.error === 'use_dpop_nonce') {
          res = await makeRequest(nonce);
        }
      }
    }
  } catch (err) {
    console.error(`[tokenRefresh] bluesky network error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[tokenRefresh] bluesky refresh failed: HTTP ${res.status} — ${text}`);
    return null;
  }

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (!data.access_token) {
    console.error('[tokenRefresh] bluesky refresh returned no access_token.');
    return null;
  }

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
    refreshToken: data.refresh_token,
  };
}
