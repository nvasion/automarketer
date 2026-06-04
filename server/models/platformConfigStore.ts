// ── Per-user OAuth platform client ID store ───────────────────────────────────
// Every authenticated user owns their own set of OAuth client IDs — one row
// per (user_id, platform) pair in the user_platform_configs table. There is
// no shared global config and no administrator role: each account creates
// its own OAuth apps and pastes the resulting client IDs into the connection
// modal.
//
// Client IDs are PUBLIC values — they appear in OAuth redirect URLs and are
// safe to serve back to the owning user's browser. Never store client secrets
// in this table.
//
// Storage strategy:
//   1. Database (user_platform_configs) — primary, persistent across restarts.
//   2. In-memory cache — keyed by user id, kept in sync with the DB so reads
//      stay synchronous within a single process. When DATABASE_URL is not
//      set (development / test mode) the cache is the only store.

import { getPool } from '../db/connection.js';
import { ensureTable, loadAllForUser, upsertForUser } from '../db/platformConfigsTable.js';

export const SUPPORTED_PLATFORMS = [
  'linkedin',
  'twitter',
  'reddit',
  'facebook',
  'instagram',
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

// Per-user in-memory cache. Map<userId, Map<platform, clientId>>.
// Mirrors the rows we have loaded from the DB so far; users absent from this
// map have not yet had their config touched in this process.
const cache = new Map<string, Map<string, string>>();

function getUserMap(userId: string): Map<string, string> {
  let userMap = cache.get(userId);
  if (!userMap) {
    userMap = new Map();
    cache.set(userId, userMap);
  }
  return userMap;
}

/**
 * Build a complete config record for a user — every supported platform is
 * represented, with empty strings for platforms the user hasn't configured.
 * This guarantees the response shape stays stable across users and avoids
 * leaking the set of configured platforms through key presence.
 */
function fillDefaults(partial: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    out[platform] = partial[platform] ?? '';
  }
  return out;
}

export const platformConfigStore = {
  /**
   * Ensure the underlying table exists. Call once at server startup.
   * No-op when DATABASE_URL is not set (the in-memory cache is then the
   * only store, which is fine for dev/test).
   */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await ensureTable(pool);
  },

  /**
   * Load (or refresh) a user's platform configs from the database into the
   * in-memory cache. Safe to call repeatedly; each call replaces the cached
   * entry for this user. No-op when DATABASE_URL is not set.
   */
  async loadForUser(userId: string): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    const dbValues = await loadAllForUser(pool, userId);
    const userMap = new Map<string, string>();
    for (const platform of SUPPORTED_PLATFORMS) {
      userMap.set(platform, dbValues[platform] ?? '');
    }
    cache.set(userId, userMap);
  },

  /**
   * Returns the user's full platform-config map (one entry per supported
   * platform, empty string when unconfigured).
   *
   * Reads from the in-memory cache only — callers that need fresh DB values
   * should `await loadForUser(userId)` first.
   */
  getAllForUser(userId: string): Record<string, string> {
    const userMap = cache.get(userId);
    if (!userMap) return fillDefaults({});
    return fillDefaults(Object.fromEntries(userMap));
  },

  /**
   * Returns a single platform client ID for a user, or '' when not set.
   * Reads from the in-memory cache only.
   */
  getClientIdForUser(userId: string, platform: string): string {
    return cache.get(userId)?.get(platform) ?? '';
  },

  /**
   * Update the in-memory cache for a user/platform pair (synchronous).
   *
   * Pair with saveToDbForUser() in production code so the new value is served
   * immediately AND persisted across restarts. In tests, calling only this
   * method is sufficient because there is no database.
   */
  setClientIdForUser(userId: string, platform: string, clientId: string): void {
    getUserMap(userId).set(platform, clientId);
  },

  /**
   * Persist a single client ID to the database for a user. No-op when
   * DATABASE_URL is not set.
   */
  async saveToDbForUser(
    userId: string,
    platform: string,
    clientId: string,
  ): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await upsertForUser(pool, userId, platform, clientId);
  },

  /**
   * Clear the in-memory cache for ALL users.
   *
   * FOR USE IN TESTS ONLY — never call this in production code.
   */
  _clear(): void {
    cache.clear();
  },
};
