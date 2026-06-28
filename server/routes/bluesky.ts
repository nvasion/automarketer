// ── Bluesky / AT Protocol OAuth routes ───────────────────────────────────────
// Two endpoints:
//
//   GET  /api/bluesky/client-metadata.json
//        Serves the OAuth client metadata document. Bluesky's PDS fetches this
//        to validate the client — the URL of this document IS the client_id.
//        Must be publicly accessible (no authentication required).
//
//   POST /api/bluesky/initiate
//        Resolves the user's handle, discovers their PDS, submits a PAR request,
//        and returns the authorization URL for the popup. Requires authentication.

import { Router } from 'express';
import type { Request, Response } from 'express';
import * as nodeCrypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  resolveHandle,
  fetchDidDocument,
  getPdsUrl,
  fetchAuthServerMetadata,
  generateDPoPKeyPair,
  submitPAR,
  storeBlueskySession,
} from '../utils/blueskyOAuth.js';
import { getRedirectUri } from './oauthCallback.js';

const router = Router();

// ── Input validators ────────────────────────────────────────────────────────────

/**
 * Validate a Bluesky / AT Protocol handle.
 *
 * AT Protocol handles are valid Internet hostnames (RFC 1123) with at least
 * two labels (e.g. "alice.bsky.social"). Pure IP addresses and single-label
 * names are rejected to prevent SSRF via handle resolution.
 *
 * Accepts an optional leading "@" which is stripped before validation.
 */
export function isValidBlueskyHandle(raw: string): boolean {
  const handle = raw.trim().replace(/^@/, '');
  if (!handle) return false;

  // Must be a valid Internet hostname: labels of 1–63 alphanumeric-or-hyphen
  // characters, not starting or ending with a hyphen. At least two labels are
  // required (rejecting bare single-label names like "localhost").
  const LABEL = '[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
  const HOSTNAME_RE = new RegExp(`^${LABEL}(\\.${LABEL})+$`);
  if (!HOSTNAME_RE.test(handle)) return false;

  // Reject pure IPv4 addresses (e.g. "192.168.1.1") — all labels are numeric.
  const labels = handle.split('.');
  const isIpv4 = labels.length === 4 && labels.every((l) => /^\d+$/.test(l));
  if (isIpv4) return false;

  return true;
}

/**
 * Validate the OAuth `state` parameter.
 *
 * The state value MUST be at least 32 characters long and consist only of
 * URL-safe characters (alphanumeric, hyphen, underscore) to ensure sufficient
 * entropy for CSRF protection.
 */
export function isValidOAuthState(state: string): boolean {
  return /^[a-zA-Z0-9_-]{32,}$/.test(state);
}

// ── Client metadata (public, no auth) ─────────────────────────────────────────

/**
 * GET /api/bluesky/client-metadata.json
 *
 * Bluesky's AT Protocol OAuth requires a publicly-accessible client metadata
 * document. The URL of this document is used as the OAuth `client_id`. The
 * PDS fetches it during authorization to validate redirect URIs and scopes.
 *
 * Configured via BLUESKY_CLIENT_ID — set this to the full public URL of this
 * endpoint (e.g. https://app.example.com/api/bluesky/client-metadata.json).
 *
 * References:
 *   https://docs.bsky.app/docs/advanced-guides/oauth-client
 *   https://datatracker.ietf.org/doc/html/rfc7591 (OAuth 2.0 Dynamic Client Registration)
 */
router.get('/client-metadata.json', (_req: Request, res: Response): void => {
  const clientId = process.env.BLUESKY_CLIENT_ID?.trim() ?? '';
  const redirectUri = getRedirectUri();
  const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/+$/, '');

  if (!clientId) {
    console.warn(
      '[bluesky] BLUESKY_CLIENT_ID is not set. ' +
        'Set it to the public URL of this endpoint (e.g. https://app.example.com/api/bluesky/client-metadata.json) ' +
        'so that Bluesky PDS servers can fetch the client metadata and validate the connection.',
    );
  }

  // The metadata URL is the client_id. Fall back to an auto-derived value so
  // the document is always self-consistent even in development.
  const serverUrl = (process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/+$/, '');
  const metadataUrl = clientId || `${serverUrl}/api/bluesky/client-metadata.json`;

  const metadata = {
    client_id: metadataUrl,
    application_type: 'web',
    client_name: 'AutoMarketer',
    client_uri: frontendUrl,
    redirect_uris: [redirectUri],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    // Public client (no client secret); DPoP proves possession instead.
    token_endpoint_auth_method: 'none',
    dpop_bound_access_tokens: true,
  };

  // Allow the PDS to cache the document for up to 60 seconds.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Content-Type', 'application/json');
  res.json(metadata);
});

// ── Authenticated routes ───────────────────────────────────────────────────────

router.use(requireAuth);

