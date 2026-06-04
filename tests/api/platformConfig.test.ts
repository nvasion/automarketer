// @vitest-environment node
/**
 * Supertest integration tests for GET /api/platform-config.
 *
 * Runs in Node environment (not jsdom) because it imports real server modules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { platformConfigStore } from '../../server/models/platformConfigStore';

const app = createApp();

// Reset the store between tests so injected values don't bleed across cases.
beforeEach(() => {
  platformConfigStore._reset();
});

afterEach(() => {
  platformConfigStore._reset();
});

describe('GET /api/platform-config', () => {
  it('responds with HTTP 200', async () => {
    const res = await request(app).get('/api/platform-config');
    expect(res.status).toBe(200);
  });

  it('returns JSON content-type', async () => {
    const res = await request(app).get('/api/platform-config');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('returns all five platform keys', async () => {
    const res = await request(app).get('/api/platform-config');
    const keys = Object.keys(res.body as Record<string, string>);
    expect(keys).toContain('linkedin');
    expect(keys).toContain('twitter');
    expect(keys).toContain('reddit');
    expect(keys).toContain('facebook');
    expect(keys).toContain('instagram');
  });

  it('returns empty strings by default (no env vars set)', async () => {
    const res = await request(app).get('/api/platform-config');
    const body = res.body as Record<string, string>;
    // In the test environment, no LINKEDIN_CLIENT_ID etc. are set.
    // All values should be empty strings (unconfigured).
    expect(typeof body.linkedin).toBe('string');
    expect(typeof body.twitter).toBe('string');
    expect(typeof body.reddit).toBe('string');
    expect(typeof body.facebook).toBe('string');
    expect(typeof body.instagram).toBe('string');
  });

  it('returns the configured client ID when one has been set', async () => {
    platformConfigStore.setClientId('linkedin', 'test-linkedin-123');

    const res = await request(app).get('/api/platform-config');
    expect((res.body as Record<string, string>).linkedin).toBe('test-linkedin-123');
  });

  it('returns different values per platform', async () => {
    platformConfigStore.setClientId('linkedin', 'li-abc');
    platformConfigStore.setClientId('twitter', 'tw-xyz');
    platformConfigStore.setClientId('reddit', 'rd-qrs');

    const res = await request(app).get('/api/platform-config');
    const body = res.body as Record<string, string>;
    expect(body.linkedin).toBe('li-abc');
    expect(body.twitter).toBe('tw-xyz');
    expect(body.reddit).toBe('rd-qrs');
  });

  it('facebook and instagram share the same value', async () => {
    platformConfigStore.setClientId('facebook', 'meta-app-999');
    platformConfigStore.setClientId('instagram', 'meta-app-999');

    const res = await request(app).get('/api/platform-config');
    const body = res.body as Record<string, string>;
    expect(body.facebook).toBe(body.instagram);
  });

  it('does not require authentication', async () => {
    // No cookie / Authorization header — must still return 200.
    const res = await request(app)
      .get('/api/platform-config')
      .set('Cookie', ''); // explicitly no auth cookie
    expect(res.status).toBe(200);
  });
});
