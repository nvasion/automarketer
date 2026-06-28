// ── Platform OAuth configuration (shared-app model) ───────────────────────────
// AutoMarketer registers ONE OAuth app per platform. Both the client ID and the
// client secret for each platform come from server environment variables and are
// shared across all users — users simply click "Connect" and never paste any
// OAuth app credentials.
//
//   <PLATFORM>_CLIENT_ID      — public identifier, safe to serve to the browser
//                               (it appears in every OAuth redirect URL).
//   <PLATFORM>_CLIENT_SECRET  — confidential, used server-side only to exchange
//                               authorization codes for access tokens.
//
// In development/test, a missing secret falls back to an insecure placeholder
// with a warning so the app still boots. In production, missing secrets throw.
// Client IDs never fall back — an unset client ID simply means that platform is
// not available to connect.

const DEV_FALLBACK_SECRET = 'dev-secret-change-in-production';

/** Platforms that support an OAuth connect flow. Instagram is configured under
 *  the same Meta app as Facebook, so it shares Facebook's credentials.
 *  Bluesky uses AT Protocol OAuth where the client_id is the URL of the client
 *  metadata document (BLUESKY_CLIENT_ID env var); no client secret is needed. */
export const OAUTH_PLATFORMS = ['linkedin', 'twitter', 'reddit', 'facebook', 'instagram', 'bluesky'] as const;
export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

/** Maps a platform to the env-var prefix that holds its credentials. Instagram
 *  reuses Meta's app credentials. */
function envPrefix(platform: string): string {
  if (platform === 'instagram' || platform === 'facebook') return 'META';
  return platform.toUpperCase();
}

/**
 * Returns the OAuth client ID for a platform, or '' when not configured.
 * Client IDs are public, so this value is safe to serve to the browser.
 */
export function getPlatformClientId(platform: string): string {
  return process.env[`${envPrefix(platform)}_CLIENT_ID`]?.trim() ?? '';
}

/**
 * Whether a platform uses a client secret for OAuth. Bluesky uses DPoP instead
 * of a client secret — it is a public client with no shared secret.
 */
function platformUsesClientSecret(platform: string): boolean {
  return platform !== 'bluesky';
}

/**
 * Returns the OAuth client secret for a platform.
 *
 * - Production: throws when the secret is not set (except for Bluesky).
 * - Development/test: returns an insecure dev fallback and warns.
 * - Bluesky: returns an empty string — it uses DPoP, no secret needed.
 */
export function getPlatformClientSecret(platform: string): string {
  if (!platformUsesClientSecret(platform)) return '';

  const secret = process.env[`${envPrefix(platform)}_CLIENT_SECRET`];
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `OAuth client secret not configured for platform: ${platform}. ` +
        `Set ${envPrefix(platform)}_CLIENT_SECRET in your environment.`,
    );
  }
  console.warn(
    `[platformOAuth] ${envPrefix(platform)}_CLIENT_SECRET not set — using dev fallback. ` +
      `Set ${envPrefix(platform)}_CLIENT_SECRET in your .env file for ${platform} publishing to work.`,
  );
  return DEV_FALLBACK_SECRET;
}

/**
 * Whether a platform is fully configured for OAuth.
 *
 * For standard platforms: requires BOTH a client ID and a client secret.
 * For Bluesky: only requires BLUESKY_CLIENT_ID (the metadata document URL);
 *   no client secret is used — DPoP proves possession instead.
 */
export function isPlatformConfigured(platform: string): boolean {
  const hasClientId = getPlatformClientId(platform).length > 0;
  if (!platformUsesClientSecret(platform)) return hasClientId;
  const hasSecret = Boolean(process.env[`${envPrefix(platform)}_CLIENT_SECRET`]);
  return hasClientId && hasSecret;
}

/**
 * Resolve a LinkedIn member URN (the publishing author ID) from an access token
 * via the OpenID Connect userinfo endpoint. Returns undefined when the lookup
 * fails (e.g. the "Sign In with LinkedIn using OpenID Connect" product is not
 * approved); callers log the failure. Shared by the OAuth connect flow and the
 * publish route's on-demand fallback so the two stay in sync.
 *
 *   https://api.linkedin.com/v2/userinfo → { sub } → "urn:li:person:{sub}"
 */
export async function resolveLinkedInAuthorId(accessToken: string): Promise<string | undefined> {
  const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) {
    console.warn(
      `[oauth] LinkedIn userinfo request failed: HTTP ${meRes.status} — publishing will fail until an author ID is available. ` +
        'Ensure the "Sign In with LinkedIn using OpenID Connect" product is approved (openid + profile scopes).',
    );
    return undefined;
  }
  const info = (await meRes.json().catch(() => ({}))) as { sub?: string };
  if (!info.sub) {
    console.warn('[oauth] LinkedIn userinfo response had no "sub" field — publishing will fail until an author ID is available.');
    return undefined;
  }
  return `urn:li:person:${info.sub}`;
}

/**
 * Public OAuth config served to the browser: a map of every supported platform
 * to its client ID ('' when not configured). The browser uses a non-empty
 * client ID both to build the authorize URL and to know the platform is
 * available to connect. Secrets are never included.
 */
export function getPublicOAuthConfig(): Record<OAuthPlatform, string> {
  const out = {} as Record<OAuthPlatform, string>;
  for (const platform of OAUTH_PLATFORMS) {
    out[platform] = getPlatformClientId(platform);
  }
  return out;
}
