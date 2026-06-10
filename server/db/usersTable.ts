import type { Pool } from 'pg';
import type { User } from '../types.js';

const TABLE = 'users';

/**
 * Ensure the users table exists.
 *
 * Using CREATE TABLE IF NOT EXISTS means the server self-provisions the schema
 * on first start without a separate migration runner.
 */
export async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id            TEXT        PRIMARY KEY,
      email         TEXT        NOT NULL UNIQUE,
      password_hash TEXT        NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Insert a new user into the database.
 * Returns the created user record.
 */
export async function insertUser(
  pool: Pool,
  user: User,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${TABLE} (id, email, password_hash, created_at)
     VALUES ($1, $2, $3, $4)`,
    [user.id, user.email, user.passwordHash, user.createdAt],
  );
}

/**
 * Find a user by id.
 * Returns undefined if not found.
 */
export async function findById(pool: Pool, id: string): Promise<User | undefined> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    created_at: string;
  }>(`SELECT id, email, password_hash, created_at FROM ${TABLE} WHERE id = $1`, [id]);

  if (rows.length === 0) return undefined;

  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

/**
 * Find a user by email.
 * Returns undefined if not found.
 */
export async function findByEmail(pool: Pool, email: string): Promise<User | undefined> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    created_at: string;
  }>(`SELECT id, email, password_hash, created_at FROM ${TABLE} WHERE email = $1`, [
    email.toLowerCase().trim(),
  ]);

  if (rows.length === 0) return undefined;

  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

/**
 * Check if a user with the given email exists.
 */
export async function emailExists(pool: Pool, email: string): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM ${TABLE} WHERE email = $1`,
    [email.toLowerCase().trim()],
  );

  return rows.length > 0 && parseInt(rows[0].count, 10) > 0;
}
