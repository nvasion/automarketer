// ── Platform config service ────────────────────────────────────────────────────
// Reads the server's OAuth client IDs (shared-app model). AutoMarketer owns one
// OAuth app per platform, configured via <PLATFORM>_CLIENT_ID environment
// variables; the same config is served to every user. Client IDs are public
// (they appear in OAuth redirect URLs); secrets are never sent to the browser.
//
// The endpoint requires authentication: the browser sends the httpOnly
// auth_token cookie automatically when we pass `credentials: 'include'`.

export interface PlatformClientIds {
  linkedin: string
  twitter: string
  reddit: string
  facebook: string
  instagram: string
  [platform: string]: string
}

interface ErrorResponse {
  error?: string
  code?: string
}

async function readJsonError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ErrorResponse
    if (body && typeof body.error === 'string') return body.error
  } catch {
    // Body wasn't JSON — fall through to the generic message.
  }
  return `Request failed (HTTP ${res.status})`
}

/**
 * Fetch the server's configured OAuth client IDs for every supported platform.
 *
 * An empty string for a platform means it is not configured on the server
 * (its <PLATFORM>_CLIENT_ID / <PLATFORM>_CLIENT_SECRET env vars aren't set), so
 * the UI should show "not configured" instead of a Connect button.
 */
export async function fetchPlatformClientIds(): Promise<PlatformClientIds> {
  const res = await fetch('/api/platform-config', {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(await readJsonError(res))
  }
  return res.json() as Promise<PlatformClientIds>
}

/**
 * Fetch which platforms the current user is actually connected to (has a valid
 * stored token for), so the UI reflects real connection state across reloads.
 * Returns a map of platform id → connected boolean.
 */
export async function fetchConnectedPlatforms(): Promise<Record<string, boolean>> {
  const res = await fetch('/api/oauth/connections', {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(await readJsonError(res))
  }
  return res.json() as Promise<Record<string, boolean>>
}

/**
 * Disconnect a platform by deleting its stored token server-side.
 */
export async function disconnectPlatform(platform: string): Promise<void> {
  const res = await fetch(`/api/oauth/connections/${encodeURIComponent(platform)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(await readJsonError(res))
  }
}
