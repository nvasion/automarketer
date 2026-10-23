// ─────────────────────────────────────────────────────────────────────────────
// "Continue with TynHub": OIDC relying party (Authorization Code + PKCE),
// TynHub-hosted AutoMarketer only (see server/utils/tynhubOidc.ts).
//
//   GET    /api/auth/providers                  public: { tynhub: { name } | null }
//   GET    /api/auth/tynhub/start?next=&link=1  → TynHub authorize
//   GET    /api/auth/tynhub/callback            ← TynHub → frontend
//   GET    /api/auth/identities                 signed-in user's linked providers
//   DELETE /api/auth/identities/tynhub          unlink (refused without a password)
//
// Account rules (PRD-tynhub-oidc, decision 2):
//   – A returning identity (tynhub, sub) signs in its user.
//   – Link mode (link=1, from Settings) attaches the identity to the signed-in
//     user, who must still be signed in when TynHub sends them back.
//   – A new identity NEVER attaches itself to an existing account by email:
//     AutoMarketer does not verify emails, so anyone could pre-register a
//     victim's address and capture their TynHub sign-in. Those users sign in
//     with their password and connect TynHub from Settings.
//   – Otherwise a passwordless account is created from a verified email.
//
// State, nonce, PKCE verifier, `next` and the link target travel in a
// short-lived signed cookie (SameSite=Lax: the callback is a top-level
// navigation coming back from TynHub).
//
// Mounted after the main auth router on /api/auth, so the auth rate limiter
// (router.use(authLimiter) in auth.ts) runs for these routes too.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import * as oidc from 'openid-client';
import { requireAuth } from '../middleware/auth.js';
import { jwtSecret } from '../utils/config.js';
import {
  TYNHUB_PROVIDER,
  publicOrigin,
  tynhubRedirectUri,
  type TynhubOidcConfig,
} from '../utils/tynhubOidc.js';
import { userStore } from '../models/userStore.js';
import { identityStore } from '../models/identityStore.js';
import { getPool } from '../db/connection.js';
import { emailExists as dbEmailExists, findById as dbFindById } from '../db/usersTable.js';
import { cookieOptions, signToken } from './auth.js';
import type { JwtPayload, User } from '../types.js';

const STATE_COOKIE = 'am_tynhub';
const STATE_COOKIE_PATH = '/api/auth/tynhub';
const STATE_TTL_SEC = 600;
const SCOPE = 'openid profile email';

interface TynhubClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

interface FlowState {
  v: string; // PKCE code verifier
  s: string; // state
  n: string; // nonce
  next: string;
  link: string | null; // user id being linked, or null for sign-in
}

/** A sign-in failure whose message is safe to show the user. */
class TynhubSignInError extends Error {}

/** Only same-origin app paths are allowed as `next` (no open redirects). */
export function safeNext(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return /^\/(?!\/)[A-Za-z0-9/_\-.?=&%]*$/.test(s) && !s.includes('\\') ? s : '/';
}

