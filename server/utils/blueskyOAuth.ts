// ── Bluesky / AT Protocol OAuth utilities ───────────────────────────────────
// Implements the server-side helpers for Bluesky's AT Protocol OAuth flow:
//   - DPoP (Demonstrating Proof of Possession, RFC 9449) key generation and
//     proof JWT creation.
//   - AT Protocol handle → DID resolution and DID document fetching.
//   - Authorization server metadata discovery from the user's PDS.
//   - PAR (Pushed Authorization Requests, RFC 9126) submission.
//   - Short-lived in-memory session store keyed by OAuth `state` parameter.
//
// References:
//   https://docs.bsky.app/docs/advanced-guides/oauth-client
//   https://atproto.com/specs/oauth

import * as crypto from 'crypto';

// ── Base64url helpers ────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlStr(str: string): string {
  return base64url(Buffer.from(str, 'utf8'));
}

// ── DPoP key generation ──────────────────────────────────────────────────────

export interface DPoPKeyPair {
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
}

/**
 * Generate an ephemeral ES256 (P-256 ECDSA) key pair for DPoP.
 * The private key is used to sign DPoP proofs; the public key is embedded in
 * each proof's JOSE header so the server can verify the binding.
 */
export function generateDPoPKeyPair(): DPoPKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privateKeyJwk = privateKey.export({ format: 'jwk' }) as JsonWebKey;
  const publicKeyJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  // Ensure the public JWK has no private components.
  const { d: _d, ...cleanPublicKeyJwk } = publicKeyJwk as JsonWebKey & { d?: string };
  return { privateKeyJwk, publicKeyJwk: cleanPublicKeyJwk };
}

// ── DER → JOSE signature conversion ─────────────────────────────────────────

/**
 * Convert a DER-encoded ECDSA signature (as returned by Node's `createSign`)
 * to the JOSE `r || s` raw format required by JWT ES256.
 *
 * DER structure: SEQUENCE { INTEGER r, INTEGER s }
 * JOSE format  : r (32 bytes, big-endian) || s (32 bytes, big-endian)
 */
function derToJoseSig(der: Buffer): Buffer {
  let pos = 0;
  if (der[pos++] !== 0x30) throw new Error('[blueskyOAuth] Invalid DER signature: expected SEQUENCE');
  // Skip the total length (1 or 2 bytes; we read both INTEGER tags directly)
  pos += der[pos] < 0x80 ? 1 : (der[pos] & 0x7f) + 1;

  if (der[pos++] !== 0x02) throw new Error('[blueskyOAuth] Invalid DER signature: expected r INTEGER');
  const rLen = der[pos++];
  let r = der.slice(pos, pos + rLen);
  pos += rLen;

  if (der[pos++] !== 0x02) throw new Error('[blueskyOAuth] Invalid DER signature: expected s INTEGER');
  const sLen = der[pos++];
  let s = der.slice(pos, pos + sLen);

  // Strip leading zero byte (DER uses signed big-endian integers; the leading
  // 0x00 only pads when the high bit would otherwise signal a negative number).
  while (r.length > 32 && r[0] === 0) r = r.slice(1);
  while (s.length > 32 && s[0] === 0) s = s.slice(1);

  // Pad each component to exactly 32 bytes (P-256 field size = 256 bits).
  const rPad = Buffer.concat([Buffer.alloc(Math.max(0, 32 - r.length)), r]);
  const sPad = Buffer.concat([Buffer.alloc(Math.max(0, 32 - s.length)), s]);
  return Buffer.concat([rPad, sPad]);
}

// ── DPoP proof creation ──────────────────────────────────────────────────────

/**
 * Create a DPoP proof JWT (RFC 9449 §4.2) signed with the given ES256 key.
 *
 * Required by Bluesky's AT Protocol OAuth for both PAR and token-exchange
 * requests, and for every subsequent API call with a DPoP-bound access token.
 *
 * @param privateKeyJwk  The ES256 private key (JWK, serialised from generateDPoPKeyPair).
 * @param publicKeyJwk   The matching public key to embed in the JOSE header.
 * @param method         HTTP method for the request (e.g. "POST").
 * @param url            URL of the request (scheme + authority + path, no fragment/query).
 * @param nonce          Optional nonce received from the server in a previous response.
 * @param accessToken    When present, a SHA-256 hash of the access token is included
 *                       as the `ath` claim to bind the proof to that token.
 */
