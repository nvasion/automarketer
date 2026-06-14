// @vitest-environment node
/**
 * Supertest integration tests for the platform-config API (shared-app model).
 *
 *   GET /api/platform-config → requires auth, returns the SERVER's configured
 *   OAuth client IDs (from <PLATFORM>_CLIENT_ID env vars), one entry per
 *   supported platform. The same config is served to every user — there is no
 *   per-user storage and no PUT/DELETE.
 *
 * Runs in Node environment (not jsdom) because it imports real server modules.
 * bcrypt hashing is used for auth setup, so the test timeout is extended.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { userStore } from '../../server/models/userStore';

const app = createApp();

// Platform client-ID env vars this suite manipulates — saved and restored
// around each test so they never leak between tests or into other suites.
const CLIENT_ID_VARS = [
  'LINKEDIN_CLIENT_ID',
  'TWITTER_CLIENT_ID',
  'REDDIT_CLIENT_ID',
  'META_CLIENT_ID',
] as const;

let savedEnv: Record<string, string | undefined> = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function registerAndLogin(
  email = 'user@example.com',
  password = 'password123',
): Promise<string> {
  await request(app).post('/api/auth/register').send({ email, password });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  return cookies?.[0] ?? '';
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  userStore._clear();
  savedEnv = {};
  for (const key of CLIENT_ID_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  userStore._clear();
  for (const key of CLIENT_ID_VARS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ── GET /api/platform-config ──────────────────────────────────────────────────

describe('GET /api/platform-config', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/platform-config');
    expect(res.status).toBe(401);
  });

  it('returns 200 with every supported platform key when authenticated', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app).get('/api/platform-config').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const keys = Object.keys(res.body as Record<string, string>);
    expect(keys).toContain('linkedin');
    expect(keys).toContain('twitter');
    expect(keys).toContain('reddit');
    expect(keys).toContain('facebook');
    expect(keys).toContain('instagram');
  });

  it('returns JSON content-type', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app).get('/api/platform-config').set('Cookie', cookie);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('returns empty strings for platforms with no env client ID set', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app).get('/api/platform-config').set('Cookie', cookie);
    const body = res.body as Record<string, string>;
    expect(body.linkedin).toBe('');
    expect(body.twitter).toBe('');
    expect(body.reddit).toBe('');
    expect(body.facebook).toBe('');
    expect(body.instagram).toBe('');
  });

  it('returns the server client ID from the env var when set', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'li-env-client-id';
    const cookie = await registerAndLogin();
    const res = await request(app).get('/api/platform-config').set('Cookie', cookie);
    expect((res.body as Record<string, string>).linkedin).toBe('li-env-client-id');
  });

  it('serves Instagram the Meta client ID', async () => {
    process.env.META_CLIENT_ID = 'meta-app-id';
    const cookie = await registerAndLogin();
    const res = await request(app).get('/api/platform-config').set('Cookie', cookie);
    const body = res.body as Record<string, string>;
    expect(body.facebook).toBe('meta-app-id');
    expect(body.instagram).toBe('meta-app-id');
  });

  it('serves the same config to every user (no per-user storage)', async () => {
    process.env.TWITTER_CLIENT_ID = 'shared-tw-id';
    const aliceCookie = await registerAndLogin('alice@example.com', 'password123');
    const bobCookie = await registerAndLogin('bob@example.com', 'password123');

    const aliceView = await request(app).get('/api/platform-config').set('Cookie', aliceCookie);
    const bobView = await request(app).get('/api/platform-config').set('Cookie', bobCookie);
    expect((aliceView.body as Record<string, string>).twitter).toBe('shared-tw-id');
    expect((bobView.body as Record<string, string>).twitter).toBe('shared-tw-id');
  });
}, { timeout: 30_000 });

// ── Removed endpoints (per-user PUT/DELETE no longer exist) ────────────────────

describe('removed per-user endpoints', () => {
  it('PUT /api/platform-config/:platform is not available (404)', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/platform-config/linkedin')
      .set('Cookie', cookie)
      .send({ clientId: 'li-abc' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/platform-config/:platform is not available (404)', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .delete('/api/platform-config/linkedin')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
}, { timeout: 30_000 });
