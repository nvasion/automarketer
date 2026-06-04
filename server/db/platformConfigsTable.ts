import type { Pool } from 'pg';

const TABLE = 'platform_configs';

/**
 * Ensure the platform_configs table exists.
 *
 * Using CREATE TABLE IF NOT EXISTS means the server self-provisions the schema
 * on first start without a separate migration runner. The table stores one row
 * per platform so operators can update client IDs through the admin API without
 * redeploying or touching environment variables.
 */
export async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      platform   TEXT        PRIMARY KEY,
      client_id  TEXT        NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Load all platform configs from the database.
 * Returns an empty object if the table is empty.
 */
export async function loadAll(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ platform: string; client_id: string }>(
    `SELECT platform, client_id FROM ${TABLE}`,
  );
  return Object.fromEntries(rows.map((r) => [r.platform, r.client_id]));
}

/**
 * Insert or update a single platform client ID.
 * Using UPSERT so callers don't need to track whether the row already exists.
 */
export async function upsert(
  pool: Pool,
  platform: string,
  clientId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${TABLE} (platform, client_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (platform) DO UPDATE
       SET client_id  = EXCLUDED.client_id,
           updated_at = NOW()`,
    [platform, clientId],
  );
}
