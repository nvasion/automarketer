/**
 * Tests for the LinkedIn identity picker inside CampaignDetail.
 *
 * When a campaign targets LinkedIn, the detail page shows a contextual
 * "Posting as" banner so users can see and change which LinkedIn
 * profile/page posts will be published under — without leaving the page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import type { PublicUser } from '../src/services/authService'

// ── Module mocks ──────────────────────────────────────────────────────────────

// useCampaign is mocked so we can inject arbitrary campaign data without a server.
vi.mock('../src/hooks/useCampaign', () => ({
  useCampaign: vi.fn(),
}))

// linkedinService is mocked to control the pages returned and verify localStorage writes.
vi.mock('../src/services/linkedinService', () => ({
  fetchLinkedInPages: vi.fn(),
  loadSelectedLinkedInPage: vi.fn(() => null),
  saveSelectedLinkedInPage: vi.fn(),
  resolveLinkedInAuthorUrn: vi.fn(() => 'urn:li:person:abc123'),
}))

// platformConfigService is mocked to avoid a real /api/platform-config fetch.
vi.mock('../src/services/platformConfigService', () => ({
  fetchPlatformClientIds: vi.fn(async () => ({ linkedin: 'fake-client-id' })),
  fetchConnectedPlatforms: vi.fn(async () => ({ linkedin: true })),
  disconnectPlatform: vi.fn(async () => undefined),
}))

// publishService is mocked to avoid real publish calls in button tests.
vi.mock('../src/services/publishService', () => ({
  publishService: {
    publish: vi.fn(async () => ({ success: true, platform: 'linkedin', timestamp: new Date().toISOString() })),
  },
  PublishError: class PublishError extends Error {
    constructor(msg: string, public code?: string, public httpStatus?: number) { super(msg) }
  },
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import CampaignDetail from '../src/pages/CampaignDetail'
import { useCampaign } from '../src/hooks/useCampaign'
import {
  fetchLinkedInPages,
  saveSelectedLinkedInPage,
} from '../src/services/linkedinService'
import type { CampaignRecord } from '../src/db/schema'
import type { LinkedInPage } from '../src/services/linkedinService'

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockUser: PublicUser = {
  id: 'user-1',
  email: 'test@example.com',
  createdAt: new Date().toISOString(),
}

const authValue = {
  user: mockUser,
  loading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}

function makeCampaign(platforms: string[]): CampaignRecord {
  return {
    id: 'camp-1',
    name: 'Test Campaign',
    websiteUrl: 'https://example.com',
    description: 'Test',
    status: 'ready',
    tone: 'professional',
    targetAudience: 'developers',
    platforms: platforms as CampaignRecord['platforms'],
    screenshots: [],
    posts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

const PERSONAL_PAGE: LinkedInPage = {
  urn: 'urn:li:person:abc123',
  name: 'Alice Smith',
  type: 'person',
}

const ORG_PAGE: LinkedInPage = {
  urn: 'urn:li:organization:99001',
  name: 'Acme Corp',
  type: 'organization',
}

function renderCampaignDetail() {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/campaigns/camp-1']}>
        <Routes>
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
  vi.mocked(useCampaign).mockReturnValue({
    campaign: makeCampaign(['linkedin']),
    loading: false,
    error: null,
    update: vi.fn(async () => makeCampaign(['linkedin'])),
  })
  vi.mocked(fetchLinkedInPages).mockResolvedValue([PERSONAL_PAGE])
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CampaignDetail — LinkedIn identity banner', () => {
  it('does not show the banner for a campaign without LinkedIn', async () => {
    vi.mocked(useCampaign).mockReturnValue({
      campaign: makeCampaign(['twitter']),
      loading: false,
      error: null,
      update: vi.fn(async () => makeCampaign(['twitter'])),
    })
    renderCampaignDetail()
    // fetchLinkedInPages must not have been called
    expect(fetchLinkedInPages).not.toHaveBeenCalled()
    // Banner must not be in the DOM
    expect(screen.queryByTestId('linkedin-identity-banner')).toBeNull()
  })

  it('shows the banner when the campaign targets LinkedIn', async () => {
    renderCampaignDetail()
    await waitFor(() => {
      expect(screen.getByTestId('linkedin-identity-banner')).toBeTruthy()
    })
  })

  it('calls fetchLinkedInPages once when the campaign has LinkedIn', async () => {
    renderCampaignDetail()
    await waitFor(() => {
      expect(fetchLinkedInPages).toHaveBeenCalledTimes(1)
    })
  })

  it('displays identity as plain text when there is only one page', async () => {
    // Default mock already returns a single personal page
    renderCampaignDetail()
    await waitFor(() => {
      expect(screen.getByTestId('linkedin-identity-banner')).toBeTruthy()
    })
    // No dropdown should be present
    expect(screen.queryByTestId('linkedin-identity-select')).toBeNull()
    // The name should appear as text
    expect(screen.getByText(/Alice Smith/)).toBeTruthy()
  })

  it('renders a dropdown when the user has multiple pages', async () => {
    vi.mocked(fetchLinkedInPages).mockResolvedValue([PERSONAL_PAGE, ORG_PAGE])
    renderCampaignDetail()
    await waitFor(() => {
      expect(screen.getByTestId('linkedin-identity-select')).toBeTruthy()
    })
  })

  it('dropdown lists all available pages', async () => {
    vi.mocked(fetchLinkedInPages).mockResolvedValue([PERSONAL_PAGE, ORG_PAGE])
    renderCampaignDetail()
    await waitFor(() => {
      expect(screen.getByTestId('linkedin-identity-select')).toBeTruthy()
    })
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    const values = options.map((o) => o.value)
    expect(values).toContain(PERSONAL_PAGE.urn)
    expect(values).toContain(ORG_PAGE.urn)
  })

  it('persists the selection to localStorage when the user picks a page', async () => {
    vi.mocked(fetchLinkedInPages).mockResolvedValue([PERSONAL_PAGE, ORG_PAGE])
    renderCampaignDetail()
    await waitFor(() => {
      expect(screen.getByTestId('linkedin-identity-select')).toBeTruthy()
    })

    const select = screen.getByTestId('linkedin-identity-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: ORG_PAGE.urn } })

    expect(saveSelectedLinkedInPage).toHaveBeenCalledWith(
      mockUser.id,
      ORG_PAGE,
    )
  })

  it('does not show the banner while pages are still loading', () => {
    // Never resolve the fetch — pages stay loading
    vi.mocked(fetchLinkedInPages).mockReturnValue(new Promise(() => {}))
    renderCampaignDetail()
    expect(screen.queryByTestId('linkedin-identity-banner')).toBeNull()
  })

  it('hides the banner if fetchLinkedInPages fails', async () => {
    vi.mocked(fetchLinkedInPages).mockRejectedValue(new Error('network error'))
    renderCampaignDetail()
    // Wait a tick for the promise rejection to settle
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('linkedin-identity-banner')).toBeNull()
  })
})
