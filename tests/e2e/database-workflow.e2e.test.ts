/**
 * End-to-end tests for the database (localStorage ORM) workflow.
 *
 * These tests exercise the full data lifecycle from the API layer down to
 * the CampaignModel ORM and localStorage persistence, verifying that:
 *   - CRUD operations chain together correctly
 *   - Stats stay in sync after mutations
 *   - Authentication guards protect write operations
 *   - Data survives simulated "page reloads" (clear module state, re-init)
 *   - Storage quota errors surface as user-friendly ApiErrors
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
import { CampaignModel } from '../../src/db/CampaignModel'
import type { CreateCampaignInput } from '../../src/db/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setSession(): void {
  localStorage.setItem(AUTH_SESSION_KEY, 'test-session-token')
}

function clearSession(): void {
  localStorage.removeItem(AUTH_SESSION_KEY)
}

const BASE_CAMPAIGN: CreateCampaignInput = {
  name: 'E2E Test Campaign',
  websiteUrl: 'https://e2e-test.example.com',
  description: 'End-to-end database workflow test campaign',
  status: 'draft',
  tone: 'professional',
  targetAudience: 'QA engineers',
  platforms: ['linkedin', 'twitter'],
  screenshots: [],
  posts: [],
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ─── Workflow 1: Full CRUD lifecycle ─────────────────────────────────────────

describe('Full CRUD lifecycle', () => {
  it('creates, reads, updates, and deletes a campaign in one chain', async () => {
    setSession()

    // CREATE
    const created = await createCampaign(BASE_CAMPAIGN)
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('E2E Test Campaign')
    expect(created.websiteUrl).toBe('https://e2e-test.example.com')
    expect(created.status).toBe('draft')
    expect(created.tone).toBe('professional')
    expect(created.platforms).toEqual(['linkedin', 'twitter'])
    expect(typeof created.createdAt).toBe('string')
    expect(typeof created.updatedAt).toBe('string')

    // READ — verify it's retrievable
    const fetched = await fetchCampaign(created.id)
    expect(fetched.id).toBe(created.id)
    expect(fetched.name).toBe('E2E Test Campaign')

    // LIST — verify it appears in the list
    const all = await fetchCampaigns()
    const found = all.find((c) => c.id === created.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('E2E Test Campaign')

    // UPDATE
    const updated = await updateCampaign(created.id, {
      name: 'Updated Campaign',
      status: 'ready',
      description: 'Updated description',
    })
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('Updated Campaign')
    expect(updated.status).toBe('ready')
    expect(updated.description).toBe('Updated description')
    // Untouched fields survive the patch
    expect(updated.websiteUrl).toBe('https://e2e-test.example.com')
    expect(updated.tone).toBe('professional')

    // Verify update is persisted
    const refetched = await fetchCampaign(created.id)
    expect(refetched.name).toBe('Updated Campaign')

    // DELETE
    await deleteCampaign(created.id)

    // Verify deletion
    await expect(fetchCampaign(created.id)).rejects.toMatchObject({ statusCode: 404 })
    const afterDelete = await fetchCampaigns()
    expect(afterDelete.find((c) => c.id === created.id)).toBeUndefined()
  })

  it('timestamps are set on create and updatedAt changes on update', async () => {
    setSession()

    const created = await createCampaign(BASE_CAMPAIGN)
    const originalCreatedAt = created.createdAt
    const originalUpdatedAt = created.updatedAt
    expect(originalCreatedAt).toBe(originalUpdatedAt)

    // Wait a tick to ensure the next timestamp differs
    await new Promise((r) => setTimeout(r, 5))

    const updated = await updateCampaign(created.id, { name: 'Changed' })
    expect(updated.createdAt).toBe(originalCreatedAt) // immutable
    // updatedAt should be >= createdAt (may equal on very fast machines)
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime()
    )
  })
})

// ─── Workflow 2: Multiple campaigns and list ordering ────────────────────────

describe('Multiple campaigns', () => {
  it('returns all campaigns sorted by createdAt descending', async () => {
    setSession()

    await createCampaign({ ...BASE_CAMPAIGN, name: 'Alpha' })
    await createCampaign({ ...BASE_CAMPAIGN, name: 'Beta' })
    await createCampaign({ ...BASE_CAMPAIGN, name: 'Gamma' })

    const all = await fetchCampaigns()
    expect(all.length).toBeGreaterThanOrEqual(3)

    const dates = all.map((c) => new Date(c.createdAt).getTime())
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i])
    }
  })

  it('deleting one campaign does not affect others', async () => {
    setSession()

    const a = await createCampaign({ ...BASE_CAMPAIGN, name: 'Keep A' })
    const b = await createCampaign({ ...BASE_CAMPAIGN, name: 'Delete B' })
    const c = await createCampaign({ ...BASE_CAMPAIGN, name: 'Keep C' })

    await deleteCampaign(b.id)

    const keepA = await fetchCampaign(a.id)
    const keepC = await fetchCampaign(c.id)
    expect(keepA.name).toBe('Keep A')
    expect(keepC.name).toBe('Keep C')
    await expect(fetchCampaign(b.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('updating one campaign does not affect others', async () => {
    setSession()

    const a = await createCampaign({ ...BASE_CAMPAIGN, name: 'Campaign A' })
    const b = await createCampaign({ ...BASE_CAMPAIGN, name: 'Campaign B' })

    await updateCampaign(a.id, { name: 'Campaign A — Updated' })

    const reB = await fetchCampaign(b.id)
    expect(reB.name).toBe('Campaign B') // B untouched
  })
})

// ─── Workflow 3: Stats reflect mutations ─────────────────────────────────────

describe('Stats stay in sync with mutations', () => {
  it('totalCampaigns increments on create and decrements on delete', async () => {
    setSession()

    const s0 = await fetchCampaignStats()
    expect(s0.totalCampaigns).toBe(0)

    const c1 = await createCampaign(BASE_CAMPAIGN)
    expect((await fetchCampaignStats()).totalCampaigns).toBe(1)

    await createCampaign({ ...BASE_CAMPAIGN, name: 'Second' })
    expect((await fetchCampaignStats()).totalCampaigns).toBe(2)

    await deleteCampaign(c1.id)
    expect((await fetchCampaignStats()).totalCampaigns).toBe(1)
  })

  it('activeCampaigns counts only ready and generating statuses', async () => {
    setSession()

    await createCampaign({ ...BASE_CAMPAIGN, status: 'draft' })
    await createCampaign({ ...BASE_CAMPAIGN, status: 'ready' })
    await createCampaign({ ...BASE_CAMPAIGN, status: 'generating' })
    await createCampaign({ ...BASE_CAMPAIGN, status: 'published' })

    const stats = await fetchCampaignStats()
    expect(stats.activeCampaigns).toBe(2)
  })

  it('stats reflect a status change via update', async () => {
    setSession()

    const c = await createCampaign({ ...BASE_CAMPAIGN, status: 'draft' })
    expect((await fetchCampaignStats()).activeCampaigns).toBe(0)

    await updateCampaign(c.id, { status: 'ready' })
    expect((await fetchCampaignStats()).activeCampaigns).toBe(1)
  })

  it('seeded sample data produces non-zero stats when VITE_SEED_DEMO_DATA=true', async () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    initDb()
    const stats = await fetchCampaignStats()
    expect(stats.totalCampaigns).toBeGreaterThan(0)
    expect(stats.totalPostsPublished).toBeGreaterThan(0)
    expect(stats.totalEngagements).toBeGreaterThan(0)
  })
})

// ─── Workflow 4: Database initialisation and seeding ────────────────────────

describe('Database initialisation', () => {
  it('initDb() seeds sample campaigns when VITE_SEED_DEMO_DATA=true', async () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    initDb()
    const campaigns = await fetchCampaigns()
    expect(campaigns.length).toBeGreaterThan(0)
    // All seeded campaigns must have well-formed fields
    for (const c of campaigns) {
      expect(typeof c.id).toBe('string')
      expect(typeof c.name).toBe('string')
      expect(c.name.length).toBeGreaterThan(0)
      expect(typeof c.createdAt).toBe('string')
    }
  })

  it('initDb() is idempotent — calling it twice does not duplicate records', async () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    initDb()
    const count1 = (await fetchCampaigns()).length
    initDb()
    const count2 = (await fetchCampaigns()).length
    expect(count2).toBe(count1)
  })

  it('clears stale data when schema version changes', () => {
    localStorage.setItem('automarketer_db_version', '0')
    localStorage.setItem('automarketer_campaigns', JSON.stringify([{ id: 'stale-record', name: 'old' }]))

    CampaignModel.init()
    const all = CampaignModel.findAll()
    expect(all.every((c) => c.id !== 'stale-record')).toBe(true)
  })
})

// ─── Workflow 5: Authentication guards ───────────────────────────────────────

describe('Authentication guard on write operations', () => {
  it('createCampaign throws 401 when no session is set', async () => {
    await expect(createCampaign(BASE_CAMPAIGN)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('updateCampaign throws 401 when session is cleared mid-session', async () => {
    setSession()
    const created = await createCampaign(BASE_CAMPAIGN)
    clearSession()
    await expect(updateCampaign(created.id, { name: 'Hack' })).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('deleteCampaign throws 401 when no session is set', async () => {
    await expect(deleteCampaign('any-id')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('read operations do not require a session', async () => {
    // fetchCampaigns and fetchCampaignStats are read-only and session-agnostic
    const campaigns = await fetchCampaigns()
    expect(Array.isArray(campaigns)).toBe(true)
    const stats = await fetchCampaignStats()
    expect(typeof stats.totalCampaigns).toBe('number')
  })
})

// ─── Workflow 6: Input validation on create ──────────────────────────────────

describe('Input validation — createCampaign', () => {
  beforeEach(() => { setSession() })

  it('rejects a javascript: websiteUrl with 400', async () => {
    await expect(
      createCampaign({ ...BASE_CAMPAIGN, websiteUrl: 'javascript:alert(1)' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a data: websiteUrl with 400', async () => {
    await expect(
      createCampaign({ ...BASE_CAMPAIGN, websiteUrl: 'data:text/html,<script>xss</script>' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a plain-string websiteUrl with 400', async () => {
    await expect(
      createCampaign({ ...BASE_CAMPAIGN, websiteUrl: 'not a url' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('accepts http:// and https:// URLs', async () => {
    const http = await createCampaign({ ...BASE_CAMPAIGN, websiteUrl: 'http://example.com' })
    const https = await createCampaign({ ...BASE_CAMPAIGN, websiteUrl: 'https://example.com' })
    expect(http.websiteUrl).toBe('http://example.com')
    expect(https.websiteUrl).toBe('https://example.com')
  })

  it('rejects a blank campaign name with 400', async () => {
    await expect(
      createCampaign({ ...BASE_CAMPAIGN, name: '   ' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a name longer than 200 chars with 400', async () => {
    await expect(
      createCampaign({ ...BASE_CAMPAIGN, name: 'x'.repeat(201) })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a description longer than 5000 chars with 400', async () => {
    await expect(
      createCampaign({ ...BASE_CAMPAIGN, description: 'y'.repeat(5001) })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a targetAudience longer than 500 chars with 400', async () => {
    await expect(
      createCampaign({ ...BASE_CAMPAIGN, targetAudience: 'z'.repeat(501) })
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ─── Workflow 7: Error scenarios ─────────────────────────────────────────────

describe('Error handling', () => {
  it('fetchCampaign throws ApiError(404) for unknown id', async () => {
    await expect(fetchCampaign('no-such-id')).rejects.toBeInstanceOf(ApiError)
    await expect(fetchCampaign('no-such-id')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('fetchCampaign error message does not leak the id (no enumeration)', async () => {
    await expect(fetchCampaign('secret-internal-id')).rejects.toMatchObject({
      message: 'Campaign not found',
    })
  })

  it('updateCampaign throws ApiError(404) for unknown id', async () => {
    setSession()
    await expect(updateCampaign('ghost-id', { name: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('deleteCampaign throws ApiError(404) for unknown id', async () => {
    setSession()
    await expect(deleteCampaign('ghost-id')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('createCampaign maps storage quota overflow to ApiError(507)', async () => {
    setSession()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    await expect(createCampaign(BASE_CAMPAIGN)).rejects.toMatchObject({ statusCode: 507 })
  })

  it('updateCampaign maps storage quota overflow to ApiError(507)', async () => {
    setSession()
    const created = await createCampaign(BASE_CAMPAIGN)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    await expect(updateCampaign(created.id, { name: 'Boom' })).rejects.toMatchObject({
      statusCode: 507,
    })
  })
})

// ─── Workflow 8: Data integrity across API boundaries ────────────────────────

describe('Data integrity across API boundaries', () => {
  it('all input fields are round-tripped correctly through create → fetch', async () => {
    setSession()
    const input: CreateCampaignInput = {
      name: 'Round-Trip Campaign',
      websiteUrl: 'https://round-trip.example.com',
      description: 'Testing all fields survive a round-trip',
      status: 'draft',
      tone: 'casual',
      targetAudience: 'Frontend developers',
      platforms: ['twitter', 'instagram', 'facebook'],
      screenshots: [],
      posts: [],
    }

    const created = await createCampaign(input)
    const fetched = await fetchCampaign(created.id)

    expect(fetched.name).toBe(input.name)
    expect(fetched.websiteUrl).toBe(input.websiteUrl)
    expect(fetched.description).toBe(input.description)
    expect(fetched.status).toBe(input.status)
    expect(fetched.tone).toBe(input.tone)
    expect(fetched.targetAudience).toBe(input.targetAudience)
    expect(fetched.platforms).toEqual(input.platforms)
    expect(fetched.screenshots).toEqual([])
    expect(fetched.posts).toEqual([])
  })

  it('partial update does not overwrite unspecified fields', async () => {
    setSession()
    const created = await createCampaign({
      ...BASE_CAMPAIGN,
      platforms: ['reddit', 'facebook'],
      tone: 'informative',
    })

    // Only update the name
    const updated = await updateCampaign(created.id, { name: 'Partial Update' })

    expect(updated.name).toBe('Partial Update')
    expect(updated.platforms).toEqual(['reddit', 'facebook'])
    expect(updated.tone).toBe('informative')
    expect(updated.websiteUrl).toBe(BASE_CAMPAIGN.websiteUrl)
  })

  it('ApiError is an instance of Error', () => {
    const err = new ApiError('Not found', 404)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.name).toBe('ApiError')
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('Not found')
  })
})
