// @vitest-environment node
/**
 * Supertest integration tests for the OAuth connection-status endpoints:
 *   GET    /api/oauth/connections          → which platforms are connected
 *   DELETE /api/oauth/connections/:platform → disconnect (delete the token)
 *
 * These back the Settings UI so connection state survives reloads instead of
 * resetting to "disconnected". With DATABASE_URL unset the token store uses its
 * in-memory fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { userStore } from '../../server/models/userStore';
import { accessTokenStore } from '../../server/models/accessTokenStore';

const app = createApp();

async function registerAndLogin(
  email = 'user@example.com',
  password = 'password123',
): Promise<{ cookie: string; userId: string }> {
  const reg = await request(app).post('/api/auth/register').send({ email, password });
  const userId = reg.body.user.id as string;
  const login = await request(app).post('/api/auth/login').send({ email, password });
  const cookies = login.headers['set-cookie'] as unknown as string[] | undefined;
  return { cookie: cookies?.[0] ?? '', userId };
}

beforeEach(() => {
  userStore._clear();
  accessTokenStore._clear();
});

afterEach(() => {
  userStore._clear();
  accessTokenStore._clear();
});

describe('GET /api/oauth/connections', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/oauth/connections')).status).toBe(401);
  });

  it('reports all platforms disconnected when no tokens are stored', async () => {
    const { cookie } = await registerAndLogin();
    const res = await request(app).get('/api/oauth/connections').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      linkedin: false,
      twitter: false,
      reddit: false,
      facebook: false,
      instagram: false,
    });
  });

  it('reports a platform connected once a token is stored', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'twitter', 'tok');

    const res = await request(app).get('/api/oauth/connections').set('Cookie', cookie);
    expect(res.body.twitter).toBe(true);
    expect(res.body.linkedin).toBe(false);
  });

  it('does NOT report an expired token as connected', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'linkedin', 'tok', {
      expiresAt: '2000-01-01T00:00:00.000Z', // long past
    });

    const res = await request(app).get('/api/oauth/connections').set('Cookie', cookie);
    expect(res.body.linkedin).toBe(false);
  });
}, { timeout: 30_000 });

describe('DELETE /api/oauth/connections/:platform', () => {
  it('disconnects a platform so it is no longer reported connected', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'reddit', 'tok');

    expect((await request(app).get('/api/oauth/connections').set('Cookie', cookie)).body.reddit).toBe(true);

    const del = await request(app).delete('/api/oauth/connections/reddit').set('Cookie', cookie);
    expect(del.status).toBe(200);

    expect((await request(app).get('/api/oauth/connections').set('Cookie', cookie)).body.reddit).toBe(false);
  });

  it('requires authentication', async () => {
    expect((await request(app).delete('/api/oauth/connections/reddit')).status).toBe(401);
  });
}, { timeout: 30_000 });
