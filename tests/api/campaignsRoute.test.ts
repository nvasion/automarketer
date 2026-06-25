// @vitest-environment node
/**
 * Supertest integration tests for the per-user campaigns API route.
 *
 * Campaigns are scoped to the authenticated user (from the JWT cookie) and
 * persisted server-side. With DATABASE_URL unset these tests exercise the
 * store's in-memory fallback, so no database is required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { userStore } from '../../server/models/userStore';
import { campaignStore } from '../../server/db/campaignsTable';

const app = createApp();

function validCampaign(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Launch',
    websiteUrl: 'https://example.com',
    description: 'A product launch',
    status: 'draft',
    tone: 'professional',
    targetAudience: 'developers',
    platforms: ['linkedin'],
    screenshots: [],
    posts: [],
    ...overrides,
  };
}

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
  campaignStore._clear();
});

afterEach(() => {
  userStore._clear();
  campaignStore._clear();
});

describe('campaigns API auth', () => {
  it('returns 401 when not authenticated', async () => {
    expect((await request(app).get('/api/campaigns')).status).toBe(401);
    expect((await request(app).post('/api/campaigns').send(validCampaign())).status).toBe(401);
  });
}, { timeout: 30_000 });

describe('campaigns CRUD', () => {
  it('creates, lists, reads, updates, and deletes a campaign', async () => {
    const cookie = await registerAndLogin();

    const created = await request(app).post('/api/campaigns').set('Cookie', cookie).send(validCampaign());
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.createdAt).toBeTruthy();
    expect(created.body.updatedAt).toBe(created.body.createdAt);
    const id = created.body.id as string;

    const list = await request(app).get('/api/campaigns').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    const one = await request(app).get(`/api/campaigns/${id}`).set('Cookie', cookie);
    expect(one.status).toBe(200);
    expect(one.body.name).toBe('Launch');

    const patched = await request(app)
      .patch(`/api/campaigns/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Renamed' });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Renamed');
    expect(patched.body.id).toBe(id);
    expect(patched.body.createdAt).toBe(created.body.createdAt); // immutable

    const del = await request(app).delete(`/api/campaigns/${id}`).set('Cookie', cookie);
    expect(del.status).toBe(204);
    expect((await request(app).get(`/api/campaigns/${id}`).set('Cookie', cookie)).status).toBe(404);
  });

  it('normalizes subreddits on create', async () => {
    const cookie = await registerAndLogin();
    const created = await request(app)
      .post('/api/campaigns')
      .set('Cookie', cookie)
      .send(validCampaign({ subreddits: 'r/Programming, webdev' }));
    expect(created.status).toBe(201);
    expect(created.body.subreddits).toEqual(['Programming', 'webdev']);
  });

  it('rejects an invalid payload with 400', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Cookie', cookie)
      .send(validCampaign({ name: '' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('rejects a non-http websiteUrl with 400', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Cookie', cookie)
      .send(validCampaign({ websiteUrl: 'javascript:alert(1)' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when updating or deleting an unknown campaign', async () => {
    const cookie = await registerAndLogin();
    expect(
      (await request(app).patch('/api/campaigns/nope').set('Cookie', cookie).send({ name: 'x' })).status,
    ).toBe(404);
    expect((await request(app).delete('/api/campaigns/nope').set('Cookie', cookie)).status).toBe(404);
  });
}, { timeout: 30_000 });

describe('campaigns isolation + migration import', () => {
  it('never returns another user\'s campaigns', async () => {
    const alice = await registerAndLogin('alice@example.com', 'password123');
    const bob = await registerAndLogin('bob@example.com', 'password123');

    await request(app).post('/api/campaigns').set('Cookie', alice).send(validCampaign({ name: 'Alice' }));

    const bobList = await request(app).get('/api/campaigns').set('Cookie', bob);
    expect(bobList.body).toHaveLength(0);
  });

  it('imports campaigns preserving id, and is idempotent on re-import', async () => {
    const cookie = await registerAndLogin();
    const rec = {
      ...validCampaign({ name: 'Imported' }),
      id: 'fixed-id-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    };

    const first = await request(app).post('/api/campaigns/import').set('Cookie', cookie).send({ campaigns: [rec] });
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(1);

    const second = await request(app).post('/api/campaigns/import').set('Cookie', cookie).send({ campaigns: [rec] });
    expect(second.body.imported).toBe(1);

    const list = await request(app).get('/api/campaigns').set('Cookie', cookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe('fixed-id-1');
    expect(list.body[0].createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('skips malformed records during import', async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .post('/api/campaigns/import')
      .set('Cookie', cookie)
      .send({
        campaigns: [
          { name: 'no id' },
          null,
          'nope',
          { id: 'ok', name: 'Good', platforms: [], screenshots: [], posts: [] },
        ],
      });
    expect(res.body.imported).toBe(1);
  });
}, { timeout: 30_000 });
