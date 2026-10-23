// @vitest-environment node
/**
 * "Continue with TynHub" (OIDC code + PKCE) against a fake TynHub issuer:
 * hosted-only config rules, account creation and linking rules, tampering,
 * and the password-login / unlink guards for passwordless accounts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../server/app';
import { userStore } from '../server/models/userStore';
import { identityStore } from '../server/models/identityStore';
import { safeNext } from '../server/routes/tynhubAuth';
import { HOSTED_ONLY_MESSAGE, tynhubOidcConfig } from '../server/utils/tynhubOidc';
import { FakeTynhubIssuer, type FakeIdentity } from './helpers/fakeTynhubIssuer';

const FRONTEND = 'http://am.test';
const ENV_KEYS = [
  'AUTOMARKETER_MODE',
  'TYNHUB_OIDC_ISSUER',
  'TYNHUB_OIDC_CLIENT_ID',
  'TYNHUB_OIDC_CLIENT_SECRET',
  'FRONTEND_URL',
] as const;

let issuer: FakeTynhubIssuer;
let app: Application;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  issuer = new FakeTynhubIssuer();
  await issuer.start();
});
afterAll(async () => {
  await issuer.stop();
});
beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FRONTEND_URL = FRONTEND;
  userStore._clear();
  identityStore._clear();
});
afterEach(() => {
  issuer.tamperNonce = false;
  issuer.emailOnlyInUserinfo = false;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function hostedApp(): Application {
  process.env.AUTOMARKETER_MODE = 'hosted';
  process.env.TYNHUB_OIDC_ISSUER = `${issuer.url}/`; // trailing slash is trimmed
  process.env.TYNHUB_OIDC_CLIENT_ID = issuer.clientId;
  process.env.TYNHUB_OIDC_CLIENT_SECRET = issuer.clientSecret;
  app = createApp();
  return app;
}

const setCookies = (res: { headers: Record<string, unknown> }): string[] =>
  (res.headers['set-cookie'] as string[] | undefined) ?? [];

/** The full Set-Cookie line for `name` with a non-empty value, or null. */
const setCookieLine = (res: { headers: Record<string, unknown> }, name: string): string | null =>
  setCookies(res).find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`)) ?? null;

/** `name=value` for a Cookie request header, or null. */
const cookieFrom = (res: { headers: Record<string, unknown> }, name: string): string | null =>
  setCookieLine(res, name)?.split(';')[0] ?? null;

const location = (res: { headers: Record<string, unknown> }) => decodeURIComponent(res.headers['location'] as string);

async function register(email: string, password = 'password123') {
  const res = await request(app).post('/api/auth/register').send({ email, password });
  expect(res.status).toBe(201);
  return cookieFrom(res, 'auth_token')!;
}

/** Runs the whole redirect dance; returns the start and callback responses and the session cookie. */
async function signIn(
  identity: FakeIdentity,
  opts: { next?: string; session?: string; state?: string } = {},
) {
  const qs = new URLSearchParams();
  if (opts.next !== undefined) qs.set('next', opts.next);
  if (opts.session) qs.set('link', '1');
  const start = await request(app)
    .get(`/api/auth/tynhub/start?${qs.toString()}`)
    .set('Cookie', opts.session ?? '');
  expect(start.status).toBe(302);
  const authUrl = new URL(start.headers['location'] as string);
  expect(authUrl.origin + authUrl.pathname).toBe(`${issuer.url}/oauth/authorize`);
  const stateCookie = cookieFrom(start, 'am_tynhub')!;
  const code = issuer.issue(authUrl, identity);
  const state = opts.state ?? authUrl.searchParams.get('state');
  const cbUrl = `/api/auth/tynhub/callback?code=${code}&state=${state}`;
  const cookieHeader = [stateCookie, opts.session].filter(Boolean).join('; ');
  const cb = await request(app).get(cbUrl).set('Cookie', cookieHeader);
  return { start, authUrl, cb, cbUrl, cookieHeader, session: cookieFrom(cb, 'auth_token') };
}

const me = (session: string) => request(app).get('/api/auth/me').set('Cookie', session);

// ── Configuration ────────────────────────────────────────────────────────────

describe('TynHub sign-in configuration', () => {
  it('without TynHub configured: providers is null and start/callback 404', async () => {
    delete process.env.AUTOMARKETER_MODE;
    app = createApp();
    const providers = await request(app).get('/api/auth/providers');
    expect(providers.status).toBe(200);
    expect(providers.body).toEqual({ tynhub: null });
    // Covered by the /api/auth rate limiter (standard RateLimit headers).
    expect(providers.headers['ratelimit-limit']).toBeDefined();
    expect((await request(app).get('/api/auth/tynhub/start')).status).toBe(404);
    expect((await request(app).get('/api/auth/tynhub/callback?code=x&state=y')).status).toBe(404);
  });

  it('refuses partial TYNHUB_OIDC_* configuration', () => {
    process.env.AUTOMARKETER_MODE = 'hosted';
    process.env.TYNHUB_OIDC_ISSUER = 'https://tynhub.com';
    delete process.env.TYNHUB_OIDC_CLIENT_ID;
    delete process.env.TYNHUB_OIDC_CLIENT_SECRET;
    expect(() => createApp()).toThrow(/must be set together/);
  });

  it('refuses TynHub on a selfhost install (default mode)', () => {
    delete process.env.AUTOMARKETER_MODE;
    process.env.TYNHUB_OIDC_ISSUER = 'https://tynhub.com';
    process.env.TYNHUB_OIDC_CLIENT_ID = 'automarketer';
    process.env.TYNHUB_OIDC_CLIENT_SECRET = 'thc_x';
    expect(() => createApp()).toThrow(HOSTED_ONLY_MESSAGE);
    process.env.AUTOMARKETER_MODE = 'selfhost';
    expect(() => createApp()).toThrow(HOSTED_ONLY_MESSAGE);
  });

  it('refuses an unknown AUTOMARKETER_MODE and plain-http non-local issuers; trims the issuer', () => {
    process.env.AUTOMARKETER_MODE = 'cloud';
    expect(() => createApp()).toThrow(/AUTOMARKETER_MODE/);
    process.env.AUTOMARKETER_MODE = 'hosted';
    process.env.TYNHUB_OIDC_CLIENT_ID = 'automarketer';
    process.env.TYNHUB_OIDC_CLIENT_SECRET = 'thc_x';
    process.env.TYNHUB_OIDC_ISSUER = 'http://tynhub.com';
    expect(() => createApp()).toThrow(/https/);
    process.env.TYNHUB_OIDC_ISSUER = 'http://localhost:8080//';
    expect(tynhubOidcConfig()?.issuer).toBe('http://localhost:8080');
    process.env.TYNHUB_OIDC_ISSUER = 'https://tynhub.com/';
    expect(tynhubOidcConfig()).toEqual({ issuer: 'https://tynhub.com', clientId: 'automarketer', clientSecret: 'thc_x' });
  });
});

// ── Sign-in flow ─────────────────────────────────────────────────────────────

describe('Continue with TynHub', () => {
  it('creates a passwordless account from verified claims and signs it in', async () => {
    hostedApp();
    expect((await request(app).get('/api/auth/providers')).body).toEqual({ tynhub: { name: 'TynHub' } });

    const { start, authUrl, cb, session } = await signIn(
      { sub: 'th-1', email: 'Ada@Example.com', email_verified: true, name: 'Ada' },
      { next: '/campaigns' },
    );
    expect(authUrl.searchParams.get('redirect_uri')).toBe(`${FRONTEND}/api/auth/tynhub/callback`);
    expect(authUrl.searchParams.get('scope')).toBe('openid profile email');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('nonce')).toBeTruthy();
    const stateLine = setCookieLine(start, 'am_tynhub')!.toLowerCase();
    expect(stateLine).toContain('httponly');
    expect(stateLine).toContain('samesite=lax');
    expect(stateLine).toContain('path=/api/auth/tynhub');

    expect(cb.status).toBe(302);
    expect(cb.headers['location']).toBe(`${FRONTEND}/campaigns`);
    // The normal session cookie is set on the callback response itself.
    const authLine = setCookieLine(cb, 'auth_token')!.toLowerCase();
    expect(authLine).toContain('httponly');
    expect(authLine).toContain('samesite=strict');
    expect(authLine).toContain('path=/');
    // ...and the one-shot state cookie is cleared.
    expect(setCookies(cb).some((c) => c.startsWith('am_tynhub=;'))).toBe(true);

    const who = await me(session!);
    expect(who.status).toBe(200);
    expect(who.body.user).toMatchObject({ email: 'ada@example.com', hasPassword: false });
    expect(who.body.user).not.toHaveProperty('passwordHash');

    const ids = await request(app).get('/api/auth/identities').set('Cookie', session!);
    expect(ids.body).toEqual([{ provider: 'tynhub', linkedAt: expect.any(String) }]);
  });

  it('signs a returning identity into the same user (even if the email changed at TynHub)', async () => {
    hostedApp();
    const first = await signIn({ sub: 'th-2', email: 'bo@example.com', email_verified: true });
    const firstId = (await me(first.session!)).body.user.id;
    const again = await signIn({ sub: 'th-2', email: 'bo@new.example', email_verified: false });
    expect(again.cb.headers['location']).toBe(`${FRONTEND}/`);
    expect((await me(again.session!)).body.user.id).toBe(firstId);
  });

  it('falls back to userinfo for the email', async () => {
    hostedApp();
    issuer.emailOnlyInUserinfo = true;
    const { session } = await signIn({ sub: 'th-3', email: 'ui@example.com', email_verified: true });
    expect((await me(session!)).body.user.email).toBe('ui@example.com');
  });

  it('never attaches a new identity to an existing account by email', async () => {
    hostedApp();
    await register('grace@example.com');
    const { cb, session } = await signIn({ sub: 'th-4', email: 'grace@example.com', email_verified: true });
    expect(session).toBeNull();
    expect(location(cb)).toBe(
      `${FRONTEND}/login?error=An account with this email already exists: sign in with your password, then connect TynHub from Settings`,
    );
  });

  it('requires a verified email for new accounts', async () => {
    hostedApp();
    const unverified = await signIn({ sub: 'th-5', email: 'eve@example.com', email_verified: false });
    expect(unverified.session).toBeNull();
    expect(location(unverified.cb)).toBe(`${FRONTEND}/login?error=Your TynHub account needs a verified email address`);
    const noEmail = await signIn({ sub: 'th-6' });
    expect(noEmail.session).toBeNull();
    expect(location(noEmail.cb)).toContain('needs a verified email address');
  });

  it('links TynHub to the signed-in user from Settings (link mode)', async () => {
    hostedApp();
    const pw = await register('lin@example.com');
    const local = (await me(pw)).body.user;
    expect((await request(app).get('/api/auth/identities').set('Cookie', pw)).body).toEqual([]);

    const linked = await signIn({ sub: 'th-7', email: 'other@tynhub.example', email_verified: true }, { session: pw, next: '/settings' });
    expect(linked.cb.headers['location']).toBe(`${FRONTEND}/settings`);
    expect((await request(app).get('/api/auth/identities').set('Cookie', pw)).body).toEqual([
      { provider: 'tynhub', linkedAt: expect.any(String) },
    ]);

    // Next time, TynHub alone signs her in.
    const viaTynhub = await signIn({ sub: 'th-7' });
    expect((await me(viaTynhub.session!)).body.user.id).toBe(local.id);

    // The same TynHub account cannot be linked to a second user.
    const pw2 = await register('second@example.com');
    const dup = await signIn({ sub: 'th-7' }, { session: pw2 });
    expect(location(dup.cb)).toBe(
      `${FRONTEND}/settings?tynhub_error=That TynHub account is already linked to another AutoMarketer user`,
    );
  });

  it('link mode requires a session at start and the same session at callback', async () => {
    hostedApp();
    expect((await request(app).get('/api/auth/tynhub/start?link=1')).status).toBe(401);

    const pw = await register('swap@example.com');
    const start = await request(app).get('/api/auth/tynhub/start?link=1').set('Cookie', pw);
    const authUrl = new URL(start.headers['location'] as string);
    const code = issuer.issue(authUrl, { sub: 'th-8', email: 'x@example.com', email_verified: true });
    // The browser comes back signed out (or as someone else): refuse.
    const cb = await request(app)
      .get(`/api/auth/tynhub/callback?code=${code}&state=${authUrl.searchParams.get('state')}`)
      .set('Cookie', cookieFrom(start, 'am_tynhub')!);
    expect(cookieFrom(cb, 'auth_token')).toBeNull();
    expect(location(cb)).toContain('/login?error=Sign in again, then connect TynHub from Settings');
  });

  it('rejects tampered state, tampered nonce, missing state cookie and replayed callbacks', async () => {
    hostedApp();
    const id = { sub: 'th-9', email: 'm@example.com', email_verified: true };

    const forged = await signIn(id, { state: 'forged' });
    expect(forged.session).toBeNull();
    expect(location(forged.cb)).toContain('/login?error=Sign-in could not be verified');

    issuer.tamperNonce = true;
    const badNonce = await signIn(id);
    expect(badNonce.session).toBeNull();
    expect(location(badNonce.cb)).toContain('could not be verified');
    issuer.tamperNonce = false;

    const noCookie = await request(app).get('/api/auth/tynhub/callback?code=x&state=y');
    expect(location(noCookie)).toContain('took too long or was started elsewhere');

    const ok = await signIn(id);
    expect(ok.session).not.toBeNull();
    const replay = await request(app).get(ok.cbUrl).set('Cookie', ok.cookieHeader);
    expect(cookieFrom(replay, 'auth_token')).toBeNull();
    expect(location(replay)).toContain('/login?error=');
  });

  it('never echoes provider error text', async () => {
    hostedApp();
    const start = await request(app).get('/api/auth/tynhub/start');
    const res = await request(app)
      .get('/api/auth/tynhub/callback?error=access_denied&error_description=%3Cscript%3Eevil%3C%2Fscript%3E')
      .set('Cookie', cookieFrom(start, 'am_tynhub')!);
    expect(location(res)).toBe(`${FRONTEND}/login?error=TynHub sign-in was cancelled or failed; try again`);
  });

  it('only redirects to same-origin paths after sign-in', async () => {
    expect(safeNext('/campaigns/42?tab=posts')).toBe('/campaigns/42?tab=posts');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext(['/a'])).toBe('/');

    hostedApp();
    const { cb } = await signIn({ sub: 'th-10', email: 'n@example.com', email_verified: true }, { next: '//evil.example' });
    expect(cb.headers['location']).toBe(`${FRONTEND}/`);
  });
});

// ── Passwordless accounts ────────────────────────────────────────────────────

describe('TynHub-only accounts', () => {
  it('cannot password-login: same generic error as an unknown email', async () => {
    hostedApp();
    await signIn({ sub: 'th-11', email: 'nopw@example.com', email_verified: true });
    const res = await request(app).post('/api/auth/login').send({ email: 'nopw@example.com', password: 'anything-123' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'anything-123' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unknown.body);
    expect(res.body).toEqual({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
  });

  it('cannot unlink TynHub (would lock them out); password users can', async () => {
    hostedApp();
    const { session } = await signIn({ sub: 'th-12', email: 'only@example.com', email_verified: true });
    const refused = await request(app).delete('/api/auth/identities/tynhub').set('Cookie', session!);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('NO_PASSWORD');
    expect((await request(app).get('/api/auth/identities').set('Cookie', session!)).body).toHaveLength(1);

    const pw = await register('both@example.com');
    await signIn({ sub: 'th-13' }, { session: pw });
    const unlinked = await request(app).delete('/api/auth/identities/tynhub').set('Cookie', pw);
    expect(unlinked.status).toBe(200);
    expect(unlinked.body).toEqual({ unlinked: true });
    expect((await request(app).get('/api/auth/identities').set('Cookie', pw)).body).toEqual([]);
    expect((await me(pw)).body.user.hasPassword).toBe(true);

    expect((await request(app).delete('/api/auth/identities/tynhub')).status).toBe(401);
  });
});
