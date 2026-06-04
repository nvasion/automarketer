// ── OAuth platform client ID store ────────────────────────────────────────────
// Client IDs are PUBLIC values — they appear in OAuth redirect URLs and are
// safe to serve via the API. Never store client secrets here.
//
// Storage strategy (in priority order):
//   1. Database (platform_configs table) — primary, persistent across restarts.
//      Administrators update values through the authenticated admin API.
//   2. Environment variables — used to seed the DB on first start so operators
//      have a fallback without needing to call the API immediately after deploy.
//   3. In-memory cache — always kept in sync with the DB for fast synchronous
//      reads. The cache is the only store used when DATABASE_URL is not set
//      (development / test mode).
//
// Supported env vars (none are VITE_* — they live on the server only):
//   LINKEDIN_CLIENT_ID
//   TWITTER_CLIENT_ID
//   REDDIT_CLIENT_ID
//   FACEBOOK_APP_ID   (shared by both Facebook and Instagram)

import { getPool } from '../db/connection.js';
import { ensureTable, loadAll, upsert } from '../db/platformConfigsTable.js';

const PLATFORMS = ['linkedin', 'twitter', 'reddit', 'facebook', 'instagram'] as const;

function envDefaults(): Record<string, string> {
  const fb = process.env.FACEBOOK_APP_ID ?? '';
  return {
    linkedin:  process.env.LINKEDIN_CLIENT_ID ?? '',
    twitter:   process.env.TWITTER_CLIENT_ID  ?? '',
    reddit:    process.env.REDDIT_CLIENT_ID   ?? '',
    facebook:  fb,
    // Instagram Graph API access uses the same Meta App ID as Facebook.
    instagram: fb,
  };
}

// Mutable in-memory cache — always reflects the latest known state.
// Seeded from env vars at module load; overwritten by the DB on initialize().
const cache = new Map<string, string>(Object.entries(envDefaults()));

export const platformConfigStore = {
  /**
   * Load platform client IDs from the database.
   *
   * Call this once at server startup. It:
   *   1. Creates the platform_configs table if it doesn't exist.
   *   2. Seeds any missing rows from environment variables so administrators
   *      can pre-populate values via .env without touching the admin API.
   *   3. Reads all rows into the in-memory cache so subsequent getAll() /
   *      getClientId() calls remain synchronous.
   *
   * If DATABASE_URL is not set (dev/test mode) this is a no-op and the cache
   * retains the env-var defaults loaded at module import time.
   */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return; // no database configured — use env-var defaults

    await ensureTable(pool);

    // Read whatever's already in the DB.
    const dbValues = await loadAll(pool);

    // For each platform, seed the DB row from env vars if the row is absent or
    // empty (e.g. first deployment). DB value wins if it's already populated.
    const defaults = envDefaults();
    for (const platform of PLATFORMS) {
      const dbValue = dbValues[platform];
      if (dbValue !== undefined && dbValue !== '') {
        // DB has a real value — trust it.
        cache.set(platform, dbValue);
      } else {
        // DB row is missing or empty — seed from env var.
        const envValue = defaults[platform] ?? '';
        cache.set(platform, envValue);
        await upsert(pool, platform, envValue);
      }
    }
  },

  /** Returns all platform client IDs. Empty string means not yet configured. */
  getAll(): Record<string, string> {
    return Object.fromEntries(cache);
  },

  /** Returns the client ID for a specific platform, or '' if not configured. */
  getClientId(platform: string): string {
    return cache.get(platform) ?? '';
  },

  /**
   * Update the in-memory cache immediately (synchronous).
   *
   * Use this together with saveToDb() in production code so the new value is
   * served instantly AND persisted across restarts. In tests, calling only
   * setClientId() is sufficient because there is no database.
   */
  setClientId(platform: string, clientId: string): void {
    cache.set(platform, clientId);
  },

  /**
   * Persist a client ID to the database (asynchronous).
   *
   * This is a no-op when DATABASE_URL is not set. Always call setClientId()
   * first to update the in-memory cache, then call saveToDb() to persist.
   */
  async saveToDb(platform: string, clientId: string): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await upsert(pool, platform, clientId);
  },

  /**
   * Reset the cache to the current environment-variable defaults.
   *
   * FOR USE IN TESTS ONLY — never call this in production code.
   */
  _reset(): void {
    cache.clear();
    for (const [k, v] of Object.entries(envDefaults())) {
      cache.set(k, v);
    }
  },
};
