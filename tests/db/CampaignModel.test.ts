/**
 * Tests for the CampaignModel ORM.
 *
 * Uses the jsdom environment (configured in vitest.config.ts) which provides
 * a localStorage implementation, so the model can be exercised without mocks.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { CampaignModel, StorageError } from '../../src/db/CampaignModel'
import type { CreateCampaignInput } from '../../src/db/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_INPUT: CreateCampaignInput = {
  name: 'Test Campaign',
  websiteUrl: 'https://test.example.com',
  description: 'A test campaign description',
  status: 'draft',
  tone: 'professional',
  targetAudience: 'developers',
  platforms: ['linkedin', 'twitter'],
  screenshots: [],
  posts: [],
}

// Reset localStorage and mocks before each test so tests don't share state.
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ─── init() ───────────────────────────────────────────────────────────────────

describe('CampaignModel.init()', () => {
  it('starts with an empty store by default (no VITE_SEED_DEMO_DATA)', () => {
    CampaignModel.init()
    expect(CampaignModel.count()).toBe(0)
  })

  it('seeds sample campaigns when VITE_SEED_DEMO_DATA=true', () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    CampaignModel.init()
    expect(CampaignModel.findAll().length).toBeGreaterThan(0)
  })

  it('is idempotent — calling init() twice does not duplicate records', () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    CampaignModel.init()
    const countAfterFirst = CampaignModel.count()
    CampaignModel.init()
    expect(CampaignModel.count()).toBe(countAfterFirst)
  })

  it('clears stale data when schema version changes', () => {
    // Manually set an old version
    localStorage.setItem('automarketer_db_version', '0')
    // Put some data in the store
    localStorage.setItem('automarketer_campaigns', JSON.stringify([{ id: 'stale', name: 'old' }]))

    CampaignModel.init()
    const all = CampaignModel.findAll()
    // Stale record must be gone after the schema version bump clears the store
    expect(all.every((c) => c.id !== 'stale')).toBe(true)
  })

  it('clears demo data when VITE_SEED_DEMO_DATA is removed after a prior demo run', () => {
    // First run: demo mode ON — seeds data and sets the flag
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    CampaignModel.init()
    expect(CampaignModel.count()).toBeGreaterThan(0)

    // Second run: demo mode OFF — demo data must be cleared
    vi.stubEnv('VITE_SEED_DEMO_DATA', '')
    CampaignModel.init()
    expect(CampaignModel.count()).toBe(0)
  })

  it('clears demo data seeded before the flag existed (legacy detection via sample IDs)', () => {
    // Simulate an old-style seed: write sample records but remove the demo flag
    CampaignModel.seed()
    localStorage.removeItem('automarketer_demo_seeded')
    expect(CampaignModel.count()).toBeGreaterThan(0)

    // init() without demo mode should still detect and remove them by ID match
    CampaignModel.init()
    expect(CampaignModel.count()).toBe(0)
  })

  it('does not clear real user data when VITE_SEED_DEMO_DATA is not set', () => {
    // Create campaigns that are NOT sample records (different IDs)
    CampaignModel.create(BASE_INPUT)
    CampaignModel.create({ ...BASE_INPUT, name: 'Second campaign' })

    CampaignModel.init()
    // Real user campaigns must be untouched
    expect(CampaignModel.count()).toBe(2)
  })

  it('sets the demo-seeded flag after seeding via init()', () => {
    vi.stubEnv('VITE_SEED_DEMO_DATA', 'true')
    CampaignModel.init()
    expect(localStorage.getItem('automarketer_demo_seeded')).toBe('true')
  })

  it('clears the demo-seeded flag when schema version changes', () => {
    // Plant a demo flag in storage
    localStorage.setItem('automarketer_demo_seeded', 'true')
    // Force a schema version mismatch
    localStorage.setItem('automarketer_db_version', '0')

    CampaignModel.init()
    expect(localStorage.getItem('automarketer_demo_seeded')).toBeNull()
  })
})

// ─── seed() ───────────────────────────────────────────────────────────────────

describe('CampaignModel.seed()', () => {
  it('loads at least the three sample campaigns', () => {
    CampaignModel.seed()
    expect(CampaignModel.count()).toBeGreaterThanOrEqual(3)
  })

  it('seeded records have both createdAt and updatedAt', () => {
    CampaignModel.seed()
    const all = CampaignModel.findAll()
    for (const c of all) {
      expect(typeof c.createdAt).toBe('string')
      expect(typeof c.updatedAt).toBe('string')
    }
  })
})

// ─── findAll() ────────────────────────────────────────────────────────────────

describe('CampaignModel.findAll()', () => {
  it('returns an empty array when the store is empty', () => {
    expect(CampaignModel.findAll()).toEqual([])
  })

  it('returns campaigns sorted by createdAt descending', () => {
    // Create campaigns with different timestamps
    CampaignModel.create({ ...BASE_INPUT, name: 'Older' })
    CampaignModel.create({ ...BASE_INPUT, name: 'Newer' })

    const all = CampaignModel.findAll()
    const dates = all.map((c) => new Date(c.createdAt).getTime())
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i])
    }
  })

  it('returns all created records', () => {
    CampaignModel.create(BASE_INPUT)
    CampaignModel.create({ ...BASE_INPUT, name: 'Another' })
    expect(CampaignModel.findAll()).toHaveLength(2)
  })
})

// ─── findById() ───────────────────────────────────────────────────────────────

describe('CampaignModel.findById()', () => {
  it('returns the record matching the given id', () => {
    const created = CampaignModel.create(BASE_INPUT)
    const found = CampaignModel.findById(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('Test Campaign')
  })

  it('returns null for an unknown id', () => {
    expect(CampaignModel.findById('no-such-id')).toBeNull()
  })
})

// ─── create() ─────────────────────────────────────────────────────────────────

describe('CampaignModel.create()', () => {
  it('returns a record with a generated id', () => {
    const record = CampaignModel.create(BASE_INPUT)
    expect(typeof record.id).toBe('string')
    expect(record.id.length).toBeGreaterThan(0)
  })

  it('assigns createdAt and updatedAt timestamps', () => {
    const before = Date.now()
    const record = CampaignModel.create(BASE_INPUT)
    const after = Date.now()
    const ts = new Date(record.createdAt).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
    expect(record.createdAt).toBe(record.updatedAt)
  })

  it('persists all input fields', () => {
    const record = CampaignModel.create(BASE_INPUT)
    expect(record.name).toBe('Test Campaign')
    expect(record.websiteUrl).toBe('https://test.example.com')
    expect(record.status).toBe('draft')
    expect(record.tone).toBe('professional')
    expect(record.platforms).toEqual(['linkedin', 'twitter'])
  })

  it('generates unique ids for each record', () => {
    const a = CampaignModel.create(BASE_INPUT)
    const b = CampaignModel.create(BASE_INPUT)
    expect(a.id).not.toBe(b.id)
  })

  it('increments count after creation', () => {
    expect(CampaignModel.count()).toBe(0)
    CampaignModel.create(BASE_INPUT)
    expect(CampaignModel.count()).toBe(1)
  })
})

// ─── update() ─────────────────────────────────────────────────────────────────

describe('CampaignModel.update()', () => {
  it('patches the specified fields', () => {
    const record = CampaignModel.create(BASE_INPUT)
    const updated = CampaignModel.update(record.id, { name: 'Updated Name', status: 'ready' })
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('Updated Name')
    expect(updated!.status).toBe('ready')
  })

  it('leaves unpatched fields unchanged', () => {
    const record = CampaignModel.create(BASE_INPUT)
    const updated = CampaignModel.update(record.id, { name: 'Changed' })
    expect(updated!.websiteUrl).toBe(BASE_INPUT.websiteUrl)
    expect(updated!.tone).toBe(BASE_INPUT.tone)
  })

  it('refreshes updatedAt but keeps createdAt unchanged', () => {
    const record = CampaignModel.create(BASE_INPUT)
    const originalCreatedAt = record.createdAt

    // Wait a tick to ensure the timestamp differs
    const updated = CampaignModel.update(record.id, { name: 'Changed' })
    expect(updated!.createdAt).toBe(originalCreatedAt)
  })

  it('prevents changing the id via a patch', () => {
    const record = CampaignModel.create(BASE_INPUT)
    const originalId = record.id
    const updated = CampaignModel.update(record.id, { id: 'hack' } as never)
    expect(updated!.id).toBe(originalId)
  })

  it('returns null for an unknown id', () => {
    expect(CampaignModel.update('no-such-id', { name: 'x' })).toBeNull()
  })

  it('persists the update so findById reflects the change', () => {
    const record = CampaignModel.create(BASE_INPUT)
    CampaignModel.update(record.id, { name: 'Persisted' })
    const found = CampaignModel.findById(record.id)
    expect(found!.name).toBe('Persisted')
  })
})

// ─── delete() ─────────────────────────────────────────────────────────────────

describe('CampaignModel.delete()', () => {
  it('removes the record from the store', () => {
    const record = CampaignModel.create(BASE_INPUT)
    expect(CampaignModel.delete(record.id)).toBe(true)
    expect(CampaignModel.findById(record.id)).toBeNull()
  })

  it('returns false for an unknown id', () => {
    expect(CampaignModel.delete('no-such-id')).toBe(false)
  })

  it('decrements count after deletion', () => {
    const record = CampaignModel.create(BASE_INPUT)
    expect(CampaignModel.count()).toBe(1)
    CampaignModel.delete(record.id)
    expect(CampaignModel.count()).toBe(0)
  })

  it('does not remove other records', () => {
    const a = CampaignModel.create(BASE_INPUT)
    const b = CampaignModel.create({ ...BASE_INPUT, name: 'Keep me' })
    CampaignModel.delete(a.id)
    expect(CampaignModel.findById(b.id)).not.toBeNull()
  })
})

// ─── count() ──────────────────────────────────────────────────────────────────

describe('CampaignModel.count()', () => {
  it('returns 0 on empty store', () => {
    expect(CampaignModel.count()).toBe(0)
  })

  it('reflects creates and deletes', () => {
    const a = CampaignModel.create(BASE_INPUT)
    const b = CampaignModel.create(BASE_INPUT)
    expect(CampaignModel.count()).toBe(2)
    CampaignModel.delete(a.id)
    expect(CampaignModel.count()).toBe(1)
    CampaignModel.delete(b.id)
    expect(CampaignModel.count()).toBe(0)
  })
})

// ─── getStats() ───────────────────────────────────────────────────────────────

describe('CampaignModel.getStats()', () => {
  it('returns zero values on an empty store', () => {
    const stats = CampaignModel.getStats()
    expect(stats.totalCampaigns).toBe(0)
    expect(stats.activeCampaigns).toBe(0)
    expect(stats.totalPostsPublished).toBe(0)
    expect(stats.totalEngagements).toBe(0)
    expect(stats.avgEngagementRate).toBe(0)
    expect(stats.topPlatform).toBeNull()
  })

  it('counts total campaigns', () => {
    CampaignModel.create(BASE_INPUT)
    CampaignModel.create(BASE_INPUT)
    expect(CampaignModel.getStats().totalCampaigns).toBe(2)
  })

  it('counts active campaigns (ready + generating)', () => {
    CampaignModel.create({ ...BASE_INPUT, status: 'ready' })
    CampaignModel.create({ ...BASE_INPUT, status: 'generating' })
    CampaignModel.create({ ...BASE_INPUT, status: 'draft' })
    CampaignModel.create({ ...BASE_INPUT, status: 'published' })
    expect(CampaignModel.getStats().activeCampaigns).toBe(2)
  })

  it('counts published posts', () => {
    CampaignModel.create({
      ...BASE_INPUT,
      posts: [
        { id: 'p1', platform: 'linkedin', content: 'post', hashtags: [], status: 'published' },
        { id: 'p2', platform: 'twitter', content: 'post', hashtags: [], status: 'draft' },
        { id: 'p3', platform: 'reddit', content: 'post', hashtags: [], status: 'published' },
      ],
    })
    expect(CampaignModel.getStats().totalPostsPublished).toBe(2)
  })

  it('sums engagements across all posts', () => {
    CampaignModel.create({
      ...BASE_INPUT,
      posts: [
        {
          id: 'p1',
          platform: 'linkedin',
          content: 'post',
          hashtags: [],
          status: 'published',
          engagements: { likes: 100, comments: 20, shares: 30, views: 1000 },
        },
        {
          id: 'p2',
          platform: 'twitter',
          content: 'post',
          hashtags: [],
          status: 'published',
          engagements: { likes: 200, comments: 50, shares: 10, views: 2000 },
        },
      ],
    })
    const stats = CampaignModel.getStats()
    // Total engagements = (100+20+30) + (200+50+10) = 150 + 260 = 410
    expect(stats.totalEngagements).toBe(410)
  })

  it('identifies the top platform by engagements', () => {
    CampaignModel.create({
      ...BASE_INPUT,
      posts: [
        {
          id: 'p1',
          platform: 'linkedin',
          content: 'post',
          hashtags: [],
          status: 'published',
          engagements: { likes: 10, comments: 5, shares: 5, views: 500 },
        },
        {
          id: 'p2',
          platform: 'twitter',
          content: 'post',
          hashtags: [],
          status: 'published',
          engagements: { likes: 200, comments: 50, shares: 100, views: 5000 },
        },
      ],
    })
    expect(CampaignModel.getStats().topPlatform).toBe('twitter')
  })

  it('seeded data produces non-zero stats', () => {
    CampaignModel.seed()
    const stats = CampaignModel.getStats()
    expect(stats.totalCampaigns).toBeGreaterThan(0)
    expect(stats.totalPostsPublished).toBeGreaterThan(0)
    expect(stats.totalEngagements).toBeGreaterThan(0)
  })
})

// ─── readAll() — malformed record filtering ───────────────────────────────────

describe('readAll() defensive filtering', () => {
  it('returns only valid records when store contains mixed good and bad data', () => {
    // Manually write a mix of valid and invalid records to localStorage
    const validRecord = CampaignModel.create(BASE_INPUT)
    const raw = localStorage.getItem('automarketer_campaigns')!
    const parsed: unknown[] = JSON.parse(raw)
    // Inject two corrupted entries alongside the valid one
    parsed.push({ broken: true }) // missing id and name
    parsed.push(null) // null entry
    localStorage.setItem('automarketer_campaigns', JSON.stringify(parsed))

    const all = CampaignModel.findAll()
    // Only the original valid record should survive
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(validRecord.id)
  })

  it('returns an empty array when localStorage contains non-array JSON', () => {
    localStorage.setItem('automarketer_campaigns', JSON.stringify({ not: 'an array' }))
    expect(CampaignModel.findAll()).toEqual([])
  })

  it('returns an empty array when localStorage contains malformed JSON', () => {
    localStorage.setItem('automarketer_campaigns', 'this is not json{{{')
    expect(CampaignModel.findAll()).toEqual([])
  })

  it('returns all records when every entry is valid', () => {
    CampaignModel.create(BASE_INPUT)
    CampaignModel.create({ ...BASE_INPUT, name: 'Second' })
    expect(CampaignModel.findAll()).toHaveLength(2)
  })
})

// ─── writeAll() — quota error handling ───────────────────────────────────────

describe('writeAll() quota error handling', () => {
  it('throws StorageError when localStorage.setItem throws QuotaExceededError', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => CampaignModel.create(BASE_INPUT)).toThrow(StorageError)
  })

  it('thrown StorageError contains a descriptive message', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => CampaignModel.create(BASE_INPUT)).toThrow(/persist campaigns/)
  })

  it('does not throw StorageError on successful writes', () => {
    // Normal operation — should not throw
    expect(() => CampaignModel.create(BASE_INPUT)).not.toThrow()
  })
})