export function createDPoPProof(
  privateKeyJwk: JsonWebKey,
  publicKeyJwk: JsonWebKey,
  method: string,
  url: string,
  nonce?: string,
  accessToken?: string,
): string {
  const privateKey = crypto.createPrivateKey({ key: privateKeyJwk as unknown as crypto.JsonWebKey, format: 'jwk' });

  const header = JSON.stringify({
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: publicKeyJwk,
  });

  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    jti: crypto.randomUUID(),
    htm: method.toUpperCase(),
    htu: url,
    iat: now,
    exp: now + 120, // 2-minute window; short-lived proofs are spec-recommended
  };

  if (nonce) payload.nonce = nonce;

  if (accessToken) {
    // ath = BASE64URL(SHA-256(ASCII(access_token)))  [RFC 9449 §4.2]
    const hash = crypto.createHash('sha256').update(accessToken, 'ascii').digest();
    payload.ath = base64url(hash);
  }

  const encodedHeader = base64urlStr(header);
  const encodedPayload = base64urlStr(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput, 'ascii');
  const derSignature = sign.sign(privateKey);

  return `${signingInput}.${base64url(derToJoseSig(derSignature))}`;
}

// ── Handle resolution ────────────────────────────────────────────────────────

interface ResolveHandleResult {
  did: string;
}

/**
 * Resolve a Bluesky / AT Protocol handle to its DID.
 *
 * Uses the public `com.atproto.identity.resolveHandle` XRPC endpoint served
 * by the `bsky.social` AppView. For handles hosted on custom PDSes the AppView
 * typically still resolves them (it crawls DNS TXT records), but may lag.
 */
export async function resolveHandle(handle: string): Promise<string> {
  // Normalise: strip leading "@" and any surrounding whitespace.
  const normHandle = handle.trim().replace(/^@/, '');

  const url = `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(normHandle)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'AutoMarketer/1.0' } });
  } catch (err) {
    throw new Error(
      `[blueskyOAuth] network error resolving handle "${normHandle}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[blueskyOAuth] failed to resolve handle "${normHandle}": HTTP ${res.status} — ${text.substring(0, 200)}`,
    );
  }

  const data = (await res.json()) as ResolveHandleResult;
  if (!data.did) throw new Error(`[blueskyOAuth] resolveHandle returned no DID for "${normHandle}"`);
  return data.did;
}

// ── DID document fetching ────────────────────────────────────────────────────

interface DidService {
  id: string;
  type: string;
  serviceEndpoint: string;
}

interface DidDocument {
  id: string;
  service?: DidService[];
}

/**
 * Fetch a DID document for the given DID.
 *
 * Supports `did:plc:` (via `https://plc.directory/{did}`) and `did:web:`
 * (via `https://{domain}/.well-known/did.json`).
 */
export async function fetchDidDocument(did: string): Promise<DidDocument> {
  let docUrl: string;

  if (did.startsWith('did:plc:')) {
    docUrl = `https://plc.directory/${encodeURIComponent(did)}`;
  } else if (did.startsWith('did:web:')) {
    const domain = did.slice('did:web:'.length).replace(/%3A/g, ':');
    docUrl = `https://${domain}/.well-known/did.json`;
  } else {
    throw new Error(`[blueskyOAuth] unsupported DID method for "${did}" — only did:plc and did:web are supported`);
  }

  let res: Response;
  try {
    res = await fetch(docUrl, { headers: { 'User-Agent': 'AutoMarketer/1.0' } });
  } catch (err) {
    throw new Error(
      `[blueskyOAuth] network error fetching DID document for "${did}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[blueskyOAuth] failed to fetch DID document for "${did}": HTTP ${res.status} — ${text.substring(0, 200)}`,
    );
  }

  return (await res.json()) as DidDocument;
}

