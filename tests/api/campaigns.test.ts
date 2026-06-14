/**
 * Tests for the campaigns API service layer.
 *
 * These tests verify the async wrapper functions in src/api/campaigns.ts.
 * localStorage is available via the jsdom environment.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  initDb,
  fetchCampaigns,
  fetchCampaign,
  fetchCampaignStats,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  ApiError,
  AUTH_SESSION_KEY,
} from '../../src/api/campaigns'
import type { CreateCampaignInput } from '../../src/db/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_INPUT: CreateCampaignInput = {
  name: 'API Test Campaign',
  websiteUrl: 'https://api-test.example.com',
  description: 'Testing the API layer',
  status: 'draft',
  tone: 'casual',
  targetAudience: 'testers',
  platforms: ['twitter'],
  screenshots: [],
  posts: [],
}

/** Set a valid session token so authenticated write operations pass. */
function setSession(): void {
  localStorage.setItem(AUTH_SESSION_KEY, 'test-session-token')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ─── initDb() ─────────────────────────────────────────────────────────────────

describe('initDb()', () => {
  it('starts with an empty store by default (no VITE_SEED_DEMO_DATA)', async () => {
    initDb()
    const campaigns = await fetchCampaigns()
    expect(campaigns.length).toBe(0)
  })

  it('seeds demo campaigns when VITE_SEED_DEMO_DATA=true', async () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    initDb()
    const campaigns = await fetchCampaigns()
    expect(campaigns.length).toBeGreaterThan(0)
  })

  it('is idempotent', async () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    initDb()
    const count1 = (await fetchCampaigns()).length
    initDb()
    const count2 = (await fetchCampaigns()).length
    expect(count1).toBe(count2)
  })
})

// ─── fetchCampaigns() ─────────────────────────────────────────────────────────

describe('fetchCampaigns()', () => {
  it('returns an array', async () => {
    const result = await fetchCampaigns()
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns created campaigns', async () => {
    setSession()
    await createCampaign(SAMPLE_INPUT)
    const campaigns = await fetchCampaigns()
    expect(campaigns.some((c) => c.name === 'API Test Campaign')).toBe(true)
  })

  it('returns campaigns sorted by createdAt descending', async () => {
    // Seed demo data to get multiple campaigns with known timestamps
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    initDb()
    const campaigns = await fetchCampaigns()
    // Verify the returned list is in non-ascending createdAt order
    const dates = campaigns.map((c) => new Date(c.createdAt).getTime())
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i])
    }
  })
})

// ─── fetchCampaign() ──────────────────────────────────────────────────────────

