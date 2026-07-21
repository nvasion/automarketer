import type { Pool } from 'pg';
import * as crypto from 'node:crypto';
import type { AgentCredentialsRecord, PlatformType } from '../types/agentAuth.js';
import { isPlatformType } from '../types/agentAuth.js';

const TABLE = 'agent_credentials';

/**
 * Generate a cryptographically secure random ID for credentials record.
 * Uses UUID v4 format to prevent predictable identifiers.
 */
function generateSecureId(): string {
  return crypto.randomUUID();
}

/**
 * Ensure the agent_credentials table exists.
 *
 * Using CREATE TABLE IF NOT EXISTS means the server self-provisions the schema
 * on first start without a separate migration runner.
 */
export async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id                  TEXT        PRIMARY KEY,
      user_id             TEXT        NOT NULL,
      platform            TEXT        NOT NULL,
      encrypted_credentials TEXT      NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_user_platform UNIQUE (user_id, platform)
    )
  `);
}

/**
 * Insert agent credentials into the database.
 */
export async function insertCredentials(
  pool: Pool,
  userId: string,
  platform: PlatformType,
  encryptedCredentials: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${TABLE} (id, user_id, platform, encrypted_credentials, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [
      generateSecureId(),
      userId,
      platform,
      encryptedCredentials,
    ],
  );
}

/**
 * Update agent credentials for a user/platform combination.
 */
export async function updateCredentials(
  pool: Pool,
  userId: string,
  platform: PlatformType,
  encryptedCredentials: string,
): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE} 
     SET encrypted_credentials = $1, updated_at = NOW()
     WHERE user_id = $2 AND platform = $3`,
    [encryptedCredentials, userId, platform],
  );
}

/**
 * Insert or update agent credentials for a user/platform combination in a
 * single atomic statement.
 *
 * Prefer this over a "find, then insert-or-update" sequence (as used by the
 * HTTP route layer) when callers do not already hold the existing record —
 * the two-step approach has a race window where two concurrent writers can
 * both see "not found" and both attempt an INSERT, tripping the
 * unique_user_platform constraint. ON CONFLICT sidesteps that entirely.
 */
export async function upsertCredentials(
  pool: Pool,
  userId: string,
  platform: PlatformType,
  encryptedCredentials: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${TABLE} (id, user_id, platform, encrypted_credentials, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (user_id, platform) DO UPDATE
       SET encrypted_credentials = EXCLUDED.encrypted_credentials,
           updated_at = NOW()`,
    [generateSecureId(), userId, platform, encryptedCredentials],
  );
}

/**
 * Find credentials by user ID and platform.
 * Returns undefined if not found.
 */
export async function findByUserAndPlatform(
  pool: Pool,
  userId: string,
  platform: PlatformType,
): Promise<AgentCredentialsRecord | undefined> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    platform: string;
    encrypted_credentials: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, user_id, platform, encrypted_credentials, created_at, updated_at 
     FROM ${TABLE} 
     WHERE user_id = $1 AND platform = $2`,
    [userId, platform],
  );

  if (rows.length === 0) return undefined;

  const row = rows[0];
  
  // Validate platform value before casting to prevent invalid data
  if (!isPlatformType(row.platform)) {
    throw new Error(`Invalid platform value in database: ${row.platform}`);
  }
  
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    encryptedCredentials: row.encrypted_credentials,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Delete credentials by user ID and platform.
 */
export async function deleteByUserAndPlatform(
  pool: Pool,
  userId: string,
  platform: PlatformType,
): Promise<void> {
  await pool.query(
    `DELETE FROM ${TABLE} WHERE user_id = $1 AND platform = $2`,
    [userId, platform],
  );
}

/**
 * Find all credentials for a user.
 */
export async function findByUser(
  pool: Pool,
  userId: string,
): Promise<AgentCredentialsRecord[]> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    platform: string;
    encrypted_credentials: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, user_id, platform, encrypted_credentials, created_at, updated_at 
     FROM ${TABLE} 
     WHERE user_id = $1`,
    [userId],
  );

  return rows.map((row) => {
    // Validate platform value before casting to prevent invalid data
    if (!isPlatformType(row.platform)) {
      throw new Error(`Invalid platform value in database: ${row.platform}`);
    }
    
    return {
      id: row.id,
      userId: row.user_id,
      platform: row.platform,
      encryptedCredentials: row.encrypted_credentials,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}