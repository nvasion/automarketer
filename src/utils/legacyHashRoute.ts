// The app used HashRouter until the SEO sweep, so old bookmarks and emailed
// links look like https://automarketer.tynhub.com/#/how-it-works. main.tsx
// rewrites them to the real path (history.replaceState) before the router
// mounts. This is the only place a "#/" route string is still understood.

/**
 * Map a legacy hash route to its real path, or null when the hash is not one.
 *
 *   legacyHashPath('#/how-it-works', '')            -> '/how-it-works'
 *   legacyHashPath('#/settings?tab=ai', '?ref=mail') -> '/settings?tab=ai&ref=mail'
 *   legacyHashPath('#/how-it-works#connect', '')    -> '/how-it-works#connect'
 *   legacyHashPath('#connect', '')                  -> null (a plain in-page anchor)
 *
 * `search` is window.location.search (the query before the '#'); its
 * parameters are kept after any the hash route carried itself.
 */
export function legacyHashPath(hash: string, search: string): string | null {
  if (!hash.startsWith('#/')) return null
  let rest = hash.slice(1)

  // A second '#' inside the old route was an in-page anchor: keep it.
  let fragment = ''
  const anchorAt = rest.indexOf('#')
  if (anchorAt !== -1) {
    fragment = rest.slice(anchorAt)
    rest = rest.slice(0, anchorAt)
  }

  let path = rest
  let query = ''
  const queryAt = rest.indexOf('?')
  if (queryAt !== -1) {
    path = rest.slice(0, queryAt)
    query = rest.slice(queryAt + 1)
  }

  const outer = search.startsWith('?') ? search.slice(1) : search
  const combined = [query, outer].filter(Boolean).join('&')
  return `${path || '/'}${combined ? `?${combined}` : ''}${fragment}`
}
