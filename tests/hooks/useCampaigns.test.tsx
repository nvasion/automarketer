/**
 * Tests for the useCampaigns and useCampaignStats hooks.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useCampaigns, useCampaignStats } from '../../src/hooks/useCampaigns'
import { CampaignModel } from '../../src/db/CampaignModel'
import type { CreateCampaignInput } from '../../src/db/schema'

// ─── Setup ────────────────────────────────────────────────────────────────────

const SAMPLE_INPUT: CreateCampaignInput = {
  name: 'Hook Test Campaign',
  websiteUrl: 'https://hook-test.example.com',
  description: 'Testing the hook',
  status: 'ready',
  tone: 'professional',
  targetAudience: 'hook testers',
  platforms: ['linkedin'],
  screenshots: [],
  posts: [],
}

beforeEach(() => {
  localStorage.clear()
})

// ─── useCampaigns ─────────────────────────────────────────────────────────────

function CampaignsDisplay() {
  const { campaigns, loading, error } = useCampaigns()
  if (loading) return <div data-testid="loading">Loading</div>
  if (error) return <div data-testid="error">{error}</div>
  return (
    <ul data-testid="campaign-list">
      {campaigns.map((c) => (
        <li key={c.id} data-testid={`campaign-${c.id}`}>
          {c.name}
        </li>
      ))}
    </ul>
  )
}

describe('useCampaigns', () => {
  it('shows loading state initially', () => {
    render(<CampaignsDisplay />)
    expect(screen.getByTestId('loading')).toBeDefined()
  })

  it('loads campaigns and removes loading state', async () => {
    CampaignModel.create(SAMPLE_INPUT)
    render(<CampaignsDisplay />)
    await waitFor(() => {
      expect(screen.queryByTestId('loading')).toBeNull()
    })
    expect(screen.getByTestId('campaign-list')).toBeDefined()
  })

  it('renders campaign names from the store', async () => {
    CampaignModel.create(SAMPLE_INPUT)
    render(<CampaignsDisplay />)
    await waitFor(() => {
      expect(screen.queryByTestId('loading')).toBeNull()
    })
    expect(screen.getByText('Hook Test Campaign')).toBeDefined()
  })

  it('renders all campaigns from the store', async () => {
    CampaignModel.create(SAMPLE_INPUT)
    CampaignModel.create({ ...SAMPLE_INPUT, name: 'Second Campaign' })
    render(<CampaignsDisplay />)
    await waitFor(() => {
      expect(screen.queryByTestId('loading')).toBeNull()
    })
    expect(screen.getByText('Hook Test Campaign')).toBeDefined()
    expect(screen.getByText('Second Campaign')).toBeDefined()
  })
})

// ─── useCampaignStats ─────────────────────────────────────────────────────────

function StatsDisplay() {
  const { stats, loading } = useCampaignStats()
  if (loading) return <div data-testid="loading">Loading</div>
  if (!stats) return <div data-testid="no-stats">No stats</div>
  return (
    <div>
      <span data-testid="total">{stats.totalCampaigns}</span>
      <span data-testid="published">{stats.totalPostsPublished}</span>
      <span data-testid="rate">{stats.avgEngagementRate}</span>
    </div>
  )
}

describe('useCampaignStats', () => {
  it('shows loading initially', () => {
    render(<StatsDisplay />)
    expect(screen.getByTestId('loading')).toBeDefined()
  })

  it('loads stats after mount', async () => {
    CampaignModel.create(SAMPLE_INPUT)
    render(<StatsDisplay />)
    await waitFor(() => {
      expect(screen.queryByTestId('loading')).toBeNull()
    })
    expect(screen.getByTestId('total')).toBeDefined()
    expect(screen.getByTestId('total').textContent).toBe('1')
  })

  it('shows zero stats for empty store', async () => {
    render(<StatsDisplay />)
    await waitFor(() => {
      expect(screen.queryByTestId('loading')).toBeNull()
    })
    expect(screen.getByTestId('total').textContent).toBe('0')
    expect(screen.getByTestId('published').textContent).toBe('0')
  })
})
