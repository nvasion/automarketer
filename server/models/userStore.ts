import { randomUUID } from 'crypto';
import type { User } from '../types.js';
import { getPool } from '../db/connection.js';
import { ensureTable, insertUser } from '../db/usersTable.js';

// Primary store keyed by user id (in-memory cache)
const usersById = new Map<string, User>();

// Secondary index keyed by normalised email — O(1) lookups instead of O(n)
const usersByEmail = new Map<string, User>();

/** Normalise an email to a canonical form for storage and lookup. */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export const userStore = {
  /**
   * Ensure the users table exists. Call once at server startup.
   * No-op when DATABASE_URL is not set (the in-memory cache is then the
   * only store, which is fine for dev/test).
   */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await ensureTable(pool);
    // Load existing users from DB into cache
    const { rows } = await pool.query<{
      id: string;
      email: string;
      password_hash: string;
      created_at: string;
    }>('SELECT id, email, password_hash, created_at FROM users');
    
    for (const row of rows) {
      const user: User = {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
      };
      usersById.set(user.id, user);
      usersByEmail.set(normalizeEmail(user.email), user);
    }
  },

  create(email: string, passwordHash: string): User {
    const normalized = normalizeEmail(email);
    const user: User = {
      id: randomUUID(),
      email: normalized,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    usersById.set(user.id, user);
    usersByEmail.set(normalized, user);
    return user;
  },

  /**
   * Persist a user to the database. Call this after create() to ensure
   * the user survives server restarts.
   */
  async saveToDb(user: User): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await insertUser(pool, user);
  },

  findById(id: string): User | undefined {
    return usersById.get(id);
  },

  /** O(1) lookup via the secondary email index. */
  findByEmail(email: string): User | undefined {
    return usersByEmail.get(normalizeEmail(email));
  },

  emailExists(email: string): boolean {
    return usersByEmail.has(normalizeEmail(email));
  },

  /** Clear all state — only for use in tests. */
  _clear(): void {
    usersById.clear();
    usersByEmail.clear();
  },
};
