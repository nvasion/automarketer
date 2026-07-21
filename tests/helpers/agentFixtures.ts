/**
 * Test fixtures for the agent-based authentication workflow (Reddit/X
 * username+password "agent" login — see server/routes/agentAuth.ts,
 * server/db/agentCredentialsTable.ts and server/utils/agentCredentialEncryption.ts).
 *
 * No test database is available in this environment (DATABASE_URL is unset),
 * so `getPool()` returns null and the HTTP routes short-circuit to
 * 503 DB_UNAVAILABLE before ever touching the database layer. To still
 * exercise credential storage and token retrieval end-to-end, these fixtures
 * provide a minimal in-memory stand-in for a `pg` Pool that understands only
 * the exact queries `server/db/agentCredentialsTable.ts` issues. Tests pass
 * it directly to that module's functions via dependency injection — the same
 * pattern the real route handlers use (`insertCredentials(pool, ...)` etc.).
 *
 * This is intentionally NOT a general-purpose SQL engine: any query it does
 * not recognise throws immediately, so a drift between this fixture and the
 * real implementation fails the test loudly instead of silently returning
 * the wrong data.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Application } from 'express';
import type { Pool } from 'pg';
import type { AgentCredentials, PlatformType } from '../../server/types/agentAuth';

// ─── Fake pg Pool for the agent_credentials table ─────────────────────────────

interface FakeAgentCredentialsRow {
  id: string;
  user_id: string;
  platform: string;
  encrypted_credentials: string;
  created_at: string;
  updated_at: string;
}

/** Test-only extensions exposed on the fake pool for setup/assertions. */
export interface FakeAgentPool {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Removes every stored row. Call between tests to prevent cross-test leakage. */
  _clear(): void;
  /** Number of rows currently stored, for assertions. */
  _size(): number;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

function rowKey(userId: string, platform: string): string {
  return `${userId}:${platform}`;
}

/**
 * Creates a fresh in-memory stand-in for the `agent_credentials` table.
 * Cast to `Pool` so it can be passed directly to agentCredentialsTable.ts
 * functions, which are typed against the real `pg` Pool.
 */
export function createFakeAgentPool(): Pool & FakeAgentPool {
  const rows = new Map<string, FakeAgentCredentialsRow>();

  const pool: FakeAgentPool = {
    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('CREATE TABLE')) {
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO AGENT_CREDENTIALS')) {
        const [id, userId, platform, encryptedCredentials] = params as string[];
        const now = new Date().toISOString();
        rows.set(rowKey(userId, platform), {
          id,
          user_id: userId,
          platform,
          encrypted_credentials: encryptedCredentials,
          created_at: now,
          updated_at: now,
        });
        return { rows: [] };
      }

      if (normalized.startsWith('UPDATE AGENT_CREDENTIALS')) {
        const [encryptedCredentials, userId, platform] = params as string[];
        const existing = rows.get(rowKey(userId, platform));
        if (existing) {
          existing.encrypted_credentials = encryptedCredentials;
          existing.updated_at = new Date().toISOString();
        }
        return { rows: [] };
      }

      if (normalized.startsWith('DELETE FROM AGENT_CREDENTIALS')) {
        const [userId, platform] = params as string[];
        rows.delete(rowKey(userId, platform));
        return { rows: [] };
      }

      if (normalized.startsWith('SELECT') && normalized.includes('FROM AGENT_CREDENTIALS')) {
        if (normalized.includes('AND PLATFORM')) {
          const [userId, platform] = params as string[];
          const row = rows.get(rowKey(userId, platform));
          return { rows: (row ? [row] : []) as T[] };
        }
        const [userId] = params as string[];
        const all = [...rows.values()].filter((r) => r.user_id === userId);
        return { rows: all as T[] };
      }

      throw new Error(`[agentFixtures] fake pool received an unrecognised query: ${sql}`);
    },

    _clear(): void {
      rows.clear();
    },

    _size(): number {
      return rows.size;
    },
  };

  return pool as unknown as Pool & FakeAgentPool;
}

// ─── Credential payload builders ───────────────────────────────────────────────

export const AGENT_PLATFORMS: PlatformType[] = ['reddit', 'x'];

/** A valid AgentCredentials payload. Pass overrides to build invalid variants for negative tests. */
export function buildAgentCredentials(overrides: Partial<AgentCredentials> = {}): AgentCredentials {
  return {
    username: 'agent-user',
    password: 'agent-password-123',
    clientId: 'client-id-abc',
    clientSecret: 'client-secret-xyz',
    ...overrides,
  };
}

/** A unique user id, useful for isolating rows between tests that share a fake pool. */
export function randomUserId(): string {
  return `user-${randomUUID()}`;
}

// ─── HTTP auth helper ──────────────────────────────────────────────────────────

/**
 * Registers and logs in a throwaway user against the real /api/auth routes,
 * returning the `Set-Cookie` value so callers can authenticate subsequent
 * requests to the agent-auth endpoints (which sit behind `requireAuth`).
 */
export async function registerAndLoginAgentUser(
  app: Application,
  email: string = `agent-${randomUUID()}@example.com`,
  password = 'AgentAuthTest123!',
): Promise<string> {
  await request(app).post('/api/auth/register').send({ email, password });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  return cookies?.[0] ?? '';
}
