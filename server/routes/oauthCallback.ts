import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { accessTokenStore } from '../models/accessTokenStore.js';
import { getPlatformClientId, getPlatformClientSecret, resolveLinkedInAuthorId, OAUTH_PLATFORMS } from '../utils/platformOAuth.js';
import { consumeBlueskySession, createDPoPProof } from '../utils/blueskyOAuth.js';

const router = Router();

// ── Authentication guard ─────────────────────────────────────────────────────
// OAuth callbacks must come from authenticated users who initiated the flow.
router.use(requireAuth);

/**
 * The redirect URI registered with the platform — must exactly match the one
 * used by the frontend popup (window.location.origin + /oauth/callback) and the
 * value registered in the provider's developer dashboard.
 *
 * Derived as `<FRONTEND_URL>/oauth/callback`. A trailing slash on FRONTEND_URL
 * is stripped so `http://localhost:5173/` does not produce a mismatching
 * `http://localhost:5173//oauth/callback`.
 */
export function getRedirectUri(): string {
  const base = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/oauth/callback`;
}

/**
 * Exchange a LinkedIn authorization code for an access token and resolve the
 * member URN (author ID) needed for publishing.
 *
 * Token endpoint: https://www.linkedin.com/oauth/v2/accessToken
 * Userinfo (OpenID Connect, requires openid+profile scopes):
 *   https://api.linkedin.com/v2/userinfo → { sub } → "urn:li:person:{sub}"
 */
async function exchangeLinkedInCode(
  userId: string,
  code: string,
): Promise<
  | { ok: true; accessToken: string; expiresAt?: string; authorId?: string }
  | { ok: false; status: number; error: string; errorCode: string }
> {
  const clientId = getPlatformClientId('linkedin');
  if (!clientId) {
    console.error(
      '[oauth] linkedin token exchange aborted: LINKEDIN_CLIENT_ID is not set on the server. ' +
        'Set LINKEDIN_CLIENT_ID (and LINKEDIN_CLIENT_SECRET) in the server environment.',
    );
    return {
      ok: false,
      status: 500,
      error: 'LinkedIn is not configured on the server. Set LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET.',
      errorCode: 'PLATFORM_NOT_CONFIGURED',
    };
  }

  const redirectUri = getRedirectUri();
  console.log(`[oauth] exchanging LinkedIn authorization code for user=${userId} (redirect_uri=${redirectUri})`);

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: getPlatformClientSecret('linkedin'),
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error(
      `[oauth] LinkedIn token exchange failed: HTTP ${tokenRes.status} — ${body}. ` +
        'Check that LINKEDIN_CLIENT_SECRET is set correctly and that the redirect URI ' +
        `(${redirectUri}) exactly matches the one registered in the LinkedIn app.`,
    );
    return {
      ok: false,
      status: 502,
      error: 'LinkedIn rejected the token exchange. See server logs for details.',
      errorCode: 'TOKEN_EXCHANGE_FAILED',
    };
  }

  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token) {
    console.error('[oauth] LinkedIn token response contained no access_token:', JSON.stringify(tokenData));
    return {
      ok: false,
      status: 502,
      error: 'LinkedIn returned no access token.',
      errorCode: 'TOKEN_EXCHANGE_FAILED',
    };
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : undefined;
  console.log(`[oauth] LinkedIn access token obtained (expires ${expiresAt ?? 'unknown'})`);

  // Resolve the member URN used as the publishing author ID. Failure here is
  // non-fatal — the token is still stored — but publishing will need a
  // manually configured author ID, so log loudly.
  const authorId = await resolveLinkedInAuthorId(tokenData.access_token);
  if (authorId) {
    console.log(`[oauth] LinkedIn member URN resolved for user=${userId}`);
  }

  return { ok: true, accessToken: tokenData.access_token, expiresAt, authorId };
}

/**
 * Exchange a Reddit authorization code for an access token.
 *
 * Token endpoint: https://www.reddit.com/api/v1/access_token
 * Reddit requires HTTP Basic auth (client_id:client_secret) on the token
 * request — the credentials go in the Authorization header, NOT the body — and
 * a unique User-Agent on every call. A refresh token is only returned when the
 * authorize URL included `duration=permanent` (the client sends that).
 *
 * No author id is needed: posts are attributed to the authenticated account,
 * and the target subreddit + title come from the campaign at publish time.
 */
async function exchangeRedditCode(
  userId: string,
  code: string,
): Promise<
  | { ok: true; accessToken: string; expiresAt?: string; refreshToken?: string }
  | { ok: false; status: number; error: string; errorCode: string }
> {
  const clientId = getPlatformClientId('reddit');
  if (!clientId) {
    console.error(
      '[oauth] reddit token exchange aborted: REDDIT_CLIENT_ID is not set on the server. ' +
        'Set REDDIT_CLIENT_ID (and REDDIT_CLIENT_SECRET) in the server environment.',
    );
    return {
      ok: false,
      status: 500,
      error: 'Reddit is not configured on the server. Set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.',
      errorCode: 'PLATFORM_NOT_CONFIGURED',
    };
  }

  const redirectUri = getRedirectUri();
  console.log(`[oauth] exchanging Reddit authorization code for user=${userId} (redirect_uri=${redirectUri})`);

  // Reddit authenticates the token request with HTTP Basic (client_id:secret).
  const basicAuth = Buffer.from(`${clientId}:${getPlatformClientSecret('reddit')}`).toString('base64');

  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Reddit blocks requests with a generic User-Agent; use the same UA the
      // RedditConnector sends when publishing.
      'User-Agent': 'AutoMarketer/1.0',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error(
      `[oauth] Reddit token exchange failed: HTTP ${tokenRes.status} — ${body}. ` +
        'Check that REDDIT_CLIENT_SECRET is correct and that the redirect URI ' +
        `(${redirectUri}) exactly matches the one registered on the Reddit app.`,
    );
    return {
      ok: false,
      status: 502,
      error: 'Reddit rejected the token exchange. See server logs for details.',
      errorCode: 'TOKEN_EXCHANGE_FAILED',
    };
  }

  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    console.error('[oauth] Reddit token response contained no access_token:', JSON.stringify(tokenData));
    return {
      ok: false,
      status: 502,
      error: 'Reddit returned no access token.',
      errorCode: 'TOKEN_EXCHANGE_FAILED',
    };
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : undefined;
  console.log(
    `[oauth] Reddit access token obtained (expires ${expiresAt ?? 'unknown'}, ` +
      `refresh_token ${tokenData.refresh_token ? 'present' : 'absent'})`,
  );

  return {
    ok: true,
    accessToken: tokenData.access_token,
    expiresAt,
    refreshToken: tokenData.refresh_token,
  };
}

/**
 * Exchange a Twitter/X authorization code for an access token.
 *
 * Token endpoint: https://api.twitter.com/2/oauth2/token
 * X mandates PKCE (RFC 7636), so the `code_verifier` generated by the browser
 * at authorize time must be supplied here. For a confidential client (one with
 * a client secret) X authenticates the token request with HTTP Basic auth.
 * The `offline.access` scope yields a refresh token.
 *
 * No author id is needed: tweets are posted as the authenticated account.
 */
async function exchangeTwitterCode(
  userId: string,
  code: string,
  codeVerifier: string | undefined,
): Promise<
  | { ok: true; accessToken: string; expiresAt?: string; refreshToken?: string }
  | { ok: false; status: number; error: string; errorCode: string }
> {
  const clientId = getPlatformClientId('twitter');
  if (!clientId) {
    console.error(
      '[oauth] twitter token exchange aborted: TWITTER_CLIENT_ID is not set on the server. ' +
        'Set TWITTER_CLIENT_ID (and TWITTER_CLIENT_SECRET) in the server environment.',
    );
    return {
      ok: false,
      status: 500,
      error: 'X (Twitter) is not configured on the server. Set TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET.',
      errorCode: 'PLATFORM_NOT_CONFIGURED',
    };
  }

  if (!codeVerifier) {
    console.error(
      `[oauth] twitter token exchange aborted for user=${userId}: missing PKCE code_verifier. ` +
        'The browser must forward the verifier it generated at authorize time.',
    );
    return {
      ok: false,
      status: 400,
      error: 'Missing PKCE code_verifier for the X authorization.',
      errorCode: 'MISSING_CODE_VERIFIER',
    };
  }

  const redirectUri = getRedirectUri();
  console.log(`[oauth] exchanging Twitter authorization code for user=${userId} (redirect_uri=${redirectUri})`);

  // Confidential client: authenticate the token request with HTTP Basic auth.
  const basicAuth = Buffer.from(`${clientId}:${getPlatformClientSecret('twitter')}`).toString('base64');

  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error(
      `[oauth] Twitter token exchange failed: HTTP ${tokenRes.status} — ${body}. ` +
        'Check that TWITTER_CLIENT_SECRET is correct, the app type is "Web App" (confidential), and ' +
        `the redirect URI (${redirectUri}) exactly matches the one registered in the X developer portal.`,
    );
    return {
      ok: false,
      status: 502,
      error: 'X rejected the token exchange. See server logs for details.',
      errorCode: 'TOKEN_EXCHANGE_FAILED',
    };
  }

  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!tokenData.access_token) {
    console.error('[oauth] Twitter token response contained no access_token:', JSON.stringify(tokenData));
    return {
      ok: false,
      status: 502,
      error: 'X returned no access token.',
      errorCode: 'TOKEN_EXCHANGE_FAILED',
    };
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : undefined;
  console.log(
    `[oauth] Twitter access token obtained (expires ${expiresAt ?? 'unknown'}, ` +
      `refresh_token ${tokenData.refresh_token ? 'present' : 'absent'})`,
  );

  return {
    ok: true,
    accessToken: tokenData.access_token,
    expiresAt,
    refreshToken: tokenData.refresh_token,
  };
}

/**
 * Exchange a Bluesky authorization code for an access token using DPoP.
 *
 * AT Protocol OAuth requires:
 *   - DPoP proof header for the token request (RFC 9449).
 *   - PKCE code_verifier matching the code_challenge sent in the PAR request.
 *   - client_id = URL of the client metadata document (no client secret).
 *
 * On success, stores the access token, refresh token, user DID (as authorId),
 * DPoP private key JWK, and PDS URL in the token store.
 */
async function exchangeBlueskyCode(
  userId: string,
  code: string,
  state: string,
): Promise<
  | { ok: true; authorId: string }
  | { ok: false; status: number; error: string; errorCode: string }
> {
  const session = consumeBlueskySession(state);
  if (!session) {
    console.error(
      `[oauth] bluesky session not found for state=${state} user=${userId} — ` +
        'the session may have expired (10-minute window) or the state parameter is wrong.',
    );
    return { ok: false, status: 400, error: 'Bluesky OAuth session expired or not found. Please try connecting again.', errorCode: 'SESSION_NOT_FOUND' };
  }

  const clientId = process.env.BLUESKY_CLIENT_ID?.trim();
  if (!clientId) {
    return { ok: false, status: 500, error: 'Bluesky is not configured on this server.', errorCode: 'PLATFORM_NOT_CONFIGURED' };
  }

  const redirectUri = getRedirectUri();
  const { codeVerifier, dpopPrivateKeyJwk, dpopPublicKeyJwk, tokenEndpoint, pdsUrl, did } = session;

  console.log(`[oauth] exchanging Bluesky authorization code for user=${userId} (tokenEndpoint=${tokenEndpoint})`);

  // Strip query string from token endpoint URL for DPoP `htu` claim.
  const htu = tokenEndpoint.split('?')[0];

  // Return type is inferred from `fetch` itself (rather than annotated as
  // `Promise<Response>`) because `Response` in this file's scope refers to
  // Express's `Response` type (imported above for the route handlers), which
  // would otherwise shadow the global Fetch API `Response` this function
  // actually returns.
  const makeTokenRequest = async (nonce?: string): ReturnType<typeof fetch> => {
    const dpopProof = createDPoPProof(dpopPrivateKeyJwk, dpopPublicKeyJwk, 'POST', htu, nonce);
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': dpopProof,
        'User-Agent': 'AutoMarketer/1.0',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }).toString(),
    });
  };

  let tokenRes = await makeTokenRequest();

  // Handle use_dpop_nonce error — retry once with the server-provided nonce.
  if (!tokenRes.ok) {
    const nonce = tokenRes.headers.get('DPoP-Nonce');
    if (nonce) {
      const errBody = (await tokenRes.json().catch(() => ({}))) as { error?: string };
      if (errBody.error === 'use_dpop_nonce') {
        tokenRes = await makeTokenRequest(nonce);
      }
    }
  }

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error(
      `[oauth] Bluesky token exchange failed: HTTP ${tokenRes.status} — ${body}. ` +
        `token_endpoint=${tokenEndpoint}`,
    );
    return { ok: false, status: 502, error: 'Bluesky rejected the token exchange. See server logs for details.', errorCode: 'TOKEN_EXCHANGE_FAILED' };
  }

  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    sub?: string;
  };

  if (!tokenData.access_token) {
    console.error('[oauth] Bluesky token response contained no access_token:', JSON.stringify(tokenData));
    return { ok: false, status: 502, error: 'Bluesky returned no access token.', errorCode: 'TOKEN_EXCHANGE_FAILED' };
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : undefined;

  // Persist the token alongside the DPoP key and PDS URL needed for future API calls.
  await accessTokenStore.setAccessToken(userId, 'bluesky', tokenData.access_token, {
    expiresAt,
    refreshToken: tokenData.refresh_token,
    authorId: did, // DID is used as the author identifier for posting
    dpopPrivateKeyJwk: JSON.stringify(dpopPrivateKeyJwk),
    pdsUrl,
  });

  console.log(
    `[oauth] Bluesky connected: user=${userId} did=${did} pds=${pdsUrl} ` +
      `(expires=${expiresAt ?? 'unknown'}, refresh_token=${tokenData.refresh_token ? 'present' : 'absent'})`,
  );

  return { ok: true, authorId: did };
}

/**
 * GET /api/oauth/callback
 *
 * Complete an OAuth 2.0 flow started by the connection popup.
 *
 * Query parameters:
 *   - code: Authorization code (for server-side token exchange)
 *   - state: CSRF token to validate the request
 *   - platform: Platform that issued the code
 *   - error / error_description: Set when the platform denied authorization
 *
 * LinkedIn: performs the real token exchange and resolves the member URN
 * (returned as `authorId` so the client can use it when publishing).
 * Reddit: performs the real token exchange (HTTP Basic auth; stores the refresh
 * token when the authorize URL used `duration=permanent`).
 * Twitter/X: performs the real token exchange using the PKCE `code_verifier`
 * forwarded by the browser (HTTP Basic auth; `offline.access` yields a refresh token).
 * Other platforms: stores a placeholder token (exchange not yet implemented).
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { code, state, error, error_description, platform, code_verifier } = req.query as Record<string, string | undefined>;

  console.log(
    `[oauth] callback received: user=${userId} platform=${platform ?? 'unknown'} ` +
      `code=${code ? 'present' : 'missing'} error=${error ?? 'none'}`,
  );

  // Validate state (CSRF protection) - state should match what was sent in the OAuth request
  // For now, we'll skip strict validation but in production you should validate this
  const storedState = req.cookies.oauth_state;
  if (state && storedState && state !== storedState) {
    console.error(`[oauth] state mismatch for user=${userId} platform=${platform} — rejecting callback`);
    res.status(400).json({
      error: 'Invalid state parameter',
      code: 'INVALID_STATE',
    });
    return;
  }

  if (error) {
    console.error('[oauth] Authorization failed:', error, error_description);
    res.status(400).json({
      error: error_description ?? error,
      code: 'AUTH_FAILED',
    });
    return;
  }

  if (!code) {
    console.error(`[oauth] callback missing authorization code (user=${userId} platform=${platform})`);
    res.status(400).json({
      error: 'No authorization code received',
      code: 'MISSING_CODE',
    });
    return;
  }

  if (!platform) {
    console.error(`[oauth] callback missing platform parameter (user=${userId})`);
    res.status(400).json({
      error: 'No platform specified',
      code: 'MISSING_PLATFORM',
    });
    return;
  }

  try {
    if (platform === 'linkedin') {
      const result = await exchangeLinkedInCode(userId, code);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, code: result.errorCode });
        return;
      }

      await accessTokenStore.setAccessToken(userId, 'linkedin', result.accessToken, {
        expiresAt: result.expiresAt,
        authorId: result.authorId,
      });
      console.log(`[oauth] linkedin connected: user=${userId} authorId=${result.authorId ? 'resolved' : 'NOT resolved'}`);

      res.json({
        success: true,
        platform,
        authorId: result.authorId,
        message: 'LinkedIn connected successfully',
      });
      return;
    }

    if (platform === 'reddit') {
      const result = await exchangeRedditCode(userId, code);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, code: result.errorCode });
        return;
      }

      await accessTokenStore.setAccessToken(userId, 'reddit', result.accessToken, {
        expiresAt: result.expiresAt,
        refreshToken: result.refreshToken,
      });
      console.log(`[oauth] reddit connected: user=${userId} (refresh token ${result.refreshToken ? 'stored' : 'absent'})`);

      res.json({
        success: true,
        platform,
        message: 'Reddit connected successfully',
      });
      return;
    }

    if (platform === 'twitter') {
      const result = await exchangeTwitterCode(userId, code, code_verifier);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, code: result.errorCode });
        return;
      }

      await accessTokenStore.setAccessToken(userId, 'twitter', result.accessToken, {
        expiresAt: result.expiresAt,
        refreshToken: result.refreshToken,
      });
      console.log(`[oauth] twitter connected: user=${userId} (refresh token ${result.refreshToken ? 'stored' : 'absent'})`);

      res.json({
        success: true,
        platform,
        message: 'X (Twitter) connected successfully',
      });
      return;
    }

    if (platform === 'bluesky') {
      if (!state) {
        res.status(400).json({ error: 'Bluesky OAuth requires a state parameter', code: 'MISSING_STATE' });
        return;
      }
      const result = await exchangeBlueskyCode(userId, code, state);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, code: result.errorCode });
        return;
      }

      res.json({
        success: true,
        platform,
        authorId: result.authorId,
        message: 'Bluesky connected successfully',
      });
      return;
    }

    // Other platforms: token exchange not implemented yet — store a placeholder
    // so the flow completes, and warn loudly because publishing will fail
    // against the real API.
    console.warn(
      `[oauth] token exchange NOT implemented for "${platform}" — storing a placeholder token for user=${userId}. ` +
        `Publishing to ${platform} will fail against the real API until the exchange is implemented.`,
    );
    await accessTokenStore.setAccessToken(userId, platform, `placeholder_${code.substring(0, 50)}`);

    res.json({
      success: true,
      platform,
      message: 'OAuth callback processed (placeholder token — real token exchange not yet implemented for this platform)',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[oauth] Error processing callback for user=${userId} platform=${platform}:`, message);
    res.status(500).json({
      error: 'Failed to process OAuth callback',
      code: 'OAUTH_ERROR',
    });
  }
});

/**
 * GET /api/oauth/connections
 *
 * Reports which platforms the authenticated user currently has a usable
 * (non-expired) token for, so the UI can reflect real connection state across
 * reloads instead of resetting to "disconnected" every time. Reloads from the
 * database first so the answer is correct after a server restart.
 */
router.get('/connections', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  await accessTokenStore.loadForUser(userId);
  const connected = new Set(accessTokenStore.listConnectedPlatforms(userId));

  const status: Record<string, boolean> = {};
  for (const platform of OAUTH_PLATFORMS) {
    status[platform] = connected.has(platform);
  }
  res.json(status);
});

/**
 * DELETE /api/oauth/connections/:platform
 *
 * Actually disconnects a platform by deleting the stored token (in-memory and
 * in the database), so "Disconnect" in the UI is real rather than cosmetic.
 */
router.delete('/connections/:platform', async (req: Request<{ platform: string }>, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { platform } = req.params;
  await accessTokenStore.deleteToken(userId, platform);
  console.log(`[oauth] ${platform} disconnected: user=${userId} (token deleted)`);
  res.json({ success: true, platform });
});

export default router;
