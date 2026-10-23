/**
 * "Continue with TynHub" configuration (OIDC relying party, hosted only).
 *
 * TynHub sign-in exists only on the TynHub-hosted AutoMarketer
 * (automarketer.tynhub.com). Self-hosted installs never get it: TynHub only
 * registers first-party clients whose redirect URIs live on tynhub.com, and
 * this module refuses to start a selfhost server that has TynHub configured.
 *
 *   AUTOMARKETER_MODE           hosted | selfhost (default selfhost)
 *   TYNHUB_OIDC_ISSUER          e.g. https://tynhub.com (trailing slash trimmed)
 *   TYNHUB_OIDC_CLIENT_ID       e.g. automarketer
 *   TYNHUB_OIDC_CLIENT_SECRET   thc_… (shown once when the client is registered)
 *
 * The three TYNHUB_OIDC_* vars are all-or-nothing. Every getter reads the
 * environment on each call so tests can vary it between createApp() calls.
 */

export type AppMode = 'hosted' | 'selfhost';

export interface TynhubOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

/** Provider key stored in user_identities.provider. */
export const TYNHUB_PROVIDER = 'tynhub';

export const HOSTED_ONLY_MESSAGE =
  'TynHub sign-in is only available on the TynHub-hosted AutoMarketer (AUTOMARKETER_MODE=hosted)';

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** AUTOMARKETER_MODE; anything other than hosted/selfhost is a startup error. */
export function appMode(): AppMode {
  const raw = env('AUTOMARKETER_MODE') ?? 'selfhost';
  if (raw !== 'hosted' && raw !== 'selfhost') {
    throw new Error(`AUTOMARKETER_MODE must be "hosted" or "selfhost" (got "${raw}")`);
  }
  return raw;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * TynHub OIDC settings, or null when not configured. Throws (fail fast at
 * startup) on a partial configuration, on TynHub configured outside hosted
 * mode, and on a plain-http issuer that is not on the local machine.
 */
export function tynhubOidcConfig(): TynhubOidcConfig | null {
  const mode = appMode();
  const issuer = env('TYNHUB_OIDC_ISSUER');
  const clientId = env('TYNHUB_OIDC_CLIENT_ID');
  const clientSecret = env('TYNHUB_OIDC_CLIENT_SECRET');
  if (!issuer && !clientId && !clientSecret) return null;
  if (!issuer || !clientId || !clientSecret) {
    throw new Error(
      'TYNHUB_OIDC_ISSUER, TYNHUB_OIDC_CLIENT_ID and TYNHUB_OIDC_CLIENT_SECRET must be set together',
    );
  }
  if (mode !== 'hosted') throw new Error(HOSTED_ONLY_MESSAGE);

  const trimmed = issuer.replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`TYNHUB_OIDC_ISSUER is not a valid URL: "${issuer}"`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error('TYNHUB_OIDC_ISSUER must use https (plain http is allowed only for localhost)');
  }
  return { issuer: trimmed, clientId, clientSecret };
}

/**
 * The origin the browser loads AutoMarketer from (FRONTEND_URL, no trailing
 * slash). /api is served on this same origin: the Vite dev proxy in dev, the
 * App Platform /api route in production.
 */
export function publicOrigin(): string {
  return (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
}

/** Redirect URI to register at TynHub: <FRONTEND_URL>/api/auth/tynhub/callback. */
export function tynhubRedirectUri(): string {
  return `${publicOrigin()}/api/auth/tynhub/callback`;
}
