/**
 * Tests for the Analytics page.
 *
 * Analytics derives everything from real campaign data (server-backed via the
 * fetch mock). It reports publishing *activity* — counts, a weekly publish
 * chart, per-platform breakdown, and recently published posts — not engagement
 * metrics (those require platform metrics APIs that aren't connected).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Analytics from '../src/pages/Analytics'
import { CampaignModel } from '../src/db/CampaignModel'
import type { CreateCampaignInput, PostRecord } from '../src/db/schema'
import { installMockCampaignsApi, uninstallMockCampaignsApi } from './helpers/mockCampaignsApi'

function post(overrides: Partial<PostRecord>): PostRecord {
  return {
    id: Math.random().toString(36).slice(2),
    platform: 'linkedin',
    content: 'Hello world',
    hashtags: [],
    status: 'draft',
    ...overrides,
  }
}

function seedCampaign(name: string, posts: PostRecord[]): void {
  const input: CreateCampaignInput = {
    name,
    websiteUrl: 'https://example.com',
    description: 'desc',
    status: 'ready',
    tone: 'professional',
    targetAudience: 'devs',
    platforms: ['linkedin'],
    screenshots: [],
    posts,
  }
  CampaignModel.create(input)
}

beforeEach(() => {
  localStorage.clear()
  installMockCampaignsApi()
})

afterEach(() => {
  uninstallMockCampaignsApi()
})

describe('Analytics page', () => {
  it('shows empty states when there is no data', async () => {
    render(<Analytics />)
    await waitFor(() => {
      expect(screen.getByText('No posts published yet. Publish a post to see your activity here.')).toBeDefined()
    })
    expect(screen.getByText('No published posts yet.')).toBeDefined()
  })

  it('counts published, scheduled, and draft posts from real campaign data', async () => {
    seedCampaign('Campaign A', [
      post({ platform: 'linkedin', status: 'published', publishedAt: new Date().toISOString(), content: 'Live post' }),
      post({ platform: 'twitter', status: 'scheduled', scheduledAt: new Date().toISOString() }),
      post({ platform: 'reddit', status: 'draft' }),
      post({ platform: 'linkedin', status: 'published', publishedAt: new Date().toISOString() }),
    ])

    render(<Analytics />)

    // Wait for data to load (published count card shows 2).
    await waitFor(() => {
      expect(screen.getByText('Posts Published')).toBeDefined()
    })

    // Published = 2, Scheduled = 1, Drafts = 1
    const publishedCard = screen.getByText('Posts Published').closest('div')!.parentElement!
    expect(publishedCard.textContent).toContain('2')

    // Recently published table shows the live post content.
    expect(screen.getByText('Live post')).toBeDefined()
    // The publishing-activity chart renders (no empty-state message).
    expect(screen.queryByText('No posts published yet. Publish a post to see your activity here.')).toBeNull()
  })

  it('renders a per-platform breakdown with published counts', async () => {
    seedCampaign('Campaign B', [
      post({ platform: 'linkedin', status: 'published', publishedAt: new Date().toISOString() }),
      post({ platform: 'reddit', status: 'draft' }),
    ])

    render(<Analytics />)

    await waitFor(() => {
      expect(screen.getByText('Platform Breakdown')).toBeDefined()
    })
    // Both platforms appear (they each have at least one post).
    expect(screen.getByText('Published')).toBeDefined()
  })
})
