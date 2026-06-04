// @vitest-environment node
/**
 * Supertest integration tests for the per-user platform-config API.
 *
 *   GET    /api/platform-config            → requires auth, returns this user's IDs
 *   PUT    /api/platform-config/:platform  → requires auth, sets this user's client ID
 *   DELETE /api/platform-config/:platform  → requires auth, clears this user's client ID
 *
 * Every endpoint is scoped to the calling user — there is no public, global,
 * or admin variant. Runs in Node environment (not jsdom) because it imports
 * real server modules. bcrypt hashing is used for auth setup, so the test
 * timeout is extended.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { platformConfigStore } from '../../server/models/platformConfigStore';
import { userStore } from '../../server/models/userStore';

const app = createApp();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Register + login a user and return the Set-Cookie header so subsequent
 * requests can present the auth_token. Each call uses a unique email so
 * tests can spin up multiple distinct users in parallel.
 */
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
  platformConfigStore._clear();
});

afterEach(() => {
  userStore._clear();
  platformConfigStore._clear();
});

// ── GET /api/platform-config ──────────────────────────────────────────────────

describe('GET /api/platform-config', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/platform-config');
    expect(res.status).toBe(401);
  });

  it('returns 200 with every supported platform key when authenticated', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);

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
    const res = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('returns empty strings for every platform by default (no env-var fallback)', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);
    const body = res.body as Record<string, string>;
    expect(body.linkedin).toBe('');
    expect(body.twitter).toBe('');
    expect(body.reddit).toBe('');
    expect(body.facebook).toBe('');
    expect(body.instagram).toBe('');
  });

  it('ignores LINKEDIN_CLIENT_ID even when the env var is set', async () => {
    const previous = process.env.LINKEDIN_CLIENT_ID;
    process.env.LINKEDIN_CLIENT_ID = 'env-injected-value';
    try {
      const cookie = await registerAndLogin();
      const res = await request(app)
        .get('/api/platform-config')
        .set('Cookie', cookie);
      expect((res.body as Record<string, string>).linkedin).toBe('');
    } finally {
      if (previous === undefined) delete process.env.LINKEDIN_CLIENT_ID;
      else process.env.LINKEDIN_CLIENT_ID = previous;
    }
  });
}, { timeout: 30_000 });

// ── PUT /api/platform-config/:platform ────────────────────────────────────────

describe('PUT /api/platform-config/:platform', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .put('/api/platform-config/linkedin')
      .send({ clientId: 'li-abc' });
    expect(res.status).toBe(401);
  });

  it('sets the client ID for the calling user and returns the new value', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/platform-config/linkedin')
      .set('Cookie', cookie)
      .send({ clientId: 'li-new-id' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'linkedin', clientId: 'li-new-id' });

    // Visible to the same user on the next GET.
    const after = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);
    expect((after.body as Record<string, string>).linkedin).toBe('li-new-id');
  });

  it('trims whitespace from the clientId', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/platform-config/twitter')
      .set('Cookie', cookie)
      .send({ clientId: '  tw-trimmed  ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'twitter', clientId: 'tw-trimmed' });
  });

  it('mirrors the client ID between facebook and instagram for the same user', async () => {
    const cookie = await registerAndLogin();
    await request(app)
      .put('/api/platform-config/facebook')
      .set('Cookie', cookie)
      .send({ clientId: 'meta-app-id' });

    const after = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);
    const body = after.body as Record<string, string>;
    expect(body.facebook).toBe('meta-app-id');
    expect(body.instagram).toBe('meta-app-id');
  });

  it('mirrors when updating instagram directly', async () => {
    const cookie = await registerAndLogin();
    await request(app)
      .put('/api/platform-config/instagram')
      .set('Cookie', cookie)
      .send({ clientId: 'meta-app-id-2' });

    const after = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);
    const body = after.body as Record<string, string>;
    expect(body.instagram).toBe('meta-app-id-2');
    expect(body.facebook).toBe('meta-app-id-2');
  });

  it('does not leak one user\'s client ID to another user', async () => {
    const aliceCookie = await registerAndLogin('alice@example.com', 'password123');
    const bobCookie = await registerAndLogin('bob@example.com', 'password123');

    await request(app)
      .put('/api/platform-config/linkedin')
      .set('Cookie', aliceCookie)
      .send({ clientId: 'alice-linkedin-id' });

    const bobView = await request(app)
      .get('/api/platform-config')
      .set('Cookie', bobCookie);
    expect((bobView.body as Record<string, string>).linkedin).toBe('');

    const aliceView = await request(app)
      .get('/api/platform-config')
      .set('Cookie', aliceCookie);
    expect((aliceView.body as Record<string, string>).linkedin).toBe('alice-linkedin-id');
  });

  it('returns 400 for an unknown platform', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/platform-config/tiktok')
      .set('Cookie', cookie)
      .send({ clientId: 'some-id' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('returns 400 when clientId is not a string', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/platform-config/reddit')
      .set('Cookie', cookie)
      .send({ clientId: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('returns 400 when body is missing clientId entirely', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/platform-config/reddit')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('returns 400 when clientId contains control characters', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/platform-config/reddit')
      .set('Cookie', cookie)
      .send({ clientId: 'good-id\nmalicious' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });
}, { timeout: 30_000 });

// ── DELETE /api/platform-config/:platform ─────────────────────────────────────

describe('DELETE /api/platform-config/:platform', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).delete('/api/platform-config/linkedin');
    expect(res.status).toBe(401);
  });

  it('clears the calling user\'s client ID and returns empty string', async () => {
    const cookie = await registerAndLogin();
    await request(app)
      .put('/api/platform-config/linkedin')
      .set('Cookie', cookie)
      .send({ clientId: 'li-existing' });

    const res = await request(app)
      .delete('/api/platform-config/linkedin')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'linkedin', clientId: '' });

    const after = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);
    expect((after.body as Record<string, string>).linkedin).toBe('');
  });

  it('mirrors clearing between facebook and instagram', async () => {
    const cookie = await registerAndLogin();
    await request(app)
      .put('/api/platform-config/facebook')
      .set('Cookie', cookie)
      .send({ clientId: 'meta-id' });

    await request(app)
      .delete('/api/platform-config/facebook')
      .set('Cookie', cookie);

    const after = await request(app)
      .get('/api/platform-config')
      .set('Cookie', cookie);
    const body = after.body as Record<string, string>;
    expect(body.facebook).toBe('');
    expect(body.instagram).toBe('');
  });

  it('does not affect another user\'s client ID', async () => {
    const aliceCookie = await registerAndLogin('alice@example.com', 'password123');
    const bobCookie = await registerAndLogin('bob@example.com', 'password123');
    await request(app)
      .put('/api/platform-config/linkedin')
      .set('Cookie', aliceCookie)
      .send({ clientId: 'alice-linkedin-id' });
    await request(app)
      .put('/api/platform-config/linkedin')
      .set('Cookie', bobCookie)
      .send({ clientId: 'bob-linkedin-id' });

    await request(app)
      .delete('/api/platform-config/linkedin')
      .set('Cookie', aliceCookie);

    const aliceView = await request(app)
      .get('/api/platform-config')
      .set('Cookie', aliceCookie);
    const bobView = await request(app)
      .get('/api/platform-config')
      .set('Cookie', bobCookie);
    expect((aliceView.body as Record<string, string>).linkedin).toBe('');
    expect((bobView.body as Record<string, string>).linkedin).toBe('bob-linkedin-id');
  });

  it('returns 400 for an unknown platform', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .delete('/api/platform-config/snapchat')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });
}, { timeout: 30_000 });
