// ── Per-user OAuth access token store ─────────────────────────────────────────
// Stores OAuth access tokens for each user/platform pair. Tokens are obtained
// during the OAuth flow and used when making API calls to publish posts.
//
// Storage strategy:
//   1. In-memory cache — for fast lookups during publishing
//   2. Database (user_access_tokens) — persistent storage across restarts
//
// IMPORTANT: Access tokens are sensitive credentials. In production they should
// be encrypted at rest. This implementation stores them plaintext for simplicity
// but you SHOULD add encryption before deploying to production.

import { getPool } from '../db/connection.js';
import { refreshAccessToken } from '../utils/tokenRefresh.js';

interface TokenEntry {
  accessToken: string;
  expiresAt?: string; // ISO 8601 timestamp
  refreshToken?: string;
  authorId?: string; // platform author identifier (e.g. LinkedIn member URN)
  updatedAt: string;
}

// Per-user in-memory cache: Map<userId, Map<platform, TokenEntry>>
const cache = new Map<string, Map<string, TokenEntry>>();

function getUserMap(userId: string): Map<string, TokenEntry> {
  let userMap = cache.get(userId);
  if (!userMap) {
    userMap = new Map();
    cache.set(userId, userMap);
  }
  return userMap;
}

export const accessTokenStore = {
  /**
   * Ensure the table exists. Call once at server startup.
   * No-op when DATABASE_URL is not set.
   */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_access_tokens (
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        access_token TEXT NOT NULL,
        expires_at TEXT,
        refresh_token TEXT,
        author_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        PRIMARY KEY (user_id, platform)
      )
    `);

    // Add author_id to tables created before this column existed.
    await pool.query('ALTER TABLE user_access_tokens ADD COLUMN IF NOT EXISTS author_id TEXT');
  },

  /**
   * Store an access token for a user/platform pair.
   */
  async setAccessToken(
    userId: string,
    platform: string,
    accessToken: string,
    options?: {
      expiresAt?: string;
      refreshToken?: string;
      authorId?: string;
    }
  ): Promise<void> {
    const pool = getPool();
    const now = new Date().toISOString();

    // Update in-memory cache, preserving a previously resolved authorId when
    // this call does not supply one (e.g. a token-only refresh).
    const userMap = getUserMap(userId);
    const previous = userMap.get(platform);
    userMap.set(platform, {
      accessToken,
      expiresAt: options?.expiresAt,
      refreshToken: options?.refreshToken,
      authorId: options?.authorId ?? previous?.authorId,
      updatedAt: now,
    });

    // Persist to database
    if (pool) {
      await pool.query(
        `INSERT INTO user_access_tokens (user_id, platform, access_token, expires_at, refresh_token, author_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, platform) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           expires_at = EXCLUDED.expires_at,
           refresh_token = EXCLUDED.refresh_token,
           author_id = COALESCE(EXCLUDED.author_id, user_access_tokens.author_id),
           updated_at = EXCLUDED.updated_at`,
        [userId, platform, accessToken, options?.expiresAt, options?.refreshToken, options?.authorId, now]
      );
      console.log(
        `[accessTokenStore] stored ${platform} token for user=${userId} ` +
          `(expires=${options?.expiresAt ?? 'never'}, persisted to database)`
      );
    } else {
      console.warn(
        `[accessTokenStore] stored ${platform} token for user=${userId} IN MEMORY ONLY — ` +
          'DATABASE_URL is not set, so this connection will be lost when the server restarts ' +
          '(tsx watch restarts on every server file change).'
      );
    }
  },

  /**
   * Get the access token for a user/platform pair.
   * Returns null if no token exists or if it's expired; the miss reason is
   * logged so "disconnected" reports can be traced.
   */
  getAccessToken(userId: string, platform: string): string | null {
    const userMap = cache.get(userId);
    if (!userMap) {
      console.warn(
        `[accessTokenStore] miss: no tokens cached for user=${userId} — ` +
          'either the user never connected a platform, or the server restarted and the cache is cold.'
      );
      return null;
    }

    const entry = userMap.get(platform);
    if (!entry) {
      console.warn(
        `[accessTokenStore] miss: no ${platform} token for user=${userId} ` +
          `(cached platforms: ${[...userMap.keys()].join(', ') || 'none'})`
      );
      return null;
    }

    // Check if token is expired
    if (entry.expiresAt) {
      const expiresAt = new Date(entry.expiresAt).getTime();
      if (Date.now() >= expiresAt) {
        // Token is expired - could refresh if we had a refresh_token
        // For now, just return null and let the user re-authenticate
        console.warn(
          `[accessTokenStore] miss: ${platform} token for user=${userId} expired at ${entry.expiresAt} — ` +
            'the user must reconnect the platform.'
        );
        return null;
      }
    }

    return entry.accessToken;
  },

  /**
   * Return the platforms the user is connected to. A platform counts as
   * connected when its token is unexpired OR it has a refresh token (so the
   * access token can be renewed on demand at publish time). Callers needing
   * fresh data after a server restart should `await loadForUser(userId)` first.
   */
  listConnectedPlatforms(userId: string): string[] {
    const userMap = cache.get(userId);
    if (!userMap) return [];
    const now = Date.now();
    const connected: string[] = [];
    for (const [platform, entry] of userMap) {
      const expired = Boolean(entry.expiresAt) && now >= new Date(entry.expiresAt!).getTime();
      // Expired AND no way to renew → truly disconnected.
      if (expired && !entry.refreshToken) continue;
      connected.push(platform);
    }
    return connected;
  },

  /**
   * Get a USABLE access token for a user/platform pair, refreshing it via the
   * stored refresh token when the current one is expired (or within 60s of it).
   * Warms the cache from the database on a miss. Returns null when there is no
   * token, or it is expired and cannot be refreshed (user must reconnect).
   */
  async getValidAccessToken(userId: string, platform: string): Promise<string | null> {
    let entry = cache.get(userId)?.get(platform);
    if (!entry) {
      await this.loadForUser(userId);
      entry = cache.get(userId)?.get(platform);
    }
    if (!entry) {
      console.warn(`[accessTokenStore] miss: no ${platform} token for user=${userId} — reconnect required.`);
      return null;
    }

    // Renew slightly before expiry to avoid races with in-flight requests.
    const SKEW_MS = 60_000;
    const expiringSoon = entry.expiresAt
      ? Date.now() + SKEW_MS >= new Date(entry.expiresAt).getTime()
      : false;

    if (!expiringSoon) return entry.accessToken;

    if (!entry.refreshToken) {
      console.warn(
        `[accessTokenStore] ${platform} token for user=${userId} expired and no refresh token is stored — reconnect required.`,
      );
      return null;
    }

    console.log(`[accessTokenStore] refreshing expired ${platform} token for user=${userId}`);
    const refreshed = await refreshAccessToken(platform, entry.refreshToken);
    if (!refreshed) {
      console.warn(`[accessTokenStore] ${platform} token refresh failed for user=${userId} — reconnect required.`);
      return null;
    }

    // Persist the new token. Keep the old refresh token when the provider did
    // not rotate it (Reddit/LinkedIn); store the new one when it did (X).
    await this.setAccessToken(userId, platform, refreshed.accessToken, {
      expiresAt: refreshed.expiresAt,
      refreshToken: refreshed.refreshToken ?? entry.refreshToken,
    });
    console.log(`[accessTokenStore] ${platform} token refreshed for user=${userId} (expires ${refreshed.expiresAt ?? 'unknown'})`);
    return refreshed.accessToken;
  },

  /**
   * Get the stored author identifier (e.g. LinkedIn member URN) for a
   * user/platform pair, or null if none was resolved. Unlike getAccessToken
   * this does not apply the token-expiry check — the author ID stays valid
   * across token refreshes.
   */
  getAuthorId(userId: string, platform: string): string | null {
    return cache.get(userId)?.get(platform)?.authorId ?? null;
  },

  /**
   * Set just the author identifier for an existing token, leaving the access
   * token and its expiry untouched. Used to backfill the author ID for
   * connections made before it was persisted. No-op if no token is cached.
   */
  async setAuthorId(userId: string, platform: string, authorId: string): Promise<void> {
    const entry = cache.get(userId)?.get(platform);
    if (entry) {
      entry.authorId = authorId;
    }

    const pool = getPool();
    if (pool) {
      await pool.query(
        'UPDATE user_access_tokens SET author_id = $3 WHERE user_id = $1 AND platform = $2',
        [userId, platform, authorId]
      );
    }
  },

  /**
   * Delete a token for a user/platform pair.
   */
  async deleteToken(userId: string, platform: string): Promise<void> {
    const pool = getPool();
    
    // Remove from cache
    const userMap = cache.get(userId);
    if (userMap) {
      userMap.delete(platform);
    }
    
    // Delete from database
    if (pool) {
      await pool.query(
        'DELETE FROM user_access_tokens WHERE user_id = $1 AND platform = $2',
        [userId, platform]
      );
    }
  },

  /**
   * Load a user's tokens from the database into the cache.
   */
  async loadForUser(userId: string): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    
    const result = await pool.query<{
      platform: string;
      access_token: string;
      expires_at: string | null;
      refresh_token: string | null;
      author_id: string | null;
      updated_at: string;
    }>(
      'SELECT platform, access_token, expires_at, refresh_token, author_id, updated_at FROM user_access_tokens WHERE user_id = $1',
      [userId]
    );

    const userMap = new Map<string, TokenEntry>();
    for (const row of result.rows) {
      userMap.set(row.platform, {
        accessToken: row.access_token,
        expiresAt: row.expires_at ?? undefined,
        refreshToken: row.refresh_token ?? undefined,
        authorId: row.author_id ?? undefined,
        updatedAt: row.updated_at,
      });
    }

    cache.set(userId, userMap);
    console.log(
      `[accessTokenStore] loaded ${userMap.size} token(s) from database for user=${userId}` +
        (userMap.size > 0 ? ` (${[...userMap.keys()].join(', ')})` : '')
    );
  },

  /**
   * Clear the cache — for tests only.
   */
  _clear(): void {
    cache.clear();
  },
};
