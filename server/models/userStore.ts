import { randomUUID } from 'crypto';
import type { User } from '../types.js';

// Primary store keyed by user id
const usersById = new Map<string, User>();

// Secondary index keyed by normalised email — O(1) lookups instead of O(n)
// TODO: Replace both Maps with indexed DB queries once the ORM layer is wired up.
const usersByEmail = new Map<string, User>();

/** Normalise an email to a canonical form for storage and lookup. */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export const userStore = {
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