describe('fetchCampaign()', () => {
  it('returns the correct campaign by id', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    const found = await fetchCampaign(created.id)
    expect(found.id).toBe(created.id)
    expect(found.name).toBe('API Test Campaign')
  })

  it('throws ApiError(404) for unknown id', async () => {
    await expect(fetchCampaign('no-such-id')).rejects.toThrow(ApiError)
    await expect(fetchCampaign('no-such-id')).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('error message does not contain the requested id', async () => {
    await expect(fetchCampaign('secret-internal-id')).rejects.toMatchObject({
      message: 'Campaign not found',
    })
  })
})

// ─── fetchCampaignStats() ─────────────────────────────────────────────────────

describe('fetchCampaignStats()', () => {
  it('returns a CampaignStats object with required fields', async () => {
    const stats = await fetchCampaignStats()
    expect(typeof stats.totalCampaigns).toBe('number')
    expect(typeof stats.activeCampaigns).toBe('number')
    expect(typeof stats.totalPostsPublished).toBe('number')
    expect(typeof stats.totalEngagements).toBe('number')
    expect(typeof stats.avgEngagementRate).toBe('number')
  })

  it('reflects the number of created campaigns', async () => {
    setSession()
    await createCampaign(SAMPLE_INPUT)
    await createCampaign({ ...SAMPLE_INPUT, name: 'Another' })
    const stats = await fetchCampaignStats()
    expect(stats.totalCampaigns).toBe(2)
  })
})

// ─── createCampaign() ─────────────────────────────────────────────────────────

describe('createCampaign()', () => {
  it('returns a record with id and timestamps', async () => {
    setSession()
    const record = await createCampaign(SAMPLE_INPUT)
    expect(typeof record.id).toBe('string')
    expect(typeof record.createdAt).toBe('string')
    expect(typeof record.updatedAt).toBe('string')
  })

  it('persists all input fields', async () => {
    setSession()
    const record = await createCampaign(SAMPLE_INPUT)
    expect(record.name).toBe('API Test Campaign')
    expect(record.websiteUrl).toBe('https://api-test.example.com')
    expect(record.tone).toBe('casual')
    expect(record.platforms).toEqual(['twitter'])
  })

  it('newly created campaign is retrievable via fetchCampaign', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    const fetched = await fetchCampaign(created.id)
    expect(fetched.id).toBe(created.id)
  })

  // ── Authentication ──────────────────────────────────────────────────────────

  it('throws ApiError(401) when no session is set', async () => {
    await expect(createCampaign(SAMPLE_INPUT)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  // ── URL validation ──────────────────────────────────────────────────────────

  it('throws ApiError(400) for a javascript: URL scheme', async () => {
    setSession()
    await expect(
      createCampaign({ ...SAMPLE_INPUT, websiteUrl: 'javascript:alert(1)' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws ApiError(400) for a data: URL scheme', async () => {
    setSession()
    await expect(
      createCampaign({ ...SAMPLE_INPUT, websiteUrl: 'data:text/html,<script>alert(1)</script>' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws ApiError(400) for a non-URL string', async () => {
    setSession()
    await expect(
      createCampaign({ ...SAMPLE_INPUT, websiteUrl: 'not a url' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('accepts http:// URLs', async () => {
    setSession()
    const record = await createCampaign({ ...SAMPLE_INPUT, websiteUrl: 'http://example.com' })
    expect(record.websiteUrl).toBe('http://example.com')
  })

  it('accepts https:// URLs', async () => {
    setSession()
    const record = await createCampaign({ ...SAMPLE_INPUT, websiteUrl: 'https://example.com' })
    expect(record.websiteUrl).toBe('https://example.com')
  })

  // ── String length validation ────────────────────────────────────────────────

  it('throws ApiError(400) when name exceeds 200 characters', async () => {
    setSession()
    await expect(
      createCampaign({ ...SAMPLE_INPUT, name: 'a'.repeat(201) })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws ApiError(400) when description exceeds 5000 characters', async () => {
    setSession()
    await expect(
      createCampaign({ ...SAMPLE_INPUT, description: 'x'.repeat(5001) })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws ApiError(400) when targetAudience exceeds 500 characters', async () => {
    setSession()
    await expect(
      createCampaign({ ...SAMPLE_INPUT, targetAudience: 'y'.repeat(501) })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws ApiError(400) for an empty name', async () => {
    setSession()
    await expect(createCampaign({ ...SAMPLE_INPUT, name: '   ' })).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  // ── Subreddit validation ────────────────────────────────────────────────────

  it('accepts a single subreddit string and normalizes it', async () => {
    setSession()
    const record = await createCampaign({ ...SAMPLE_INPUT, subreddits: 'r/startups' })
    expect(record.subreddits).toEqual(['startups'])
  })

  it('accepts an array of subreddits', async () => {
    setSession()
    const record = await createCampaign({ ...SAMPLE_INPUT, subreddits: ['startups', 'SaaS'] })
    expect(record.subreddits).toEqual(['startups', 'SaaS'])
  })

  it('throws ApiError(400) for a malformed subreddit name', async () => {
    setSession()
    await expect(
      createCampaign({ ...SAMPLE_INPUT, subreddits: 'https://evil.example' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ─── updateCampaign() ─────────────────────────────────────────────────────────

describe('updateCampaign()', () => {
  it('applies the patch and returns updated record', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    const updated = await updateCampaign(created.id, { name: 'Patched', status: 'ready' })
    expect(updated.name).toBe('Patched')
    expect(updated.status).toBe('ready')
  })

  it('does not change unpatched fields', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    const updated = await updateCampaign(created.id, { name: 'Changed' })
    expect(updated.websiteUrl).toBe(SAMPLE_INPUT.websiteUrl)
  })

  it('throws ApiError(404) for unknown id', async () => {
    setSession()
    await expect(updateCampaign('no-such-id', { name: 'x' })).rejects.toThrow(ApiError)
    await expect(updateCampaign('no-such-id', { name: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('error message does not contain the requested id', async () => {
    setSession()
    await expect(updateCampaign('secret-internal-id', { name: 'x' })).rejects.toMatchObject({
      message: 'Campaign not found',
    })
  })

  it('change is visible in subsequent fetchCampaign call', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    await updateCampaign(created.id, { name: 'Visible' })
    const refetched = await fetchCampaign(created.id)
    expect(refetched.name).toBe('Visible')
  })

  // ── Authentication ──────────────────────────────────────────────────────────

  it('throws ApiError(401) when no session is set', async () => {
    // Create first, then clear session, then try to update
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    localStorage.removeItem(AUTH_SESSION_KEY)
    await expect(updateCampaign(created.id, { name: 'x' })).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  // ── URL validation ──────────────────────────────────────────────────────────

  it('throws ApiError(400) for a javascript: URL scheme in patch', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    await expect(
      updateCampaign(created.id, { websiteUrl: 'javascript:void(0)' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws ApiError(400) when patched name is empty', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    await expect(updateCampaign(created.id, { name: '' })).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('throws ApiError(400) when patched name exceeds 200 characters', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    await expect(
      updateCampaign(created.id, { name: 'z'.repeat(201) })
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ─── deleteCampaign() ─────────────────────────────────────────────────────────

describe('deleteCampaign()', () => {
  it('removes the campaign', async () => {
    setSession()
    const created = await createCampaign(SAMPLE_INPUT)
    await deleteCampaign(created.id)
    await expect(fetchCampaign(created.id)).rejects.toThrow(ApiError)
  })

  it('throws ApiError(404) for unknown id', async () => {
    setSession()
    await expect(deleteCampaign('no-such-id')).rejects.toThrow(ApiError)
    await expect(deleteCampaign('no-such-id')).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('error message does not contain the requested id', async () => {
    setSession()
    await expect(deleteCampaign('secret-internal-id')).rejects.toMatchObject({
      message: 'Campaign not found',
    })
  })

  it('does not affect other campaigns', async () => {
    setSession()
    const a = await createCampaign(SAMPLE_INPUT)
    const b = await createCampaign({ ...SAMPLE_INPUT, name: 'Keep' })
    await deleteCampaign(a.id)
    const found = await fetchCampaign(b.id)
    expect(found.name).toBe('Keep')
  })

  // ── Authentication ──────────────────────────────────────────────────────────

  it('throws ApiError(401) when no session is set', async () => {
    await expect(deleteCampaign('any-id')).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})

// ─── Storage error mapping ────────────────────────────────────────────────────

describe('storage error mapping', () => {
  it('converts a StorageError to ApiError(507) on createCampaign', async () => {
    setSession()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    await expect(createCampaign(SAMPLE_INPUT)).rejects.toMatchObject({
      statusCode: 507,
    })
  })

  it('converts a StorageError to ApiError(507) on updateCampaign', async () => {
    // Create the record while storage is healthy, then simulate quota failure on update
    setSession()
    const record = await createCampaign(SAMPLE_INPUT)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    await expect(updateCampaign(record.id, { name: 'New' })).rejects.toMatchObject({
      statusCode: 507,
    })
  })
})

// ─── ApiError ─────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('is an instance of Error', () => {
    const err = new ApiError('test', 400)
    expect(err).toBeInstanceOf(Error)
  })

  it('exposes the statusCode', () => {
    const err = new ApiError('not found', 404)
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('not found')
  })

  it('name is ApiError', () => {
    const err = new ApiError('x')
    expect(err.name).toBe('ApiError')
  })
})
