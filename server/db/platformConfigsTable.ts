import type { Pool } from 'pg';

const TABLE = 'user_platform_configs';

/**
 * Ensure the user_platform_configs table exists.
 *
 * Each row is owned by a single user — every account manages its OAuth client
 * IDs independently, with no shared global config and no administrator role.
 *
 * Using CREATE TABLE IF NOT EXISTS means the server self-provisions the schema
 * on first start without a separate migration runner.
 */
export async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      user_id    TEXT        NOT NULL,
      platform   TEXT        NOT NULL,
      client_id  TEXT        NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, platform)
    )
  `);
}

/**
 * Load all platform configs for a single user.
 * Returns an empty object when the user has no rows yet.
 */
export async function loadAllForUser(
  pool: Pool,
  userId: string,
): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ platform: string; client_id: string }>(
    `SELECT platform, client_id FROM ${TABLE} WHERE user_id = $1`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.platform, r.client_id]));
}

/**
 * Insert or update a single platform client ID for a user.
 * Using UPSERT so callers don't need to track whether the row already exists.
 */
export async function upsertForUser(
  pool: Pool,
  userId: string,
  platform: string,
  clientId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${TABLE} (user_id, platform, client_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, platform) DO UPDATE
       SET client_id  = EXCLUDED.client_id,
           updated_at = NOW()`,
    [userId, platform, clientId],
  );
}
