// A minimal OpenID Connect provider standing in for TynHub in tests:
// discovery, JWKS, a token endpoint (authorization_code + PKCE,
// client_secret_basic) issuing RS256 ID tokens, and userinfo. Tests
// "authorize" by calling issue() with the params AutoMarketer put in the
// authorization URL, as TynHub would after the user signs in.
// Ported from routini/tests/helpers/fakeIssuer.ts.

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeIdentity {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export class FakeTynhubIssuer {
  url = '';
  clientId = 'automarketer';
  clientSecret = 'thc_test-secret-0123';
  /** Test knob: put a wrong nonce in the ID token. */
  tamperNonce = false;
  /** Test knob: leave email claims out of the ID token (userinfo still has them). */
  emailOnlyInUserinfo = false;
  private server!: Server;
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly kid = randomBytes(4).toString('hex');
  private readonly codes = new Map<
    string,
    { identity: FakeIdentity; nonce: string; challenge: string; redirectUri: string }
  >();
  private readonly accessTokens = new Map<string, FakeIdentity>();

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections?.();
    await new Promise((r) => this.server.close(r));
  }

  /** What TynHub does after the user signs in: a code bound to this request's nonce and PKCE challenge. */
  issue(authUrl: URL, identity: FakeIdentity): string {
    const p = authUrl.searchParams;
    if (
      p.get('client_id') !== this.clientId ||
      p.get('response_type') !== 'code' ||
      p.get('code_challenge_method') !== 'S256'
    ) {
      throw new Error('bad authorization request');
    }
    const code = randomBytes(16).toString('hex');
    this.codes.set(code, {
      identity,
      nonce: p.get('nonce') ?? '',
      challenge: p.get('code_challenge') ?? '',
      redirectUri: p.get('redirect_uri') ?? '',
    });
    return code;
  }

  private idToken(identity: FakeIdentity, nonce: string): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { ...identity };
    if (this.emailOnlyInUserinfo) {
      delete claims.email;
      delete claims.email_verified;
    }
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.kid }));
    const payload = b64url(
      JSON.stringify({
        iss: this.url,
        aud: this.clientId,
        azp: this.clientId,
        iat: now,
        exp: now + 300,
        nonce: this.tamperNonce ? 'wrong' : nonce,
        ...claims,
      }),
    );
    const sig = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), this.keys.privateKey);
    return `${header}.${payload}.${b64url(sig)}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', this.url);
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: this.url,
        authorization_endpoint: `${this.url}/oauth/authorize`,
        token_endpoint: `${this.url}/oauth/token`,
        userinfo_endpoint: `${this.url}/oauth/userinfo`,
        jwks_uri: `${this.url}/oauth/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        scopes_supported: ['openid', 'profile', 'email', 'orgs'],
      });
    }
    if (url.pathname === '/oauth/jwks') {
      return json(200, {
        keys: [{ ...this.keys.publicKey.export({ format: 'jwk' }), kid: this.kid, alg: 'RS256', use: 'sig' }],
      });
    }
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      const body = await new Promise<string>((r) => {
        let s = '';
        req.on('data', (c) => (s += c));
        req.on('end', () => r(s));
      });
      const form = new URLSearchParams(body);
      const basic = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      const [id, secret] = basic.split(':').map((x) => decodeURIComponent(x));
      if (id !== this.clientId || secret !== this.clientSecret) return json(401, { error: 'invalid_client' });
      const grant = this.codes.get(form.get('code') ?? '');
      if (!grant) return json(400, { error: 'invalid_grant' });
      this.codes.delete(form.get('code')!); // single use
      const verifier = form.get('code_verifier') ?? '';
      if (b64url(createHash('sha256').update(verifier).digest()) !== grant.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      }
      if (form.get('redirect_uri') !== grant.redirectUri) {
        return json(400, { error: 'invalid_grant', error_description: 'redirect_uri' });
      }
      const access = randomBytes(16).toString('hex');
      this.accessTokens.set(access, grant.identity);
      return json(200, {
        access_token: access,
        token_type: 'Bearer',
        expires_in: 300,
        id_token: this.idToken(grant.identity, grant.nonce),
      });
    }
    if (url.pathname === '/oauth/userinfo') {
      const identity = this.accessTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      return identity ? json(200, identity) : json(401, { error: 'invalid_token' });
    }
    json(404, { error: 'not found' });
  }
}
