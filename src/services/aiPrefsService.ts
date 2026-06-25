// ── AI generation preferences sync ──────────────────────────────────────────
// Syncs ONLY the non-sensitive generation defaults (tone, emoji usage,
// auto-hashtags, max tokens, temperature) with the server so they follow the
// user across browsers and devices.
//
// Provider API keys are deliberately NOT handled here — they stay in the
// browser's localStorage (see src/config/aiConfig.ts) so secrets never reach
// the server.
//
// The httpOnly auth cookie is sent automatically via `credentials: 'include'`.

import type { AIConfig } from '../config/aiConfig'

/** The subset of AIConfig that is persisted server-side. */
export type AiPrefs = AIConfig['defaults']

const ENDPOINT = '/api/ai-prefs'

/**
 * Fetch the user's saved generation preferences from the server.
 * Returns null when the user is not authenticated, none are stored yet, or the
 * request fails — callers then keep their local defaults.
 */
export async function fetchAiPrefs(): Promise<AiPrefs | null> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, { credentials: 'include' })
  } catch {
    return null
  }
  if (!res.ok) return null

  const body = (await res.json().catch(() => null)) as unknown
  if (!body || typeof body !== 'object') return null
  return body as AiPrefs
}

/**
 * Persist the user's generation preferences to the server. Throws on failure
 * so callers can decide whether to surface or swallow the error.
 */
export async function saveAiPrefs(prefs: AiPrefs): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })
  if (!res.ok) {
    throw new Error(`Failed to save AI preferences (HTTP ${res.status})`)
  }
}
