/**
 * Editing a post from the campaign detail page persists the new text and
 * hashtags through the campaign update, leaving the other posts untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import type { PublicUser } from '../src/services/authService'

vi.mock('../src/hooks/useCampaign', () => ({
  useCampaign: vi.fn(),
}))

vi.mock('../src/services/platformConfigService', () => ({
  fetchPlatformClientIds: vi.fn(async () => ({})),
  fetchConnectedPlatforms: vi.fn(async () => ({})),
  disconnectPlatform: vi.fn(async () => undefined),
}))

import CampaignDetail from '../src/pages/CampaignDetail'
import { useCampaign } from '../src/hooks/useCampaign'
import type { CampaignRecord, UpdateCampaignInput } from '../src/db/schema'

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

function makeCampaign(): CampaignRecord {
  return {
    id: 'camp-1',
    name: 'Northwind Launch',
    websiteUrl: 'https://northwind.example',
    description: 'Launch week',
    status: 'ready',
    tone: 'professional',
    targetAudience: 'ops teams',
    platforms: ['twitter', 'bluesky'],
    screenshots: [],
    posts: [
      { id: 'p-tw', platform: 'twitter', content: 'Old tweet', hashtags: ['#old'], status: 'draft' },
      { id: 'p-bs', platform: 'bluesky', content: 'Bluesky post', hashtags: [], status: 'draft' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function renderPage() {
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

let update: ReturnType<typeof vi.fn<(patch: UpdateCampaignInput) => Promise<CampaignRecord>>>

beforeEach(() => {
  update = vi.fn(async () => makeCampaign())
  vi.mocked(useCampaign).mockReturnValue({
    campaign: makeCampaign(),
    loading: false,
    error: null,
    update,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CampaignDetail — edit a post', () => {
  it('saves the edited post through the campaign update', async () => {
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'New tweet' } })
    fireEvent.change(screen.getByLabelText('Hashtags'), { target: { value: '#new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const posts = update.mock.calls[0][0].posts ?? []
    expect(posts.find((p) => p.id === 'p-tw')).toMatchObject({ content: 'New tweet', hashtags: ['#new'] })
    expect(posts.find((p) => p.id === 'p-bs')).toMatchObject({ content: 'Bluesky post' })
    expect(await screen.findByText('New tweet')).toBeInTheDocument()
  })

  it('reverts the text and shows the error when the save fails', async () => {
    update.mockRejectedValueOnce(new Error('Server said no'))
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'New tweet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Server said no/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Old tweet')).toBeInTheDocument()
  })
})
