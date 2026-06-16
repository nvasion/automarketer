// @vitest-environment node
/**
 * Supertest integration tests for the per-user AI generation preferences API.
 *
 * Only non-sensitive generation defaults are stored — never API keys. With
 * DATABASE_URL unset these tests exercise the store's in-memory fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { userStore } from '../../server/models/userStore';
import { aiPrefsStore } from '../../server/db/aiPrefsTable';

const app = createApp();

const VALID_PREFS = {
  tone: 'casual',
  emojiUsage: 'minimal',
  autoHashtags: false,
  maxTokens: 2048,
  temperature: 0.9,
};

async function registerAndLogin(
  email = 'user@example.com',
  password = 'password123',
): Promise<string> {
  await request(app).post('/api/auth/register').send({ email, password });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  return cookies?.[0] ?? '';
}

beforeEach(() => {
  userStore._clear();
  aiPrefsStore._clear();
});

afterEach(() => {
  userStore._clear();
  aiPrefsStore._clear();
});

describe('AI prefs API', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/ai-prefs')).status).toBe(401);
    expect((await request(app).put('/api/ai-prefs').send(VALID_PREFS)).status).toBe(401);
  });

  it('returns null before anything is saved', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app).get('/api/ai-prefs').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('saves and reads back preferences', async () => {
    const cookie = await registerAndLogin();

    const put = await request(app).put('/api/ai-prefs').set('Cookie', cookie).send(VALID_PREFS);
    expect(put.status).toBe(200);
    expect(put.body).toEqual(VALID_PREFS);

    const get = await request(app).get('/api/ai-prefs').set('Cookie', cookie);
    expect(get.body).toEqual(VALID_PREFS);
  });

  it('rejects invalid payloads with 400', async () => {
    const cookie = await registerAndLogin();
    const cases = [
      { ...VALID_PREFS, tone: 'angry' },
      { ...VALID_PREFS, emojiUsage: 'tons' },
      { ...VALID_PREFS, autoHashtags: 'yes' },
      { ...VALID_PREFS, maxTokens: 0 },
      { ...VALID_PREFS, maxTokens: 999_999 },
      { ...VALID_PREFS, temperature: 3 },
    ];
    for (const body of cases) {
      const res = await request(app).put('/api/ai-prefs').set('Cookie', cookie).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('scopes preferences per user', async () => {
    const alice = await registerAndLogin('alice@example.com', 'password123');
    const bob = await registerAndLogin('bob@example.com', 'password123');

    await request(app).put('/api/ai-prefs').set('Cookie', alice).send(VALID_PREFS);

    const bobView = await request(app).get('/api/ai-prefs').set('Cookie', bob);
    expect(bobView.body).toBeNull();
  });
}, { timeout: 30_000 });
