// ── Platform config service ────────────────────────────────────────────────────
// Fetches OAuth client IDs from the server so they never need to be baked into
// the frontend bundle as VITE_* environment variables.

export interface PlatformClientIds {
  linkedin: string
  twitter: string
  reddit: string
  facebook: string
  instagram: string
  [platform: string]: string
}

/**
 * Fetch OAuth client IDs for all supported platforms from the Express API.
 *
 * Client IDs are public values — they appear in every OAuth redirect URL and
 * are safe to read by the browser.  An empty string for a platform means the
 * operator has not configured it yet; the UI should show setup instructions.
 *
 * @throws When the server returns a non-OK status or the network is unreachable.
 */
export async function fetchPlatformClientIds(): Promise<PlatformClientIds> {
  const res = await fetch('/api/platform-config')
  if (!res.ok) {
    throw new Error(`Failed to load platform configuration (HTTP ${res.status})`)
  }
  return res.json() as Promise<PlatformClientIds>
}
