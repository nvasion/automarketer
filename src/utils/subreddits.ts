/**
 * Subreddit input normalization.
 *
 * Campaigns and Reddit post requests accept subreddit targets as either a
 * single subreddit or an array. User input may also include "r/" prefixes or
 * comma-separated lists, so every entry point funnels through
 * `normalizeSubreddits()` to produce a clean, deduplicated string array.
 */

/**
 * Valid subreddit name: letters, digits, and underscores, up to Reddit's
 * 21-character maximum. Used to reject obviously malformed names before they
 * reach the Reddit API.
 */
export const SUBREDDIT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_]{0,20}$/

/** Whether the given (already normalized) name is a plausible subreddit name. */
export function isValidSubredditName(name: string): boolean {
  return SUBREDDIT_NAME_PATTERN.test(name)
}

/**
 * Normalize subreddit input into a clean array of bare subreddit names.
 *
 * Accepts a single subreddit (`"r/startups"`), a comma/whitespace-separated
 * list (`"r/startups, SaaS"`), or an array of either form. For each entry:
 * leading "/r/" or "r/" prefixes are stripped, surrounding whitespace is
 * trimmed, and empty values are dropped. Duplicates are removed
 * case-insensitively (subreddit names are case-insensitive on Reddit),
 * preserving the first-seen casing.
 */
export function normalizeSubreddits(input?: string | string[] | null): string[] {
  if (input == null) return []
  const entries = (Array.isArray(input) ? input : [input])
    .flatMap((entry) => entry.split(/[,\s]+/))

  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    const name = entry.trim().replace(/^\/?(r\/)/i, '')
    if (name.length === 0) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}
