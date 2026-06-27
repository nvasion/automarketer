// @vitest-environment node
/**
 * Supertest integration tests for the /api/media routes (upload + public fetch).
 *
 * Runs in the Node environment because it imports real server modules and uses
 * Supertest over Node's http. Uses the in-memory media/user stores (no
 * DATABASE_URL configured in tests).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { userStore } from '../../server/models/userStore';
import { mediaStore } from '../../server/db/mediaTable';

const app = createApp();

// A tiny valid base64 payload (the route stores raw bytes; content is opaque).
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64');

beforeEach(() => {
  userStore._clear();
  mediaStore._clear();
});

async function authCookie(): Promise<string> {
  await request(app).post('/api/auth/register').send({ email: 'm@example.com', password: 'password123' });
  const res = await request(app).post('/api/auth/login').send({ email: 'm@example.com', password: 'password123' });
  return (res.headers['set-cookie'] as string[] | undefined)?.[0] ?? '';
}

describe('POST /api/media', () => {
  it('rejects unauthenticated uploads', async () => {
    const res = await request(app)
      .post('/api/media')
      .send({ mimeType: 'image/png', dataBase64: PNG_B64 });
    expect(res.status).toBe(401);
  });

  it('stores an image and returns an id and public url', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/media')
      .set('Cookie', cookie)
      .send({ mimeType: 'image/png', dataBase64: PNG_B64 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.url).toContain(`/api/media/${res.body.id}`);
  });

  it('rejects a non-image mime type', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/media')
      .set('Cookie', cookie)
      .send({ mimeType: 'application/pdf', dataBase64: PNG_B64 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_MEDIA_TYPE');
  });

  it('rejects a request with no image data', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/media')
      .set('Cookie', cookie)
      .send({ mimeType: 'image/png' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/media/:id', () => {
  it('serves stored bytes with the stored content-type, unauthenticated', async () => {
    const cookie = await authCookie();
    const up = await request(app)
      .post('/api/media')
      .set('Cookie', cookie)
      .send({ mimeType: 'image/png', dataBase64: PNG_B64 });

    // No cookie on the GET — the endpoint is intentionally public.
    const res = await request(app).get(`/api/media/${up.body.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/media/does-not-exist');
    expect(res.status).toBe(404);
  });
});