/** The signed-in user id from the auth_token cookie, or null. */
function sessionUserId(req: Request): string | null {
  const token = req.cookies?.auth_token as string | undefined;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as JwtPayload;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

async function findUser(id: string): Promise<User | undefined> {
  const cached = userStore.findById(id);
  if (cached) return cached;
  const pool = getPool();
  return pool ? dbFindById(pool, id) : undefined;
}

async function emailTaken(email: string): Promise<boolean> {
  const pool = getPool();
  return pool ? dbEmailExists(pool, email) : userStore.emailExists(email);
}

/** Applies the account rules above; returns the user to sign in. */
async function resolveUser(claims: TynhubClaims, linkUserId: string | null): Promise<User> {
  const existing = await identityStore.find(TYNHUB_PROVIDER, claims.sub);

  if (existing) {
    if (linkUserId && existing.userId !== linkUserId) {
      throw new TynhubSignInError('That TynHub account is already linked to another AutoMarketer user');
    }
    const user = await findUser(existing.userId);
    if (!user) throw new Error('identity points at a missing user');
    return user;
  }

  if (linkUserId) {
    const user = await findUser(linkUserId);
    if (!user) throw new TynhubSignInError('Sign in again, then connect TynHub from Settings');
    if (!(await identityStore.add(TYNHUB_PROVIDER, claims.sub, user.id))) {
      throw new TynhubSignInError('That TynHub account is already linked to another AutoMarketer user');
    }
    return user;
  }

  const email = (claims.email ?? '').trim().toLowerCase();
  if (!email || claims.email_verified !== true) {
    throw new TynhubSignInError('Your TynHub account needs a verified email address');
  }
  if (await emailTaken(email)) {
    throw new TynhubSignInError(
      'An account with this email already exists: sign in with your password, then connect TynHub from Settings',
    );
  }
  // Same path as /register (cache + DB) so /me sees the new user immediately.
  const user = userStore.create(email, null);
  await userStore.saveToDb(user);
  if (!(await identityStore.add(TYNHUB_PROVIDER, claims.sub, user.id))) {
    throw new TynhubSignInError('Sign-in failed; try again');
  }
  return user;
}

export function createTynhubAuthRouter(cfg: TynhubOidcConfig | null): Router {
  const router = Router();
  const secure = process.env.NODE_ENV === 'production';
  const stateCookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: STATE_COOKIE_PATH,
  };
  let discovered: Promise<oidc.Configuration> | null = null;

  const configuration = (c: TynhubOidcConfig): Promise<oidc.Configuration> => {
    discovered ??= oidc
      .discovery(new URL(c.issuer), c.clientId, undefined, oidc.ClientSecretBasic(c.clientSecret), {
        // tynhubOidcConfig() only lets plain http through for localhost (dev / e2e).
        ...(c.issuer.startsWith('http://') ? { execute: [oidc.allowInsecureRequests] } : {}),
      })
      .catch((err: unknown) => {
        discovered = null; // retry discovery on the next sign-in
        throw err;
      });
    return discovered;
  };

  /** Errors land on /login, or on /settings when connecting from Settings. */
  const fail = (res: Response, message: string, linking = false): void => {
    const target = linking ? '/settings?tynhub_error=' : '/login?error=';
    res.redirect(302, `${publicOrigin()}${target}${encodeURIComponent(message)}`);
  };

  const notConfigured = (res: Response): void => {
    res.status(404).json({ error: 'TynHub sign-in is not configured.', code: 'TYNHUB_NOT_CONFIGURED' });
  };

  // What the login/register pages offer. Public.
  router.get('/providers', (_req: Request, res: Response): void => {
    res.json({ tynhub: cfg ? { name: 'TynHub' } : null });
  });

  router.get('/tynhub/start', async (req: Request, res: Response): Promise<void> => {
    if (!cfg) return notConfigured(res);
    const linking = req.query.link === '1';
    let linkUserId: string | null = null;
    if (linking) {
      linkUserId = sessionUserId(req);
      if (!linkUserId) {
        res.status(401).json({ error: 'Authentication required', code: 'MISSING_TOKEN' });
        return;
      }
    }
    try {
      const config = await configuration(cfg);
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const next = req.query.next === undefined && linking ? '/settings' : safeNext(req.query.next);
      const flow: FlowState = { v: verifier, s: state, n: nonce, next, link: linkUserId };
      const cookie = jwt.sign(flow, jwtSecret(), { algorithm: 'HS256', expiresIn: STATE_TTL_SEC });
      res.cookie(STATE_COOKIE, cookie, { ...stateCookieOptions, maxAge: STATE_TTL_SEC * 1000 });
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: tynhubRedirectUri(),
        scope: SCOPE,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      res.redirect(302, url.href);
    } catch (err) {
      console.error('[tynhub] start failed:', (err as Error).message);
      fail(res, 'TynHub is unavailable right now; try again', linking);
    }
  });

  router.get('/tynhub/callback', async (req: Request, res: Response): Promise<void> => {
    if (!cfg) return notConfigured(res);
    const raw = req.cookies?.[STATE_COOKIE] as string | undefined;
    // One attempt per cookie: clear it whatever happens next.
    res.clearCookie(STATE_COOKIE, stateCookieOptions);

    let st: FlowState;
    try {
      st = jwt.verify(raw ?? '', jwtSecret(), { algorithms: ['HS256'] }) as FlowState;
    } catch {
      return fail(res, 'The sign-in took too long or was started elsewhere; try again');
    }
    const linking = st.link !== null;

    if (typeof req.query.error === 'string') {
      // Never echo provider text to the user; log it for the operator.
      console.warn('[tynhub] provider returned an error:', req.query.error, req.query.error_description ?? '');
      return fail(res, 'TynHub sign-in was cancelled or failed; try again', linking);
    }

    try {
      const config = await configuration(cfg);
      // Validate against the exact registered redirect URI, not whatever host the request came through.
      const current = new URL(tynhubRedirectUri());
      current.search = new URL(req.originalUrl, 'http://localhost').search;

      let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
      try {
        tokens = await oidc.authorizationCodeGrant(config, current, {
          pkceCodeVerifier: st.v,
          expectedState: st.s,
          expectedNonce: st.n,
          idTokenExpected: true,
        });
      } catch (err) {
        console.warn('[tynhub] code exchange failed:', (err as Error).message);
        return fail(res, 'Sign-in could not be verified; try again', linking);
      }

      let claims = tokens.claims() as TynhubClaims | undefined;
      if (!claims?.sub) return fail(res, 'TynHub did not identify you; try again', linking);
      // The email may be served only by userinfo.
      if (claims.email === undefined) {
        try {
          const info = (await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)) as Partial<TynhubClaims>;
          claims = { ...claims, email: info.email, email_verified: claims.email_verified ?? info.email_verified };
        } catch (err) {
          console.warn('[tynhub] userinfo failed:', (err as Error).message);
        }
      }

      // Link mode: the browser must still be signed in as the user who started it.
      if (linking && sessionUserId(req) !== st.link) {
        return fail(res, 'Sign in again, then connect TynHub from Settings');
      }

      const user = await resolveUser(claims, st.link);
      res.cookie('auth_token', signToken(user.id, user.email), cookieOptions());
      res.redirect(302, `${publicOrigin()}${safeNext(st.next)}`);
    } catch (err) {
      if (err instanceof TynhubSignInError) return fail(res, err.message, linking);
      console.error('[tynhub] callback failed:', (err as Error).message);
      fail(res, 'Sign-in failed; try again', linking);
    }
  });

  router.get('/identities', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const ids = await identityStore.listForUser(req.user!.sub);
    res.json(ids.map((i) => ({ provider: i.provider, linkedAt: i.createdAt })));
  });

  // CSRF: like every other mutation in this app, protected by the
  // SameSite=Strict auth_token cookie (no cross-site request carries it).
  router.delete('/identities/tynhub', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const user = await findUser(req.user!.sub);
    if (!user) {
      res.status(404).json({ error: 'User not found.', code: 'USER_NOT_FOUND' });
      return;
    }
    if (user.passwordHash === null) {
      res.status(400).json({
        error: 'This account has no password, so disconnecting TynHub would lock you out.',
        code: 'NO_PASSWORD',
      });
      return;
    }
    const removed = await identityStore.remove(user.id, TYNHUB_PROVIDER);
    res.json({ unlinked: removed > 0 });
  });

  return router;
}
