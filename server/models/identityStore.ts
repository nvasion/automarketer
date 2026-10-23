import { getPool } from '../db/connection.js';
import {
  ensureTable,
  findIdentity,
  insertIdentity,
  listIdentitiesForUser,
  deleteIdentity,
  type IdentityRow,
} from '../db/userIdentitiesTable.js';

/**
 * Linked sign-in identities (user_identities). Uses Postgres when
 * DATABASE_URL is set, otherwise an in-memory map (dev/test), like every
 * other store.
 */

const memory = new Map<string, IdentityRow>(); // key: `${provider}\u0000${subject}`
const key = (provider: string, subject: string) => `${provider}\u0000${subject}`;

export const identityStore = {
  /** Create the table. Call after userStore.initialize() (foreign key on users). */
  async initialize(): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    await ensureTable(pool);
  },

  async find(provider: string, subject: string): Promise<IdentityRow | undefined> {
    const pool = getPool();
    if (pool) return findIdentity(pool, provider, subject);
    return memory.get(key(provider, subject));
  },

  /** Links (provider, subject) to userId. False when it is already linked (to anyone). */
  async add(provider: string, subject: string, userId: string): Promise<boolean> {
    const pool = getPool();
    if (pool) return insertIdentity(pool, provider, subject, userId);
    const k = key(provider, subject);
    if (memory.has(k)) return false;
    memory.set(k, { provider, subject, userId, createdAt: new Date().toISOString() });
    return true;
  },

  async listForUser(userId: string): Promise<IdentityRow[]> {
    const pool = getPool();
    if (pool) return listIdentitiesForUser(pool, userId);
    return [...memory.values()].filter((i) => i.userId === userId);
  },

  /** Removes the user's identities for a provider; returns how many were removed. */
  async remove(userId: string, provider: string): Promise<number> {
    const pool = getPool();
    if (pool) return deleteIdentity(pool, userId, provider);
    let n = 0;
    for (const [k, v] of memory) {
      if (v.userId === userId && v.provider === provider) {
        memory.delete(k);
        n++;
      }
    }
    return n;
  },

  /** Clear all state — only for use in tests. */
  _clear(): void {
    memory.clear();
  },
};
