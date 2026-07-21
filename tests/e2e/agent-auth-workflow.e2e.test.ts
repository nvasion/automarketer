// @vitest-environment node
/**
 * End-to-end tests for the agent-based authentication workflow (Reddit/X
 * username+password "agent" login — as opposed to OAuth).
 *
 * Covers:
 *   1. Agent login endpoint    — POST /api/agent/connect, POST /api/agent/validate
 *   2. Credential storage      — server/db/agentCredentialsTable.ts + encryption
 *   3. Token retrieval         — findByUserAndPlatform / findByUser + decryption
 *   4. Error cases             — auth gating, input validation, missing DB,
 *                                tampered/undecryptable ciphertext
 *
 * server/routes/agentAuth.ts is not yet wired into the shared server/app.ts
 * (that remains a separate task), so a small local Express harness mounts it
 * the same way the JSDoc on each handler documents ("POST /api/agent/connect",
 * etc.) alongside the real /api/auth router. This exercises the actual route
 * module end-to-end over HTTP without depending on — or editing — app.ts.
 *
 * No test database is available in this environment (DATABASE_URL is unset),
 * so `getPool()` returns null and every DB-backed HTTP route legitimately
 * short-circuits to 503 DB_UNAVAILABLE — the same behaviour documented in
 * tests/server/accessTokenStore.test.ts for the equivalent OAuth token store.
 * The credential-storage and token-retrieval layers are instead exercised
 * directly against agentCredentialsTable.ts using a fake in-memory Pool
 * (dependency-injected exactly like the real route handlers do), which is
 * enough to prove the storage/encryption round trip works correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

import authRouter from '../../server/routes/auth';
import agentAuthRouter from '../../server/routes/agentAuth';
import { userStore } from '../../server/models/userStore';
import {
  ensureTable,
  insertCredentials,
  updateCredentials,
  findByUserAndPlatform,
  findByUser,
  deleteByUserAndPlatform,
} from '../../server/db/agentCredentialsTable';
import {
  encryptAgentCredentials,
  decryptAgentCredentials,
  setEncryptionKey,
  clearEncryptionKey,
} from '../../server/utils/agentCredentialEncryption';
import {
  createFakeAgentPool,
  buildAgentCredentials,
  randomUserId,
  registerAndLoginAgentUser,
} from '../helpers/agentFixtures';

// ─── Test harness app ──────────────────────────────────────────────────────────
// Mirrors the relevant slice of server/app.ts: cookie parsing, JSON body
// parsing, the real auth router (to obtain a session cookie), and the real
// agent-auth router mounted at the path its own JSDoc documents.

function buildTestApp(): express.Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/agent', agentAuthRouter);
  return app;
}

const app = buildTestApp();

beforeEach(() => {
  userStore._clear();
});

afterEach(() => {
  userStore._clear();
});

// ─── Workflow 1: Agent login endpoint (POST /api/agent/connect) ───────────────

describe('POST /api/agent/connect — agent login endpoint', () => {
  it('rejects requests with no auth cookie (401 MISSING_TOKEN)', async () => {
    const res = await request(app)
      .post('/api/agent/connect')
      .send({ platform: 'reddit', credentials: buildAgentCredentials() });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('rejects an unsupported platform with 400 INVALID_PLATFORM', async () => {
    const cookie = await registerAndLoginAgentUser(app);
    const res = await request(app)
      .post('/api/agent/connect')
      .set('Cookie', cookie)
      .send({ platform: 'facebook', credentials: buildAgentCredentials() });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it.each([
    ['username', 'MISSING_USERNAME'],
    ['password', 'MISSING_PASSWORD'],
    ['clientId', 'MISSING_CLIENT_ID'],
    ['clientSecret', 'MISSING_CLIENT_SECRET'],
  ] as const)('rejects credentials missing %s with 400 %s', async (field, code) => {
    const cookie = await registerAndLoginAgentUser(app);
    const credentials = buildAgentCredentials({ [field]: '' });
    const res = await request(app)
      .post('/api/agent/connect')
      .set('Cookie', cookie)
      .send({ platform: 'reddit', credentials });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
  });

  it('rejects a non-object credentials payload with 400 INVALID_CREDENTIALS', async () => {
    const cookie = await registerAndLoginAgentUser(app);
    const res = await request(app)
      .post('/api/agent/connect')
      .set('Cookie', cookie)
      .send({ platform: 'reddit', credentials: 'not-an-object' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 503 DB_UNAVAILABLE once past validation when no database is configured', async () => {
    const cookie = await registerAndLoginAgentUser(app);
    const res = await request(app)
      .post('/api/agent/connect')
      .set('Cookie', cookie)
      .send({ platform: 'reddit', credentials: buildAgentCredentials() });

    // DATABASE_URL is unset in this test environment, exactly like
    // tests/server/accessTokenStore.test.ts documents for the OAuth store.
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DB_UNAVAILABLE');
  });
});

// ─── Workflow 1b: Credential validation endpoint (POST /api/agent/validate) ───

describe('POST /api/agent/validate', () => {
  it('rejects an unsupported platform with 400 INVALID_PLATFORM', async () => {
    const cookie = await registerAndLoginAgentUser(app);
    const res = await request(app)
      .post('/api/agent/validate')
      .set('Cookie', cookie)
      .send({ platform: 'linkedin', credentials: buildAgentCredentials() });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('rejects requests with no auth cookie (401)', async () => {
    const res = await request(app)
      .post('/api/agent/validate')
      .send({ platform: 'reddit', credentials: buildAgentCredentials() });

    expect(res.status).toBe(401);
  });

  // Only 'x' is exercised here: server/services/social/redditAgentService.ts
  // now exists (implemented by a separate in-flight task), so POST
  // /api/agent/validate for 'reddit' performs a real live validation call
  // against Reddit's OAuth endpoint instead of hitting this "module not
  // found" fallback — not something this network-free e2e suite should
  // depend on. That mocked/live-validation behavior is covered instead by
  // tests/server/agentAuth.test.ts, which stubs the platform service module.
  it.each(['x'] as const)(
    'returns 503 SERVICE_UNAVAILABLE for %s while its agent service module does not yet exist',
    async (platform) => {
      const cookie = await registerAndLoginAgentUser(app);
      const res = await request(app)
        .post('/api/agent/validate')
        .set('Cookie', cookie)
        .send({ platform, credentials: buildAgentCredentials() });

      expect(res.status).toBe(503);
      expect(res.body.valid).toBe(false);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    },
  );
});

// ─── Workflow 2 & 3: Credential storage + token retrieval (DB layer) ──────────
//
// Exercised directly against agentCredentialsTable.ts with a fake in-memory
// Pool via dependency injection — the same call shape the HTTP route handlers
// use — so the storage/encryption round trip is proven even without a real
// database connection available in this environment.

describe('Credential storage and token retrieval (DB layer)', () => {
  let key: Buffer;

  beforeEach(() => {
    key = randomBytes(32);
    setEncryptionKey(key);
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  it('stores encrypted credentials and retrieves the original plaintext back out', async () => {
    const pool = createFakeAgentPool();
    const userId = randomUserId();
    const credentials = buildAgentCredentials({ username: 'reddit-bot' });

    await ensureTable(pool);
    const encrypted = encryptAgentCredentials(credentials);
    await insertCredentials(pool, userId, 'reddit', encrypted);

    const record = await findByUserAndPlatform(pool, userId, 'reddit');
    expect(record).toBeDefined();
    expect(record!.platform).toBe('reddit');
    expect(record!.userId).toBe(userId);

    const decrypted = decryptAgentCredentials(record!.encryptedCredentials);
    expect(decrypted).toEqual(credentials);
  });

  it('never stores credentials as recoverable plaintext in the ciphertext string', async () => {
    const pool = createFakeAgentPool();
    const userId = randomUserId();
    const credentials = buildAgentCredentials({ password: 'super-secret-password' });

    await ensureTable(pool);
    await insertCredentials(pool, userId, 'x', encryptAgentCredentials(credentials));

    const record = await findByUserAndPlatform(pool, userId, 'x');
    expect(record!.encryptedCredentials).not.toContain('super-secret-password');
    expect(record!.encryptedCredentials.startsWith('v1:')).toBe(true);
  });

  it('updateCredentials overwrites the stored ciphertext for the same user/platform', async () => {
    const pool = createFakeAgentPool();
    const userId = randomUserId();

    await ensureTable(pool);
    await insertCredentials(pool, userId, 'reddit', encryptAgentCredentials(buildAgentCredentials()));

    const updatedCreds = buildAgentCredentials({ username: 'updated-user' });
    await updateCredentials(pool, userId, 'reddit', encryptAgentCredentials(updatedCreds));

    const record = await findByUserAndPlatform(pool, userId, 'reddit');
    expect(decryptAgentCredentials(record!.encryptedCredentials)).toEqual(updatedCreds);
  });

  it('deleteByUserAndPlatform removes the record so retrieval returns undefined', async () => {
    const pool = createFakeAgentPool();
    const userId = randomUserId();

    await ensureTable(pool);
    await insertCredentials(pool, userId, 'x', encryptAgentCredentials(buildAgentCredentials()));
    expect(await findByUserAndPlatform(pool, userId, 'x')).toBeDefined();

    await deleteByUserAndPlatform(pool, userId, 'x');
    expect(await findByUserAndPlatform(pool, userId, 'x')).toBeUndefined();
  });

  it('findByUser only returns records scoped to that user (no cross-user leakage)', async () => {
    const pool = createFakeAgentPool();
    const userA = randomUserId();
    const userB = randomUserId();

    await ensureTable(pool);
    await insertCredentials(pool, userA, 'reddit', encryptAgentCredentials(buildAgentCredentials()));
    await insertCredentials(pool, userB, 'x', encryptAgentCredentials(buildAgentCredentials()));

    const aRecords = await findByUser(pool, userA);
    expect(aRecords).toHaveLength(1);
    expect(aRecords[0].platform).toBe('reddit');

    const bRecords = await findByUser(pool, userB);
    expect(bRecords).toHaveLength(1);
    expect(bRecords[0].platform).toBe('x');
  });

  it('a user can independently store credentials for both reddit and x', async () => {
    const pool = createFakeAgentPool();
    const userId = randomUserId();

    await ensureTable(pool);
    await insertCredentials(pool, userId, 'reddit', encryptAgentCredentials(buildAgentCredentials({ username: 'reddit-agent' })));
    await insertCredentials(pool, userId, 'x', encryptAgentCredentials(buildAgentCredentials({ username: 'x-agent' })));

    const records = await findByUser(pool, userId);
    expect(records).toHaveLength(2);
    const platforms = records.map((r) => r.platform).sort();
    expect(platforms).toEqual(['reddit', 'x']);
  });
});

// ─── Workflow 4: Error cases ────────────────────────────────────────────────────

describe('Error cases', () => {
  it('DELETE /api/agent/:platform requires authentication (401)', async () => {
    const res = await request(app).delete('/api/agent/reddit');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/agent/:platform rejects an invalid platform with 400', async () => {
    const cookie = await registerAndLoginAgentUser(app);
    const res = await request(app).delete('/api/agent/myspace').set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('GET /api/agent/status/:platform requires authentication (401)', async () => {
    const res = await request(app).get('/api/agent/status/reddit');
    expect(res.status).toBe(401);
  });

  it('GET /api/agent/status/:platform rejects an invalid platform with 400', async () => {
    const cookie = await registerAndLoginAgentUser(app);
    const res = await request(app).get('/api/agent/status/myspace').set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('rejects a forged JWT signed with the wrong secret (401 INVALID_TOKEN)', async () => {
    const forged = jwt.sign({ sub: 'attacker', email: 'attacker@example.com' }, 'wrong-secret', {
      algorithm: 'HS256',
    });
    const res = await request(app)
      .post('/api/agent/connect')
      .set('Cookie', `auth_token=${forged}`)
      .send({ platform: 'reddit', credentials: buildAgentCredentials() });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects an oversized user id embedded in an otherwise validly-signed token (401 INVALID_USER)', async () => {
    // Signed with the same dev-fallback secret the server falls back to when
    // JWT_SECRET is unset (see server/utils/config.ts), so requireAuth's
    // signature check passes — this exercises the route's own defense-in-depth
    // userId length check (isValidUserId), not the JWT layer.
    const oversizedSub = 'x'.repeat(257);
    const token = jwt.sign({ sub: oversizedSub, email: 'attacker@example.com' }, 'dev-secret-change-in-production', {
      algorithm: 'HS256',
    });
    const res = await request(app)
      .delete('/api/agent/reddit')
      .set('Cookie', `auth_token=${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_USER');
  });

  it('decryptAgentCredentials throws when the ciphertext has been tampered with', () => {
    setEncryptionKey(randomBytes(32));
    try {
      const stored = encryptAgentCredentials(buildAgentCredentials());
      const [version, iv, authTag, ciphertext] = stored.split(':');
      // Flip a hex character in the ciphertext body to simulate corruption/tampering.
      const tamperedChar = ciphertext[0] === 'a' ? 'b' : 'a';
      const tampered = [version, iv, authTag, tamperedChar + ciphertext.slice(1)].join(':');

      expect(() => decryptAgentCredentials(tampered)).toThrow();
    } finally {
      clearEncryptionKey();
    }
  });

  it('decryptAgentCredentials throws when decrypted with the wrong key', () => {
    setEncryptionKey(randomBytes(32));
    const stored = encryptAgentCredentials(buildAgentCredentials());
    clearEncryptionKey();

    setEncryptionKey(randomBytes(32)); // a different key than the one used to encrypt
    try {
      expect(() => decryptAgentCredentials(stored)).toThrow();
    } finally {
      clearEncryptionKey();
    }
  });

  it('decryptAgentCredentials rejects an unrecognised ciphertext format', () => {
    setEncryptionKey(randomBytes(32));
    try {
      expect(() => decryptAgentCredentials('v2:deadbeef:cafebabe:1234')).toThrow(
        /Unrecognised credentials ciphertext format/,
      );
    } finally {
      clearEncryptionKey();
    }
  });
});
