// ── OAuth token refresh ──────────────────────────────────────────────────────
// Exchanges a stored refresh token for a fresh access token using the OAuth 2.0
// `refresh_token` grant, so connections don't go stale when the short-lived
// access token expires (X ~2h, Reddit ~1h, LinkedIn ~60d).
//
// Per-platform quirks:
//   - Reddit & X authenticate the refresh request with HTTP Basic auth.
//   - X ROTATES the refresh token (returns a new one each time) — callers MUST
//     persist the returned refresh_token.
//   - LinkedIn passes client credentials in the body and only issues refresh
//     tokens when the app is enrolled in refresh tokens.

import { getPlatformClientId, getPlatformClientSecret } from './platformOAuth.js';

export interface RefreshResult {
  accessToken: string;
  expiresAt?: string;
  /** Present when the provider rotates the refresh token (e.g. X). */
  refreshToken?: string;
}

/**
 * Refresh an access token for a platform. Returns the new token (and possibly a
 * rotated refresh token), or null when refresh is unsupported, unconfigured, or
 * rejected by the provider. Never throws — callers treat null as "reconnect".
 */
export async function refreshAccessToken(
  platform: string,
  refreshToken: string,
): Promise<RefreshResult | null> {
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
