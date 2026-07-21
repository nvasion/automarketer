// @vitest-environment node
/**
 * Unit tests for the agent_credentials database access layer.
 *
 * These exercise the SQL-adjacent logic (parameter binding, row mapping,
 * invalid-data guarding) against a mocked `pg` Pool — no real database is
 * required, mirroring how the rest of this project keeps db/*Table.ts
 * modules exercised indirectly through their model layer, except here we
 * assert directly on the query calls since agentCredentialsTable has no
 * higher-level model wrapping insert/update/delete (only accessTokenStore's
 * agentCredentialStore wraps read/write for the *decrypted* credential flow).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import {
  ensureTable,
  insertCredentials,
  updateCredentials,
  upsertCredentials,
  findByUserAndPlatform,
  findByUser,
  deleteByUserAndPlatform,
} from '../../server/db/agentCredentialsTable';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createMockPool(queryResult: { rows: unknown[] } = { rows: [] }) {
  const query = vi.fn().mockResolvedValue(queryResult);
  return { query } as unknown as Pool;
}

const USER_ID = 'user-1';
const PLATFORM = 'reddit' as const;
const ENCRYPTED = 'v1:aabb:ccdd:eeff';

const DB_ROW = {
  id: 'cred-1',
  user_id: USER_ID,
  platform: PLATFORM,
  encrypted_credentials: ENCRYPTED,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
};

describe('ensureTable', () => {
  it('issues a CREATE TABLE IF NOT EXISTS against agent_credentials', async () => {
    const pool = createMockPool();
    await ensureTable(pool);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_credentials');
    expect(sql).toContain('UNIQUE (user_id, platform)');
  });
});

describe('insertCredentials', () => {
  it('inserts with a generated UUID id and the given fields', async () => {
    const pool = createMockPool();
    await insertCredentials(pool, USER_ID, PLATFORM, ENCRYPTED);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO agent_credentials');
    expect(params[0]).toMatch(UUID_RE);
    expect(params).toEqual([expect.stringMatching(UUID_RE), USER_ID, PLATFORM, ENCRYPTED]);
  });
});

describe('updateCredentials', () => {
  it('updates encrypted_credentials for the given user/platform', async () => {
    const pool = createMockPool();
    await updateCredentials(pool, USER_ID, PLATFORM, ENCRYPTED);

    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE agent_credentials');
    expect(params).toEqual([ENCRYPTED, USER_ID, PLATFORM]);
  });
});

describe('upsertCredentials', () => {
  it('issues a single atomic INSERT ... ON CONFLICT statement', async () => {
    const pool = createMockPool();
    await upsertCredentials(pool, USER_ID, PLATFORM, ENCRYPTED);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO agent_credentials');
    expect(sql).toContain('ON CONFLICT (user_id, platform) DO UPDATE');
    expect(params[0]).toMatch(UUID_RE);
    expect(params).toEqual([expect.stringMatching(UUID_RE), USER_ID, PLATFORM, ENCRYPTED]);
  });
});

describe('findByUserAndPlatform', () => {
  it('returns undefined when no row matches', async () => {
    const pool = createMockPool({ rows: [] });
    const result = await findByUserAndPlatform(pool, USER_ID, PLATFORM);
    expect(result).toBeUndefined();
  });

  it('maps a found row to an AgentCredentialsRecord', async () => {
    const pool = createMockPool({ rows: [DB_ROW] });
    const result = await findByUserAndPlatform(pool, USER_ID, PLATFORM);

    expect(result).toEqual({
      id: DB_ROW.id,
      userId: DB_ROW.user_id,
      platform: DB_ROW.platform,
      encryptedCredentials: DB_ROW.encrypted_credentials,
      createdAt: DB_ROW.created_at,
      updatedAt: DB_ROW.updated_at,
    });
  });

  it('throws if the stored platform value is not a recognised PlatformType', async () => {
    const pool = createMockPool({ rows: [{ ...DB_ROW, platform: 'not-a-real-platform' }] });
    await expect(findByUserAndPlatform(pool, USER_ID, PLATFORM)).rejects.toThrow(
      'Invalid platform value in database',
    );
  });
});

describe('findByUser', () => {
  it('returns an empty array when the user has no stored credentials', async () => {
    const pool = createMockPool({ rows: [] });
    const result = await findByUser(pool, USER_ID);
    expect(result).toEqual([]);
  });

  it('maps multiple rows to records', async () => {
    const secondRow = { ...DB_ROW, id: 'cred-2', platform: 'x' };
    const pool = createMockPool({ rows: [DB_ROW, secondRow] });
    const result = await findByUser(pool, USER_ID);

    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('reddit');
    expect(result[1].platform).toBe('x');
  });

  it('throws if any row has an invalid platform value', async () => {
    const pool = createMockPool({ rows: [{ ...DB_ROW, platform: 'bogus' }] });
    await expect(findByUser(pool, USER_ID)).rejects.toThrow('Invalid platform value in database');
  });
});

describe('deleteByUserAndPlatform', () => {
  it('issues a DELETE scoped to user_id and platform', async () => {
    const pool = createMockPool();
    await deleteByUserAndPlatform(pool, USER_ID, PLATFORM);

    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM agent_credentials');
    expect(params).toEqual([USER_ID, PLATFORM]);
  });
});

describe('generated ids', () => {
  it('insertCredentials and upsertCredentials generate distinct ids per call', async () => {
    const pool = createMockPool();
    await insertCredentials(pool, USER_ID, PLATFORM, ENCRYPTED);
    await insertCredentials(pool, USER_ID, 'x', ENCRYPTED);

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    const id1 = (calls[0][1] as unknown[])[0];
    const id2 = (calls[1][1] as unknown[])[0];
    expect(id1).not.toBe(id2);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
