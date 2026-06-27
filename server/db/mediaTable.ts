// ── Uploaded media (screenshots / images) ─────────────────────────────────────
// Stores image bytes so the server can attach them to social posts and expose a
// public URL (required by platforms like Instagram that fetch the image
// themselves). Bytes live in Postgres (BYTEA) when DATABASE_URL is set,
// otherwise an in-memory Map so local development works within a session.

import { randomUUID } from 'crypto';
import { getPool } from './connection.js';

export interface MediaRecord {
  id: string;
  userId: string;
  mimeType: string;
  byteSize: number;
  data: Buffer;
  createdAt: string;
}

export interface CreateMediaInput {
  userId: string;
  mimeType: string;
  data: Buffer;
}

// In-memory fallback: Map<mediaId, MediaRecord>
const memory = new Map<string, MediaRecord>();

export const mediaStore = {
  /** Ensure the media table exists. No-op when DATABASE_URL is not set. */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS media (
        id         TEXT        PRIMARY KEY,
        user_id    TEXT        NOT NULL,
        mime_type  TEXT        NOT NULL,
        byte_size  INTEGER     NOT NULL,
        data       BYTEA       NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  },

  /** Persist image bytes and return the generated media id. */
  async create(input: CreateMediaInput): Promise<string> {
    const id = randomUUID();
    const byteSize = input.data.length;
    const pool = getPool();

    if (!pool) {
      memory.set(id, {
        id,
        userId: input.userId,
        mimeType: input.mimeType,
        byteSize,
        data: input.data,
        createdAt: new Date().toISOString(),
      });
      return id;
    }

    await pool.query(
      `INSERT INTO media (id, user_id, mime_type, byte_size, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.userId, input.mimeType, byteSize, input.data],
    );
    return id;
  },

  /** Fetch a media record by id, or null when not found. */
  async get(id: string): Promise<MediaRecord | null> {
    const pool = getPool();
    if (!pool) return memory.get(id) ?? null;

    const { rows } = await pool.query<{
      id: string;
      user_id: string;
      mime_type: string;
      byte_size: number;
      data: Buffer;
    }>(
      'SELECT id, user_id, mime_type, byte_size, data FROM media WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      data: row.data,
      createdAt: '',
    };
  },

  /** Clear the in-memory fallback — for tests only. */
  _clear(): void {
    memory.clear();
  },
};
