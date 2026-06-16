// ── Per-user campaign store ───────────────────────────────────────────────────
// Persists marketing campaigns for each user. Campaigns were previously stored
// only in the browser's localStorage, which meant they vanished in a new
// browser/incognito session even though the account itself lived in the
// database. This store moves them server-side so they follow the account.
//
// Storage strategy (mirrors accessTokenStore):
//   1. Database (campaigns table) — persistent storage across restarts/devices.
//   2. In-memory Map fallback — used only when DATABASE_URL is not configured,
//      so local development without a database still works within a session.
//
// The full CampaignRecord is stored as a JSONB document. Nested arrays (posts,
// screenshots, platforms, subreddits) make a document model the pragmatic
// choice over a fully normalized schema.

import { getPool } from './connection.js';
import type { CampaignRecord } from '../../src/db/schema.js';

// In-memory fallback: Map<userId, Map<campaignId, CampaignRecord>>
const memory = new Map<string, Map<string, CampaignRecord>>();

function memoryFor(userId: string): Map<string, CampaignRecord> {
  let m = memory.get(userId);
  if (!m) {
    m = new Map();
    memory.set(userId, m);
  }
  return m;
}

function sortByCreatedAtDesc(records: CampaignRecord[]): CampaignRecord[] {
  return records.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export const campaignStore = {
  /**
   * Ensure the table exists. Call once at server startup.
   * No-op when DATABASE_URL is not set.
   */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        user_id    TEXT  NOT NULL,
        id         TEXT  NOT NULL,
        data       JSONB NOT NULL,
        created_at TEXT  NOT NULL,
        updated_at TEXT  NOT NULL,
        PRIMARY KEY (user_id, id)
      )
    `);
  },

  /** Return all campaigns for a user, sorted by createdAt descending. */
  async findAll(userId: string): Promise<CampaignRecord[]> {
    const pool = getPool();
    if (!pool) {
      return sortByCreatedAtDesc([...memoryFor(userId).values()].map((r) => ({ ...r })));
    }

    const { rows } = await pool.query<{ data: CampaignRecord }>(
      'SELECT data FROM campaigns WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map((row) => row.data);
  },

  /** Return a single campaign by id, or null when it does not exist. */
  async findById(userId: string, id: string): Promise<CampaignRecord | null> {
    const pool = getPool();
    if (!pool) {
      const record = memoryFor(userId).get(id);
      return record ? { ...record } : null;
    }

    const { rows } = await pool.query<{ data: CampaignRecord }>(
      'SELECT data FROM campaigns WHERE user_id = $1 AND id = $2',
      [userId, id],
    );
    return rows.length > 0 ? rows[0].data : null;
  },

  /**
   * Insert or replace a campaign. The caller is responsible for assigning the
   * id and timestamps on the record before calling this.
   */
  async upsert(userId: string, record: CampaignRecord): Promise<CampaignRecord> {
    const pool = getPool();
    if (!pool) {
      memoryFor(userId).set(record.id, { ...record });
      return record;
    }

    await pool.query(
      `INSERT INTO campaigns (user_id, id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, id) DO UPDATE SET
         data = EXCLUDED.data,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [userId, record.id, JSON.stringify(record), record.createdAt, record.updatedAt],
    );
    return record;
  },

  /** Delete a campaign. Returns true when a row was removed. */
  async delete(userId: string, id: string): Promise<boolean> {
    const pool = getPool();
    if (!pool) {
      return memoryFor(userId).delete(id);
    }

    const { rowCount } = await pool.query(
      'DELETE FROM campaigns WHERE user_id = $1 AND id = $2',
      [userId, id],
    );
    return (rowCount ?? 0) > 0;
  },

  /** Clear the in-memory fallback — for tests only. */
  _clear(): void {
    memory.clear();
  },
};