/**
 * POST /api/bluesky/initiate
 *
 * Step 1 of the Bluesky OAuth flow. The frontend calls this after the user
 * enters their Bluesky handle.
 *
 * Body: { handle: string, state: string }
 *   handle  — Bluesky handle (e.g. "alice.bsky.social" or "@alice.bsky.social")
 *   state   — Cryptographically random CSRF token generated by the frontend.
 *
 * Response: { authorizationUrl: string }
 *   The URL to open in the OAuth popup.
 *
 * Internally:
 *   1. Resolve handle → DID via bsky.social AppView.
 *   2. Fetch DID document → PDS URL.
 *   3. Fetch PDS /.well-known/oauth-authorization-server → auth server metadata.
 *   4. Generate PKCE code_verifier + code_challenge.
 *   5. Generate DPoP ES256 key pair.
 *   6. Submit PAR to pushed_authorization_request_endpoint.
 *   7. Store session (code_verifier, dpop_key, token_endpoint, pds_url, did).
 *   8. Return authorization_endpoint?client_id=…&request_uri=….
 */
router.post('/initiate', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { handle, state } = req.body as { handle?: string; state?: string };

  if (!handle || !handle.trim()) {
    res.status(400).json({ error: 'Bluesky handle is required', code: 'MISSING_HANDLE' });
    return;
  }
  if (!isValidBlueskyHandle(handle)) {
    res.status(400).json({
      error:
        'Invalid Bluesky handle. Handles must be valid Internet hostnames with at least two labels ' +
        '(e.g. "alice.bsky.social"). IP addresses and single-label names are not accepted.',
      code: 'INVALID_HANDLE',
    });
    return;
  }
  if (!state || !isValidOAuthState(state)) {
    res.status(400).json({
      error:
        'State parameter is required and must be at least 32 URL-safe characters ' +
        '(alphanumeric, hyphen, or underscore).',
      code: 'INVALID_STATE',
    });
    return;
  }

  const clientId = process.env.BLUESKY_CLIENT_ID?.trim();
  if (!clientId) {
    console.error(
      '[bluesky] BLUESKY_CLIENT_ID not set — cannot initiate OAuth flow. ' +
        'Set it to the public URL of /api/bluesky/client-metadata.json.',
    );
    res.status(500).json({
      error:
        'Bluesky is not configured on this server. Ask your administrator to set BLUESKY_CLIENT_ID.',
      code: 'PLATFORM_NOT_CONFIGURED',
    });
    return;
  }

  const redirectUri = getRedirectUri();

  console.log(`[bluesky] initiating OAuth for user=${userId} handle=${handle.trim()}`);

  try {
    // 1. Resolve handle → DID
    const did = await resolveHandle(handle.trim());
    console.log(`[bluesky] handle resolved: ${handle.trim()} → ${did}`);

    // 2. Fetch DID document → PDS URL
    const didDoc = await fetchDidDocument(did);
    const pdsUrl = getPdsUrl(didDoc);
    console.log(`[bluesky] PDS discovered for ${did}: ${pdsUrl}`);

    // 3. Fetch auth server metadata from the PDS
    const authMeta = await fetchAuthServerMetadata(pdsUrl);
    console.log(`[bluesky] auth server metadata fetched from ${pdsUrl}`);

    const parEndpoint = authMeta.pushed_authorization_request_endpoint;
    if (!parEndpoint) {
      throw new Error(
        `PDS at "${pdsUrl}" does not expose a pushed_authorization_request_endpoint`,
      );
    }

    // 4. Generate PKCE (code_verifier + code_challenge with S256 method)
    const codeVerifier = nodeCrypto.randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const codeChallenge = nodeCrypto
      .createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 5. Generate DPoP key pair
    const dpopKeyPair = generateDPoPKeyPair();

    // 6. Submit PAR
    const parParams: Record<string, string> = {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'atproto transition:generic',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      login_hint: handle.trim().replace(/^@/, ''),
    };

    const parResult = await submitPAR(parEndpoint, parParams, dpopKeyPair);
    console.log(`[bluesky] PAR succeeded: request_uri=${parResult.request_uri}`);

    // 7. Store session keyed by state (consumed during token exchange)
    storeBlueskySession(state, {
      codeVerifier,
      dpopPrivateKeyJwk: dpopKeyPair.privateKeyJwk,
      dpopPublicKeyJwk: dpopKeyPair.publicKeyJwk,
      tokenEndpoint: authMeta.token_endpoint,
      pdsUrl,
      did,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10-minute window
    });

    // 8. Build authorization URL using request_uri from PAR response
    const authorizationUrl =
      `${authMeta.authorization_endpoint}` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&request_uri=${encodeURIComponent(parResult.request_uri)}`;

    res.json({ authorizationUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bluesky] initiate failed for user=${userId}: ${message}`);
    res.status(502).json({
      error: `Failed to initiate Bluesky connection: ${message}`,
      code: 'INITIATE_FAILED',
    });
  }
});

export default router;
