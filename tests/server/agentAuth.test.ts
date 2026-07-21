// @vitest-environment node
/**
 * Supertest integration tests for the /api/agent/* Express routes, with a
 * focus on POST /api/agent/login (credential validation, encrypted storage,
 * and the agent session cookie it issues).
 *
 * These mock the persistence layer (server/db/agentCredentialsTable,
 * server/utils/agentCredentialEncryption, server/db/connection) so the tests
 * exercise the route's request handling, validation, and error-handling
 * logic without requiring a live PostgreSQL database. The router is mounted
 * on a minimal standalone Express app (rather than the full app from
 * server/app.ts) so this suite stays self-contained and does not depend on
 * other in-flight routes.
 *
 * Runs in the Node environment (not jsdom) because it uses Supertest over
 * Node's http module and imports real server modules.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../server/db/connection', () => ({
  getPool: vi.fn(),
}));

vi.mock('../../server/db/agentCredentialsTable', () => ({
  ensureTable: vi.fn(),
  insertCredentials: vi.fn(),
  updateCredentials: vi.fn(),
  findByUserAndPlatform: vi.fn(),
  deleteByUserAndPlatform: vi.fn(),
}));

vi.mock('../../server/utils/agentCredentialEncryption', () => ({
  encryptAgentCredentials: vi.fn((creds: unknown) => `encrypted:${JSON.stringify(creds)}`),
  decryptAgentCredentials: vi.fn((stored: string) => JSON.parse(stored.replace(/^encrypted:/, ''))),
}));

// The route's PlatformValidatorRegistry dynamically `import()`s this module
// to live-validate credentials against Reddit. Mocked so these tests exercise
// the route's request handling/persistence logic without making real network
// calls to Reddit's OAuth endpoint (which would be slow, flaky, and require
// network access the test environment doesn't have).
vi.mock('../../server/services/social/redditAgentService', () => ({
  validateCredentials: vi.fn(),
}));

import { getPool } from '../../server/db/connection';
import {
  ensureTable,
  insertCredentials,
  updateCredentials,
  findByUserAndPlatform,
  deleteByUserAndPlatform,
} from '../../server/db/agentCredentialsTable';
import { encryptAgentCredentials } from '../../server/utils/agentCredentialEncryption';
import { validateCredentials as validateRedditCredentials } from '../../server/services/social/redditAgentService';
import agentAuthRouter from '../../server/routes/agentAuth';
import { jwtSecret } from '../../server/utils/config';

const mockGetPool = vi.mocked(getPool);
const mockEnsureTable = vi.mocked(ensureTable);
const mockInsertCredentials = vi.mocked(insertCredentials);
const mockUpdateCredentials = vi.mocked(updateCredentials);
const mockFindByUserAndPlatform = vi.mocked(findByUserAndPlatform);
const mockDeleteByUserAndPlatform = vi.mocked(deleteByUserAndPlatform);
const mockEncryptAgentCredentials = vi.mocked(encryptAgentCredentials);
const mockValidateRedditCredentials = vi.mocked(validateRedditCredentials);

// A stand-in for the pg Pool — none of the mocked persistence functions
// actually touch it, so an empty object satisfies the "pool is available"
// branch of every handler.
const FAKE_POOL = {} as ReturnType<typeof getPool>;

const USER_ID = 'user-123';

const VALID_CREDENTIALS = {
  username: 'redditor',
  password: 'hunter2',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/agent', agentAuthRouter);
  return app;
}

const app = buildApp();

function authCookieFor(userId: string): string {
  const token = jwt.sign({ sub: userId, email: 'agent-user@example.com' }, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `auth_token=${token}`;
}

const AUTH_COOKIE = authCookieFor(USER_ID);

function setCookiesOf(res: request.Response): string[] {
  return (res.headers['set-cookie'] as string[] | undefined) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPool.mockReturnValue(FAKE_POOL);
  mockFindByUserAndPlatform.mockResolvedValue(undefined);
  mockEnsureTable.mockResolvedValue(undefined);
  mockInsertCredentials.mockResolvedValue(undefined);
  mockUpdateCredentials.mockResolvedValue(undefined);
  mockDeleteByUserAndPlatform.mockResolvedValue(undefined);
  // Reddit's agent service module is real (server/services/social/redditAgentService.ts)
  // and is dynamically imported by the route, so it must be mocked to avoid
  // live network calls to Reddit. Default to "valid" so tests that aren't
  // specifically about live-validation failure exercise the happy path.
  mockValidateRedditCredentials.mockResolvedValue(true);
});

// ── POST /api/agent/login ─────────────────────────────────────────────────────

describe('POST /api/agent/login', () => {
  it('rejects requests without an app auth cookie', async () => {
    const res = await request(app)
      .post('/api/agent/login')
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('rejects an invalid platform', async () => {
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'facebook', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('rejects a missing platform', async () => {
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('rejects missing credentials entirely', async () => {
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it.each([
    ['username', 'MISSING_USERNAME'],
    ['password', 'MISSING_PASSWORD'],
    ['clientId', 'MISSING_CLIENT_ID'],
    ['clientSecret', 'MISSING_CLIENT_SECRET'],
  ])('rejects credentials missing %s', async (field, code) => {
    const credentials = { ...VALID_CREDENTIALS, [field]: '' };
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit', credentials });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
  });

  it('returns 401 for a malformed/invalid auth token', async () => {
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', 'auth_token=not-a-real-token')
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 when the authenticated user id is empty', async () => {
    const cookie = authCookieFor('');
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', cookie)
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_USER');
  });

  it('returns 503 when the database is unavailable', async () => {
    mockGetPool.mockReturnValue(null);

    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DB_UNAVAILABLE');
  });

  it('inserts new encrypted credentials, sets a session cookie, and returns 200', async () => {
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, platform: 'reddit' });

    // Stored via insert (no pre-existing row) — never in plaintext.
    expect(mockEnsureTable).toHaveBeenCalledWith(FAKE_POOL);
    expect(mockEncryptAgentCredentials).toHaveBeenCalledWith(VALID_CREDENTIALS);
    expect(mockInsertCredentials).toHaveBeenCalledWith(
      FAKE_POOL,
      USER_ID,
      'reddit',
      expect.stringContaining('encrypted:'),
    );
    expect(mockUpdateCredentials).not.toHaveBeenCalled();

    // The response never echoes back the raw credentials.
    expect(JSON.stringify(res.body)).not.toContain(VALID_CREDENTIALS.password);
    expect(JSON.stringify(res.body)).not.toContain(VALID_CREDENTIALS.clientSecret);

    // Sets an httpOnly, SameSite=Strict session cookie scoped to the platform.
    const cookies = setCookiesOf(res);
    const sessionCookie = cookies.find((c) => c.startsWith('agent_session_reddit='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.toLowerCase()).toContain('httponly');
    expect(sessionCookie!.toLowerCase()).toContain('samesite=strict');
  });

  it('updates existing credentials instead of inserting when a row already exists', async () => {
    mockFindByUserAndPlatform.mockResolvedValue({
      id: 'row-1',
      userId: USER_ID,
      platform: 'reddit',
      encryptedCredentials: 'encrypted:{"old":true}',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(200);
    expect(mockUpdateCredentials).toHaveBeenCalledWith(
      FAKE_POOL,
      USER_ID,
      'reddit',
      expect.stringContaining('encrypted:'),
    );
    expect(mockInsertCredentials).not.toHaveBeenCalled();
  });

  it('issues a platform-scoped cookie for x distinct from reddit', async () => {
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'x', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('x');
    const cookies = setCookiesOf(res);
    expect(cookies.some((c) => c.startsWith('agent_session_x='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('agent_session_reddit='))).toBe(false);
  });

  it('degrades gracefully and still logs in when the platform validator service is unavailable', async () => {
    // No x agent service module exists in this checkout yet (owned by a
    // separate in-flight task) — the dynamic import inside the route's
    // validator registry fails and is caught, so login proceeds on
    // structural validation alone rather than blocking on an optional
    // dependency. (Reddit's service module is real and mocked above, so it
    // no longer exercises this fallback path — hence 'x' here.)
    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'x', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects login when the live Reddit validator reports invalid credentials', async () => {
    mockValidateRedditCredentials.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(mockInsertCredentials).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking internal error details when persistence fails', async () => {
    mockEnsureTable.mockRejectedValueOnce(new Error('connection terminated unexpectedly: password=supersecret'));

    const res = await request(app)
      .post('/api/agent/login')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('LOGIN_ERROR');
    expect(res.body.error).toBe('Failed to log in');
    expect(JSON.stringify(res.body)).not.toContain('supersecret');
  });
});

// ── Other /api/agent/* routes (shared file coverage) ─────────────────────────

describe('POST /api/agent/connect', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/agent/connect')
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });
    expect(res.status).toBe(401);
  });

  it('stores credentials and returns 200 without setting a session cookie', async () => {
    const res = await request(app)
      .post('/api/agent/connect')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'reddit', credentials: VALID_CREDENTIALS });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockInsertCredentials).toHaveBeenCalled();
    expect(setCookiesOf(res)).toHaveLength(0);
  });

  it('rejects an invalid platform', async () => {
    const res = await request(app)
      .post('/api/agent/connect')
      .set('Cookie', AUTH_COOKIE)
      .send({ platform: 'bogus', credentials: VALID_CREDENTIALS });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });
});

describe('DELETE /api/agent/:platform', () => {
  it('returns 404 when no credentials exist for the platform', async () => {
    mockFindByUserAndPlatform.mockResolvedValue(undefined);
    const res = await request(app)
      .delete('/api/agent/reddit')
      .set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('deletes existing credentials and returns 200', async () => {
    mockFindByUserAndPlatform.mockResolvedValue({
      id: 'row-1',
      userId: USER_ID,
      platform: 'reddit',
      encryptedCredentials: 'encrypted:{}',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const res = await request(app)
      .delete('/api/agent/reddit')
      .set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(200);
    expect(mockDeleteByUserAndPlatform).toHaveBeenCalledWith(FAKE_POOL, USER_ID, 'reddit');
  });

  it('rejects an invalid platform', async () => {
    const res = await request(app)
      .delete('/api/agent/bogus')
      .set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });
});

describe('GET /api/agent/status/:platform', () => {
  it('reports disconnected when no credentials are stored', async () => {
    mockFindByUserAndPlatform.mockResolvedValue(undefined);
    const res = await request(app)
      .get('/api/agent/status/reddit')
      .set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: false, platform: 'reddit' });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/agent/status/reddit');
    expect(res.status).toBe(401);
  });
});
