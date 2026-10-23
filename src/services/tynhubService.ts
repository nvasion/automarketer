/**
 * "Continue with TynHub" (hosted AutoMarketer only) — client helpers.
 *
 * Sign-in itself is a full-page navigation to /api/auth/tynhub/start: the
 * server redirects to TynHub and back, sets the httpOnly auth_token cookie,
 * then lands the browser on `next`. Nothing here touches tokens.
 */

import { parseJsonBody } from '../utils/http';

export interface AuthProviders {
  tynhub: { name: string } | null;
}

export interface LinkedIdentity {
  provider: string;
  linkedAt: string;
}

/** Same rule as the server: only same-origin app paths, else "/". */
export function safeNext(raw: string | null | undefined): string {
  const s = raw ?? '';
  return /^\/(?!\/)[A-Za-z0-9/_\-.?=&%]*$/.test(s) && !s.includes('\\') ? s : '/';
}

/** URL of the full-page link that starts TynHub sign-in (or linking, from Settings). */
export function tynhubStartUrl(next: string, link = false): string {
  const qs = new URLSearchParams({ next: safeNext(next) });
  if (link) qs.set('link', '1');
  return `/api/auth/tynhub/start?${qs.toString()}`;
}

/** Public: which external sign-in providers this server offers. Never throws. */
export async function fetchAuthProviders(): Promise<AuthProviders> {
  try {
    const res = await fetch('/api/auth/providers', { credentials: 'include' });
    if (!res.ok) return { tynhub: null };
    const body = await parseJsonBody<Partial<AuthProviders>>(res);
    return { tynhub: body.tynhub ?? null };
  } catch {
    return { tynhub: null };
  }
}

export async function fetchIdentities(): Promise<LinkedIdentity[]> {
  const res = await fetch('/api/auth/identities', { credentials: 'include' });
  if (!res.ok) throw new Error('Could not load linked accounts');
  return parseJsonBody<LinkedIdentity[]>(res);
}

export async function unlinkTynhub(): Promise<void> {
  const res = await fetch('/api/auth/identities/tynhub', { method: 'DELETE', credentials: 'include' });
  if (!res.ok) {
    let message = 'Could not disconnect TynHub';
    try {
      message = (await parseJsonBody<{ error?: string }>(res)).error ?? message;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
}
