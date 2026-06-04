// @vitest-environment node
/**
 * Supertest integration tests for the authenticated admin platform-config API.
 *
 *   GET    /api/admin/platform-config            → requires auth, returns all IDs
 *   PUT    /api/admin/platform-config/:platform  → requires auth, sets a client ID
 *   DELETE /api/admin/platform-config/:platform  → requires auth, clears a client ID
 *
 * Runs in Node environment (not jsdom) because it imports real server modules.
 * bcrypt hashing is used to set up auth state, so test timeout is extended.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { platformConfigStore } from '../../server/models/platformConfigStore';
import { userStore } from '../../server/models/userStore';

const app = createApp();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function registerAndLogin(
  email = 'admin@example.com',
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
  platformConfigStore._reset();
});

afterEach(() => {
  userStore._clear();
  platformConfigStore._reset();
});

// ── GET /api/admin/platform-config ────────────────────────────────────────────

describe('GET /api/admin/platform-config', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/platform-config');
    expect(res.status).toBe(401);
  });

  it('returns 200 with all platform keys when authenticated', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .get('/api/admin/platform-config')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const keys = Object.keys(res.body as Record<string, string>);
    expect(keys).toContain('linkedin');
    expect(keys).toContain('twitter');
    expect(keys).toContain('reddit');
    expect(keys).toContain('facebook');
    expect(keys).toContain('instagram');
  });

  it('reflects values set in the store', async () => {
    platformConfigStore.setClientId('twitter', 'tw-test-id');
    const cookie = await registerAndLogin();
    const res = await request(app)
      .get('/api/admin/platform-config')
      .set('Cookie', cookie);

    expect((res.body as Record<string, string>).twitter).toBe('tw-test-id');
  });
}, { timeout: 30_000 });

// ── PUT /api/admin/platform-config/:platform ──────────────────────────────────

describe('PUT /api/admin/platform-config/:platform', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .put('/api/admin/platform-config/linkedin')
      .send({ clientId: 'li-abc' });
    expect(res.status).toBe(401);
  });

  it('sets the client ID and returns the new value', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/admin/platform-config/linkedin')
      .set('Cookie', cookie)
      .send({ clientId: 'li-new-id' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'linkedin', clientId: 'li-new-id' });
    expect(platformConfigStore.getClientId('linkedin')).toBe('li-new-id');
  });

  it('trims whitespace from the clientId', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/admin/platform-config/twitter')
      .set('Cookie', cookie)
      .send({ clientId: '  tw-trimmed  ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'twitter', clientId: 'tw-trimmed' });
    expect(platformConfigStore.getClientId('twitter')).toBe('tw-trimmed');
  });

  it('mirrors the client ID between facebook and instagram', async () => {
    const cookie = await registerAndLogin();
    await request(app)
      .put('/api/admin/platform-config/facebook')
      .set('Cookie', cookie)
      .send({ clientId: 'meta-app-id' });

    expect(platformConfigStore.getClientId('facebook')).toBe('meta-app-id');
    expect(platformConfigStore.getClientId('instagram')).toBe('meta-app-id');
  });

  it('mirrors when updating instagram directly', async () => {
    const cookie = await registerAndLogin();
    await request(app)
      .put('/api/admin/platform-config/instagram')
      .set('Cookie', cookie)
      .send({ clientId: 'meta-app-id-2' });

    expect(platformConfigStore.getClientId('instagram')).toBe('meta-app-id-2');
    expect(platformConfigStore.getClientId('facebook')).toBe('meta-app-id-2');
  });

  it('returns 400 for an unknown platform', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/admin/platform-config/tiktok')
      .set('Cookie', cookie)
      .send({ clientId: 'some-id' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });

  it('returns 400 when clientId is not a string', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/admin/platform-config/reddit')
      .set('Cookie', cookie)
      .send({ clientId: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('returns 400 when body is missing clientId entirely', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .put('/api/admin/platform-config/reddit')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('the new value is visible via the public GET /api/platform-config', async () => {
    const cookie = await registerAndLogin();
    await request(app)
      .put('/api/admin/platform-config/reddit')
      .set('Cookie', cookie)
      .send({ clientId: 'rd-public-check' });

    const publicRes = await request(app).get('/api/platform-config');
    expect((publicRes.body as Record<string, string>).reddit).toBe('rd-public-check');
  });
}, { timeout: 30_000 });

// ── DELETE /api/admin/platform-config/:platform ───────────────────────────────

describe('DELETE /api/admin/platform-config/:platform', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).delete('/api/admin/platform-config/linkedin');
    expect(res.status).toBe(401);
  });

  it('clears the client ID and returns empty string', async () => {
    platformConfigStore.setClientId('linkedin', 'li-existing');
    const cookie = await registerAndLogin();

    const res = await request(app)
      .delete('/api/admin/platform-config/linkedin')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'linkedin', clientId: '' });
    expect(platformConfigStore.getClientId('linkedin')).toBe('');
  });

  it('mirrors clearing between facebook and instagram', async () => {
    platformConfigStore.setClientId('facebook', 'meta-id');
    platformConfigStore.setClientId('instagram', 'meta-id');
    const cookie = await registerAndLogin();

    await request(app)
      .delete('/api/admin/platform-config/facebook')
      .set('Cookie', cookie);

    expect(platformConfigStore.getClientId('facebook')).toBe('');
    expect(platformConfigStore.getClientId('instagram')).toBe('');
  });

  it('returns 400 for an unknown platform', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .delete('/api/admin/platform-config/snapchat')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PLATFORM');
  });
}, { timeout: 30_000 });
