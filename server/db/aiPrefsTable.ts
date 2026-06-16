// ── Per-user AI generation preferences ────────────────────────────────────────
// Stores ONLY non-sensitive content-generation defaults (tone, emoji usage,
// auto-hashtags, max tokens, temperature) so they follow the user across
// browsers and devices.
//
// IMPORTANT: provider API keys are deliberately NOT stored here. Keys stay in
// the browser's localStorage by design (see src/config/aiConfig.ts and the
// Security section of the README) so secrets never reach the server.
//
// Storage strategy mirrors the other stores: database when DATABASE_URL is set,
// otherwise an in-memory Map so local development still works within a session.

import { getPool } from './connection.js';

export interface AiPrefs {
  tone: string;
  emojiUsage: string;
  autoHashtags: boolean;
  maxTokens: number;
  temperature: number;
}

// In-memory fallback: Map<userId, AiPrefs>
const memory = new Map<string, AiPrefs>();

export const aiPrefsStore = {
  /** Ensure the table exists. No-op when DATABASE_URL is not set. */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_ai_prefs (
        user_id       TEXT    PRIMARY KEY,
        tone          TEXT    NOT NULL,
        emoji_usage   TEXT    NOT NULL,
        auto_hashtags BOOLEAN NOT NULL,
        max_tokens    INTEGER NOT NULL,
        temperature   REAL    NOT NULL,
        updated_at    TEXT    NOT NULL
      )
    `);
  },

  /** Return a user's saved preferences, or null when none are stored. */
  async get(userId: string): Promise<AiPrefs | null> {
    const pool = getPool();
    if (!pool) {
      const prefs = memory.get(userId);
      return prefs ? { ...prefs } : null;
    }

    const { rows } = await pool.query<{
      tone: string;
      emoji_usage: string;
      auto_hashtags: boolean;
      max_tokens: number;
      temperature: number;
    }>(
      'SELECT tone, emoji_usage, auto_hashtags, max_tokens, temperature FROM user_ai_prefs WHERE user_id = $1',
      [userId],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      tone: row.tone,
      emojiUsage: row.emoji_usage,
      autoHashtags: row.auto_hashtags,
      maxTokens: row.max_tokens,
      temperature: row.temperature,
    };
  },

  /** Insert or replace a user's preferences. */
  async set(userId: string, prefs: AiPrefs): Promise<void> {
    const pool = getPool();
    const now = new Date().toISOString();
    if (!pool) {
      memory.set(userId, { ...prefs });
      return;
    }

    await pool.query(
      `INSERT INTO user_ai_prefs (user_id, tone, emoji_usage, auto_hashtags, max_tokens, temperature, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         tone = EXCLUDED.tone,
         emoji_usage = EXCLUDED.emoji_usage,
         auto_hashtags = EXCLUDED.auto_hashtags,
         max_tokens = EXCLUDED.max_tokens,
         temperature = EXCLUDED.temperature,
         updated_at = EXCLUDED.updated_at`,
      [userId, prefs.tone, prefs.emojiUsage, prefs.autoHashtags, prefs.maxTokens, prefs.temperature, now],
    );
  },

  /** Clear the in-memory fallback — for tests only. */
  _clear(): void {
    memory.clear();
  },
};