/**
 * Validate a PDS (Personal Data Server) URL before making outbound requests to it.
 *
 * DID documents are fetched from external sources (plc.directory, custom domains)
 * and the PDS URL they contain could point to internal network addresses, creating
 * an SSRF (Server-Side Request Forgery) vulnerability. This function rejects:
 *
 *   - Non-HTTPS schemes (HTTP, file, data, etc.)
 *   - IPv4 addresses (including AWS metadata endpoint 169.254.169.254)
 *   - IPv6 addresses (including ::1 / loopback)
 *   - Single-label hostnames (localhost, intranet names)
 *   - URLs containing embedded credentials (user:pass@host)
 *
 * Throws if the URL fails any check so callers don't have to inspect the return value.
 */
export function validatePdsUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[blueskyOAuth] Invalid PDS URL in DID document: "${raw}"`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `[blueskyOAuth] PDS URL must use HTTPS (got "${parsed.protocol}"): "${raw}". ` +
        'Non-HTTPS PDS endpoints are not supported.',
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      `[blueskyOAuth] PDS URL must not contain embedded credentials: "${raw}"`,
    );
  }

  const hostname = parsed.hostname;

  // Reject IPv4 addresses (all-numeric labels separated by dots).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    throw new Error(
      `[blueskyOAuth] PDS URL must not be an IPv4 address (SSRF risk): "${raw}"`,
    );
  }

  // Reject IPv6 addresses — they appear as "[::1]" in the URL's hostname field.
  if (hostname.startsWith('[')) {
    throw new Error(
      `[blueskyOAuth] PDS URL must not be an IPv6 address (SSRF risk): "${raw}"`,
    );
  }

  // Reject single-label hostnames (e.g. "localhost", "intranet").
  if (!hostname.includes('.')) {
    throw new Error(
      `[blueskyOAuth] PDS URL hostname must have at least two DNS labels (got "${hostname}"): ` +
        `"${raw}". Single-label names are not valid AT Protocol PDS addresses.`,
    );
  }
}

/**
 * Extract the PDS (Personal Data Server) URL from an AT Protocol DID document.
 *
 * Looks for a service entry with id ending in `#atproto_pds`, validates the URL
 * against SSRF risks (IP addresses, non-HTTPS, single-label hosts), then returns it.
 */
export function getPdsUrl(didDoc: DidDocument): string {
  const pdsService = didDoc.service?.find(
    (s) => s.id === '#atproto_pds' || s.id.endsWith('#atproto_pds'),
  );
  if (!pdsService?.serviceEndpoint) {
    throw new Error(
      `[blueskyOAuth] DID document for "${didDoc.id}" has no #atproto_pds service entry`,
    );
  }
  const pdsUrl = pdsService.serviceEndpoint.replace(/\/+$/, '');
  // Validate before returning — prevents SSRF via a malicious DID document that
  // sets serviceEndpoint to an internal address like "http://169.254.169.254/...".
  validatePdsUrl(pdsUrl);
  return pdsUrl;
}

// ── Authorization server metadata ─────────────────────────────────────────────

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  pushed_authorization_request_endpoint?: string;
  scopes_supported?: string[];
  dpop_signing_alg_values_supported?: string[];
  require_pushed_authorization_requests?: boolean;
}

/**
 * Resolve the OAuth authorization server (issuer) for the given PDS.
 *
 * The PDS is only the OAuth *resource server*: its
 * `/.well-known/oauth-protected-resource` document names the authorization
 * server that actually issues tokens (`https://bsky.social` for
 * Bluesky-hosted `*.host.bsky.network` PDSes, which return 404 for
 * auth-server metadata on the PDS host itself). Self-hosted PDSes that act
 * as their own auth server may omit the document, so fall back to the PDS.
 */
async function resolveAuthServerIssuer(pdsUrl: string): Promise<string> {
  try {
    const res = await fetch(`${pdsUrl}/.well-known/oauth-protected-resource`, {
      headers: { 'User-Agent': 'AutoMarketer/1.0' },
    });
    if (res.ok) {
      const doc = (await res.json()) as { authorization_servers?: string[] };
      const issuer = doc.authorization_servers?.[0]?.replace(/\/+$/, '');
      if (issuer) {
        // Same SSRF rules as the PDS URL — the issuer comes from a remote
        // document, so it must not point at internal/non-HTTPS addresses.
        validatePdsUrl(issuer);
        return issuer;
      }
    }
  } catch {
    // Fall through — the (already validated) PDS URL is a safe default.
  }
  return pdsUrl;
}

