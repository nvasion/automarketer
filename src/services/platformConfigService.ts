// ── Platform config service ────────────────────────────────────────────────────
// Reads and writes the signed-in user's OAuth client IDs. Each user owns
// their own configuration — there is no shared global config and no
// administrator role.
//
// All endpoints require authentication: the browser sends the httpOnly
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
 * Fetch the signed-in user's OAuth client IDs for every supported platform.
 *
 * Client IDs are public values — they appear in every OAuth redirect URL —
 * but are scoped to a single user account so each customer manages their
 * own OAuth apps. An empty string for a platform means the user hasn't
 * configured it yet; the UI should show the setup form.
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
 * Save (create or update) the signed-in user's client ID for a platform.
 *
 * The server trims whitespace and validates length / control characters. It
 * also mirrors facebook ↔ instagram automatically because they share a
 * single Meta App ID.
 */
export async function savePlatformClientId(
  platform: string,
  clientId: string,
): Promise<void> {
  const res = await fetch(`/api/platform-config/${encodeURIComponent(platform)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  })
  if (!res.ok) {
    throw new Error(await readJsonError(res))
  }
}

/**
 * Clear the signed-in user's client ID for a platform.
 */
export async function deletePlatformClientId(platform: string): Promise<void> {
  const res = await fetch(`/api/platform-config/${encodeURIComponent(platform)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(await readJsonError(res))
  }
}
