/**
 * Tests for the campaigns API service layer (src/api/campaigns.ts).
 *
 * Campaigns are now persisted server-side, so these tests mock `fetch` and
 * verify the request shapes, client-side validation, error mapping, and the
 * one-time localStorage → server migration. The localStorage ORM itself is
 * covered separately by tests/db/CampaignModel.test.ts.
 *
 * localStorage is available via the jsdom environment.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  fetchCampaigns,
  fetchCampaign,
  fetchCampaignStats,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  ApiError,
} from '../../src/api/campaigns'
import type { CampaignRecord, CreateCampaignInput } from '../../src/db/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIGRATED_FLAG = 'automarketer_campaigns_migrated'
const CAMPAIGNS_KEY = 'automarketer_campaigns'

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

function record(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: 'c1',
    name: 'API Test Campaign',
    websiteUrl: 'https://api-test.example.com',
    description: 'Testing the API layer',
    status: 'draft',
    tone: 'casual',
    targetAudience: 'testers',
    platforms: ['twitter'],
    screenshots: [],
    posts: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Build a minimal Response-like object for the fetch mock. */
function jsonRes(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  // Skip migration by default so each test exercises a single endpoint.
  localStorage.setItem(MIGRATED_FLAG, 'true')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── Reads ──────────────────────────────────────────────────────────────────

describe('fetchCampaigns()', () => {
  it('GETs /api/campaigns with credentials and returns the body', async () => {
    const data = [record()]
    fetchMock.mockResolvedValueOnce(jsonRes(200, data))

    const result = await fetchCampaigns()

    expect(result).toEqual(data)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/campaigns')
    expect(init).toMatchObject({ credentials: 'include' })
  })

  it('maps a network failure to ApiError(statusCode 0)', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const err = await fetchCampaigns().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(0)
  })
})

describe('fetchCampaign()', () => {
  it('returns the campaign when found', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, record({ id: 'abc' })))
    const found = await fetchCampaign('abc')
    expect(found.id).toBe('abc')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/campaigns/abc')
  })

  it('rejects with the server message and status on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(404, { error: 'Campaign not found', code: 'NOT_FOUND' }))
    await expect(fetchCampaign('nope')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Campaign not found',
    })
  })
})

describe('fetchCampaignStats()', () => {
  it('computes stats from the fetched campaign list', async () => {
    const campaigns = [
      record({
        id: 'a',
        posts: [
          {
            id: 'p1',
            platform: 'twitter',
            content: 'hi',
            hashtags: [],
            status: 'published',
            engagements: { likes: 5, comments: 1, shares: 4, views: 100 },
          },
        ],
      }),
      record({ id: 'b', posts: [] }),
    ]
    fetchMock.mockResolvedValueOnce(jsonRes(200, campaigns))

    const stats = await fetchCampaignStats()

    expect(stats.totalCampaigns).toBe(2)
    expect(stats.totalPostsPublished).toBe(1)
    expect(stats.totalEngagements).toBe(10)
    expect(stats.avgEngagementRate).toBe(10) // 10 / 100 * 100
    expect(stats.topPlatform).toBe('twitter')
  })
})

// ─── Writes + validation ──────────────────────────────────────────────────────

describe('createCampaign()', () => {
  it('POSTs the input and returns the created record', async () => {
    const created = record({ id: 'new-id' })
    fetchMock.mockResolvedValueOnce(jsonRes(201, created))

    const result = await createCampaign(SAMPLE_INPUT)

    expect(result.id).toBe('new-id')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/campaigns')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ name: 'API Test Campaign' })
  })

  it('rejects an empty name with ApiError(400) WITHOUT calling the server', async () => {
    await expect(createCampaign({ ...SAMPLE_INPUT, name: '   ' })).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-http websiteUrl without calling the server', async () => {
    await expect(
      createCampaign({ ...SAMPLE_INPUT, websiteUrl: 'javascript:alert(1)' }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateCampaign()', () => {
  it('PATCHes the patch and returns the updated record', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, record({ name: 'Renamed' })))
    const result = await updateCampaign('c1', { name: 'Renamed' })
    expect(result.name).toBe('Renamed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/campaigns/c1')
    expect(init).toMatchObject({ method: 'PATCH' })
  })

  it('rejects an empty-string name patch without calling the server', async () => {
    await expect(updateCampaign('c1', { name: '' })).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deleteCampaign()', () => {
  it('DELETEs and resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(204))
    await expect(deleteCampaign('c1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('rejects with ApiError on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(404, { error: 'Campaign not found' }))
    await expect(deleteCampaign('c1')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─── One-time migration ─────────────────────────────────────────────────────
// Runs last: it is the only test that leaves the migrated flag unset, so the
// module's one-shot migration guard is still pristine when it executes.

describe('localStorage → server migration', () => {
  it('uploads local campaigns once, then reads from the server', async () => {
    localStorage.removeItem(MIGRATED_FLAG)
    localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify([record({ id: 'local-1' })]))

    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/import')) return Promise.resolve(jsonRes(200, { imported: 1 }))
      return Promise.resolve(jsonRes(200, [record({ id: 'local-1' })]))
    })

    const result = await fetchCampaigns()

    expect(result[0].id).toBe('local-1')
    // First call must be the import, second the list.
    expect(fetchMock.mock.calls[0][0]).toBe('/api/campaigns/import')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/campaigns')
    // Flag is set so it won't run again.
    expect(localStorage.getItem(MIGRATED_FLAG)).toBe('true')
  })
})