/**
 * Fetch the OAuth authorization server metadata for the given PDS.
 *
 * Resolves the issuer via the PDS's protected-resource document, then reads
 * the standard `/.well-known/oauth-authorization-server` path on the issuer.
 */
export async function fetchAuthServerMetadata(pdsUrl: string): Promise<AuthServerMetadata> {
  const issuer = await resolveAuthServerIssuer(pdsUrl);
  const metaUrl = `${issuer}/.well-known/oauth-authorization-server`;
  let res: Response;
  try {
    res = await fetch(metaUrl, { headers: { 'User-Agent': 'AutoMarketer/1.0' } });
  } catch (err) {
    throw new Error(
      `[blueskyOAuth] network error fetching auth server metadata from "${issuer}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[blueskyOAuth] failed to fetch auth server metadata from "${issuer}": HTTP ${res.status} — ${text.substring(0, 200)}`,
    );
  }

  return (await res.json()) as AuthServerMetadata;
}

// ── PAR (Pushed Authorization Requests) ──────────────────────────────────────

export interface PARResult {
  request_uri: string;
  expires_in?: number;
}

/**
 * Submit a Pushed Authorization Request (RFC 9126) to the PAR endpoint.
 *
 * Returns the `request_uri` to include in the final authorization URL.
 * Automatically handles `use_dpop_nonce` errors by retrying once with the
 * nonce the server provided.
 *
 * @param parEndpoint    The PDS / auth server's PAR endpoint URL.
 * @param params         Authorization request parameters (client_id, scope, etc.).
 * @param dpopKeyPair    Key pair for generating the DPoP proof header.
 */
export async function submitPAR(
  parEndpoint: string,
  params: Record<string, string>,
  dpopKeyPair: DPoPKeyPair,
): Promise<PARResult> {
  // Derive htu (without query string / fragment) as required by RFC 9449 §4.2.
  const htu = parEndpoint.split('?')[0];

  const makeRequest = async (nonce?: string) => {
    const dpopProof = createDPoPProof(
      dpopKeyPair.privateKeyJwk,
      dpopKeyPair.publicKeyJwk,
      'POST',
      htu,
      nonce,
    );
    return fetch(parEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': dpopProof,
        'User-Agent': 'AutoMarketer/1.0',
      },
      body: new URLSearchParams(params).toString(),
    });
  };

  let res = await makeRequest();

  // Retry once with the server-supplied nonce if required.
  if (!res.ok) {
    const nonce = res.headers.get('DPoP-Nonce');
    if (nonce) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      if (errBody.error === 'use_dpop_nonce') {
        res = await makeRequest(nonce);
      }
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[blueskyOAuth] PAR request failed: HTTP ${res.status} — ${text.substring(0, 400)}`,
    );
  }

  return (await res.json()) as PARResult;
}

// ── In-memory OAuth session store ─────────────────────────────────────────────
// Keyed by the OAuth `state` parameter. Sessions expire after 10 minutes to
// prevent memory leaks from abandoned flows.

export interface BlueskyOAuthSession {
  /** PKCE code verifier generated at initiation time. */
  codeVerifier: string;
  /** DPoP private key JWK — needed for the token exchange. */
  dpopPrivateKeyJwk: JsonWebKey;
  /** DPoP public key JWK — embedded in each DPoP proof header. */
  dpopPublicKeyJwk: JsonWebKey;
  /** Token endpoint URL for the user's PDS/auth server. */
  tokenEndpoint: string;
  /** Base URL of the user's PDS — stored for posting later. */
  pdsUrl: string;
  /** The user's resolved DID. */
  did: string;
  /** Wall-clock expiry for pruning stale sessions. */
  expiresAt: number;
  /** Most recent DPoP nonce received from the server, if any. */
  dpopNonce?: string;
}

const sessions = new Map<string, BlueskyOAuthSession>();

/** Store an OAuth session keyed by state. */
export function storeBlueskySession(state: string, session: BlueskyOAuthSession): void {
  // Prune sessions older than 10 minutes on each write to avoid unbounded growth.
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (v.expiresAt < now) sessions.delete(k);
  }
  sessions.set(state, session);
}

/** Retrieve and consume (delete) an OAuth session by state. */
export function consumeBlueskySession(state: string): BlueskyOAuthSession | undefined {
  const session = sessions.get(state);
  sessions.delete(state);
  return session;
}
