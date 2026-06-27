// @vitest-environment node
/**
 * Integration tests for GET /api/linkedin/pages
 *
 * The endpoint returns a list of LinkedIn identities the authenticated user can
 * post as: their personal profile plus any organization pages they administer.
 * It requires a valid LinkedIn access token in the token store and makes outbound
 * calls to api.linkedin.com — these are mocked via vi.stubGlobal('fetch', …).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { userStore } from '../../server/models/userStore';
import { accessTokenStore } from '../../server/models/accessTokenStore';

const app = createApp();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(
  email = 'li@example.com',
  password = 'password123',
): Promise<{ cookie: string; userId: string }> {
  const reg = await request(app).post('/api/auth/register').send({ email, password });
  const userId = reg.body.user.id as string;
  const login = await request(app).post('/api/auth/login').send({ email, password });
  const cookies = login.headers['set-cookie'] as unknown as string[] | undefined;
  return { cookie: cookies?.[0] ?? '', userId };
}

function makeOkFetch(body: unknown): () => Response {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
}

function makeFetchSequence(responses: Array<() => Response>): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(() => responses[i++]?.() ?? Promise.reject(new Error('No more fetch mocks')));
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  userStore._clear();
  accessTokenStore._clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  userStore._clear();
  accessTokenStore._clear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/linkedin/pages', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/linkedin/pages');
    expect(res.status).toBe(401);
  });

  it('returns 401 when user has no LinkedIn token', async () => {
    const { cookie } = await registerAndLogin();
    const res = await request(app).get('/api/linkedin/pages').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('returns personal profile when userinfo succeeds and no org scope', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'linkedin', 'tok123', {
      authorId: 'urn:li:person:abc',
    });

    const fetchMock = makeFetchSequence([
      // 1. userinfo → personal profile
      makeOkFetch({ sub: 'abc', name: 'Alice Smith' }),
      // 2. org ACLs → 403 (no r_organization_admin scope)
      () =>
        Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.reject(new Error('not ok')),
        } as unknown as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/linkedin/pages').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.pages).toHaveLength(1);
    expect(res.body.pages[0]).toMatchObject({
      urn: 'urn:li:person:abc',
      name: 'Alice Smith',
      type: 'person',
    });
  });

  it('includes organization pages when org ACL API returns results', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'linkedin', 'tok456', {
      authorId: 'urn:li:person:xyz',
    });

    const fetchMock = makeFetchSequence([
      // 1. userinfo
      makeOkFetch({ sub: 'xyz', name: 'Bob Jones' }),
      // 2. org ACLs
      makeOkFetch({
        elements: [
          { organizationalTarget: 'urn:li:organization:99001' },
          { organizationalTarget: 'urn:li:organization:99002' },
        ],
      }),
      // 3. org name lookup
      makeOkFetch({
        results: {
          '99001': { id: 99001, localizedName: 'Acme Corp' },
          '99002': { id: 99002, localizedName: 'Beta Ltd' },
        },
      }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/linkedin/pages').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.pages).toHaveLength(3);
    expect(res.body.pages[0]).toMatchObject({ type: 'person', name: 'Bob Jones' });
    expect(res.body.pages[1]).toMatchObject({
      urn: 'urn:li:organization:99001',
      name: 'Acme Corp',
      type: 'organization',
    });
    expect(res.body.pages[2]).toMatchObject({
      urn: 'urn:li:organization:99002',
      name: 'Beta Ltd',
      type: 'organization',
    });
  });

  it('falls back to generic org names when name lookup fails', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'linkedin', 'tok789');

    const fetchMock = makeFetchSequence([
      // userinfo
      makeOkFetch({ sub: 'def', given_name: 'Carol', family_name: 'White' }),
      // org ACLs
      makeOkFetch({ elements: [{ organizationalTarget: 'urn:li:organization:55555' }] }),
      // org name lookup → fails
      () =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('not ok')),
        } as unknown as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/linkedin/pages').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const org = res.body.pages.find((p: { type: string }) => p.type === 'organization');
    expect(org).toMatchObject({ urn: 'urn:li:organization:55555', name: 'Organization 55555' });
  });

  it('uses given_name + family_name when "name" field is absent from userinfo', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'linkedin', 'tokX', {
      authorId: 'urn:li:person:ghi',
    });

    const fetchMock = makeFetchSequence([
      makeOkFetch({ sub: 'ghi', given_name: 'Diana', family_name: 'Lee' }),
      () => Promise.resolve({ ok: false, status: 403 } as unknown as Response),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/linkedin/pages').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.pages[0].name).toBe('Diana Lee');
  });

  it('still returns personal profile when userinfo fetch throws', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'linkedin', 'tokErr', {
      authorId: 'urn:li:person:fallback',
    });

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue({ ok: false, status: 403 } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/linkedin/pages').set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Personal profile URN is still returned (from stored authorId), just with
    // the default name because userinfo failed.
    expect(res.body.pages[0]).toMatchObject({
      urn: 'urn:li:person:fallback',
      type: 'person',
    });
  });

  it('filters out non-organization ACL entries', async () => {
    const { cookie, userId } = await registerAndLogin();
    await accessTokenStore.setAccessToken(userId, 'linkedin', 'tokFilter', {
      authorId: 'urn:li:person:jkl',
    });

    const fetchMock = makeFetchSequence([
      makeOkFetch({ sub: 'jkl', name: 'Eve' }),
      makeOkFetch({
        elements: [
          { organizationalTarget: 'urn:li:organization:111' },
          { organizationalTarget: 'urn:li:person:shouldbefiltered' }, // non-org URN
          { organizationalTarget: null }, // missing
        ],
      }),
      makeOkFetch({ results: { '111': { id: 111, localizedName: 'Good Org' } } }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/linkedin/pages').set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Only the valid org URN should be included; non-org and null entries dropped
    const orgs = res.body.pages.filter((p: { type: string }) => p.type === 'organization');
    expect(orgs).toHaveLength(1);
    expect(orgs[0].urn).toBe('urn:li:organization:111');
  });
});
