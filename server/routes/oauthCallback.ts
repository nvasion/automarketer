import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { accessTokenStore } from '../models/accessTokenStore.js';
import { getPlatformClientId, getPlatformClientSecret, resolveLinkedInAuthorId } from '../utils/platformOAuth.js';

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
 * Other platforms: stores a placeholder token (exchange not yet implemented).
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { code, state, error, error_description, platform } = req.query as Record<string, string | undefined>;

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

export default router;
