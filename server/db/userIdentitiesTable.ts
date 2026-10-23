import type { Pool } from 'pg';

/**
 * External sign-in identities linked to AutoMarketer users. One row per
 * (provider, subject): today only provider 'tynhub', subject = the TynHub
 * user id (the ID token's `sub`).
 */
const TABLE = 'user_identities';

export interface IdentityRow {
  provider: string;
  subject: string;
  userId: string;
  createdAt: string;
}

/**
 * Ensure the table exists. Must run after the users table is created (the
 * user_id foreign key references it).
 */
export async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      provider   TEXT        NOT NULL,
      subject    TEXT        NOT NULL,
      user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, subject)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_identities_user_id_idx ON ${TABLE} (user_id)`);
}

type Row = { provider: string; subject: string; user_id: string; created_at: Date | string };

function toIdentity(row: Row): IdentityRow {
  return {
    provider: row.provider,
    subject: row.subject,
    userId: row.user_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function findIdentity(
  pool: Pool,
  provider: string,
  subject: string,
): Promise<IdentityRow | undefined> {
  const { rows } = await pool.query<Row>(
    `SELECT provider, subject, user_id, created_at FROM ${TABLE} WHERE provider = $1 AND subject = $2`,
    [provider, subject],
  );
  return rows[0] ? toIdentity(rows[0]) : undefined;
}

/** Insert an identity. Returns false when (provider, subject) is already taken. */
export async function insertIdentity(
  pool: Pool,
  provider: string,
  subject: string,
  userId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO ${TABLE} (provider, subject, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [provider, subject, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listIdentitiesForUser(pool: Pool, userId: string): Promise<IdentityRow[]> {
  const { rows } = await pool.query<Row>(
    `SELECT provider, subject, user_id, created_at FROM ${TABLE} WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows.map(toIdentity);
}

export async function deleteIdentity(pool: Pool, userId: string, provider: string): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM ${TABLE} WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return rowCount ?? 0;
}
