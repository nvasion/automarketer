// ── LinkedIn page/identity service ─────────────────────────────────────────────
// Fetches the LinkedIn identities (personal profile + any company pages) the
// authenticated user can post as, and manages the localStorage selection.

export interface LinkedInPage {
  /** LinkedIn URN, e.g. "urn:li:person:abc123" or "urn:li:organization:12345" */
  urn: string
  /** Display name: the user's full name or the organization's name */
  name: string
  /** Distinguishes personal profiles from company/organization pages */
  type: 'person' | 'organization'
}

const SELECTED_AUTHOR_KEY_PREFIX = 'linkedin_selectedAuthor_'
const LEGACY_AUTHOR_ID_KEY_PREFIX = 'linkedin_authorId_'

/**
 * Fetch the list of LinkedIn identities the current user can post as.
 * Always includes the personal profile; company pages are included when the
 * user's LinkedIn app has the "Organization Access" product approved.
 */
export async function fetchLinkedInPages(): Promise<LinkedInPage[]> {
  const res = await fetch('/api/linkedin/pages', { credentials: 'include' })
  if (!res.ok) {
    let message = `Failed to load LinkedIn pages (HTTP ${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(message)
  }
  const data = (await res.json()) as { pages: LinkedInPage[] }
  return data.pages
}

/**
 * Return the localStorage key used to persist the selected posting identity
 * for the given user.
 */
function selectedAuthorKey(userId: string): string {
  return `${SELECTED_AUTHOR_KEY_PREFIX}${userId}`
}

/**
 * Persist the user's selected posting identity. Pass `null` to clear the
 * selection and revert to the personal profile.
 */
export function saveSelectedLinkedInPage(userId: string, page: LinkedInPage | null): void {
  const key = selectedAuthorKey(userId)
  if (page === null) {
    localStorage.removeItem(key)
  } else {
    localStorage.setItem(key, JSON.stringify(page))
  }
}

/**
 * Load the user's previously selected posting identity from localStorage.
 * Returns `null` when nothing has been selected (caller should fall back to
 * the personal profile URN stored during OAuth).
 */
export function loadSelectedLinkedInPage(userId: string): LinkedInPage | null {
  try {
    const raw = localStorage.getItem(selectedAuthorKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as LinkedInPage
  } catch {
    return null
  }
}

/**
 * Resolve the author URN that should be used when publishing a LinkedIn post
 * for the given user. Resolution order:
 *   1. Explicitly selected page (user picked in Settings)
 *   2. Personal profile URN stored during the OAuth connect flow (legacy key)
 *
 * Returns `null` when no URN can be found — the caller should prompt the user
 * to reconnect LinkedIn.
 */
export function resolveLinkedInAuthorUrn(userId: string): string | null {
  // Selected page takes priority
  const selected = loadSelectedLinkedInPage(userId)
  if (selected?.urn) return selected.urn

  // Fall back to the personal profile URN written during OAuth
  return localStorage.getItem(`${LEGACY_AUTHOR_ID_KEY_PREFIX}${userId}`)
}
