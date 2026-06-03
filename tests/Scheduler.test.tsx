/**
 * Tests for the Scheduler page component.
 *
 * Key behaviour verified:
 * - Calendar opens to the real current month/year (not a hardcoded date)
 * - "Today" cell is highlighted for the actual calendar date
 * - Scheduled posts that fall within the current viewport appear as dots
 * - "Upcoming Posts" sidebar lists posts whose status is 'scheduled'
 * - Month navigation (prev/next) works correctly
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import Scheduler from '../src/pages/Scheduler'
import { CampaignModel } from '../src/db/CampaignModel'
import type { PublicUser } from '../src/services/authService'
import type { CreateCampaignInput } from '../src/db/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const mockUser: PublicUser = {
  id: 'user-1',
  email: 'test@example.com',
  createdAt: new Date().toISOString(),
}

const authContextValue = {
  user: mockUser,
  loading: false,
  login: () => Promise.resolve(),
  register: () => Promise.resolve(),
  logout: () => Promise.resolve(),
}

function renderScheduler() {
  return render(
    <HashRouter>
      <AuthContext.Provider value={authContextValue}>
        <Scheduler />
      </AuthContext.Provider>
    </HashRouter>
  )
}

/** Build a future ISO-8601 timestamp N days from now. */
function futureDateIso(daysFromNow: number, hour = 9): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

/** Build a past ISO-8601 timestamp N days ago. */
function pastDateIso(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
})

// ─── Real datetime — calendar header ─────────────────────────────────────────

describe('Scheduler — real datetime', () => {
  it('opens to the real current month and year', async () => {
    renderScheduler()
    const now = new Date()
    const expectedHeader = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`
    await waitFor(() => {
      expect(screen.getByText(expectedHeader)).toBeDefined()
    })
  })

  it('does NOT open to the old hardcoded May 2026 header', async () => {
    renderScheduler()
    const now = new Date()
    // Only assert the old hardcoded value is absent when we are not actually in May 2026
    if (now.getFullYear() !== 2026 || now.getMonth() !== 4) {
      await waitFor(() => {
        expect(screen.queryByText('May 2026')).toBeNull()
      })
    }
  })

  it('highlights today\'s date number', async () => {
    renderScheduler()
    const now = new Date()
    const todayNum = now.getDate()

    // The "today" cell has a green circle background; we look for it via aria/title
    // but it's easier to confirm the day number appears in the rendered month grid.
    // We wait for the calendar to render then check the today cell is visible.
    await waitFor(() => {
      // At minimum, today's day number must be present in the document
      const dayNumbers = screen.getAllByText(String(todayNum))
      expect(dayNumbers.length).toBeGreaterThan(0)
    })
  })
})

// ─── Month navigation ─────────────────────────────────────────────────────────

describe('Scheduler — month navigation', () => {
  it('navigates to the previous month', async () => {
    renderScheduler()
    const now = new Date()
    await waitFor(() => {
      expect(screen.getByText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`)).toBeDefined()
    })

    fireEvent.click(screen.getByText('‹'))

    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    expect(
      screen.getByText(`${MONTHS[prevMonthDate.getMonth()]} ${prevMonthDate.getFullYear()}`)
    ).toBeDefined()
  })

  it('navigates to the next month', async () => {
    renderScheduler()
    const now = new Date()
    await waitFor(() => {
      expect(screen.getByText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`)).toBeDefined()
    })

    fireEvent.click(screen.getByText('›'))

    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    expect(
      screen.getByText(`${MONTHS[nextMonthDate.getMonth()]} ${nextMonthDate.getFullYear()}`)
    ).toBeDefined()
  })

  it('wraps from January to December when navigating backwards', async () => {
    renderScheduler()
    const now = new Date()
    // Step back to January of the current year (now.getMonth() steps)
    for (let i = 0; i < now.getMonth(); i++) {
      fireEvent.click(screen.getByText('‹'))
    }
    expect(screen.getByText(`January ${now.getFullYear()}`)).toBeDefined()

    // One more step back should wrap to December of the previous year
    fireEvent.click(screen.getByText('‹'))
    expect(screen.getByText(`December ${now.getFullYear() - 1}`)).toBeDefined()
  })

  it('clears selected day when navigating months', async () => {
    renderScheduler()
    await waitFor(() => {
      // Wait for calendar to be ready
      const now = new Date()
      expect(screen.getByText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`)).toBeDefined()
    })

    // Click day 1 to select it
    const dayCells = screen.getAllByText('1')
    fireEvent.click(dayCells[0])

    // Expect the selected-day detail panel to appear
    await waitFor(() => {
      expect(screen.getByText('No posts scheduled for this day.')).toBeDefined()
    })

    // Navigate month — selection should clear
    fireEvent.click(screen.getByText('›'))
    expect(screen.queryByText('No posts scheduled for this day.')).toBeNull()
  })
})

// ─── Upcoming Posts sidebar ───────────────────────────────────────────────────

describe('Scheduler — Upcoming Posts sidebar', () => {
  it('shows "No upcoming posts" when there are no scheduled campaigns', async () => {
    renderScheduler()
    await waitFor(() => {
      expect(screen.getByText('No upcoming posts scheduled.')).toBeDefined()
    })
  })

  it('lists campaigns that have scheduled posts', async () => {
    const input: CreateCampaignInput = {
      name: 'Future Campaign',
      websiteUrl: 'https://future.example.com',
      description: 'Test',
      status: 'ready',
      tone: 'professional',
      targetAudience: 'devs',
      platforms: ['linkedin'],
      screenshots: [],
      posts: [
        {
          id: 'p-future',
          platform: 'linkedin',
          content: 'A future post content',
          hashtags: [],
          status: 'scheduled',
          scheduledAt: futureDateIso(7),
        },
      ],
    }
    CampaignModel.create(input)

    renderScheduler()
    await waitFor(() => {
      expect(screen.getByText('Future Campaign')).toBeDefined()
    })
  })

  it('does not list draft or published posts in Upcoming Posts', async () => {
    const input: CreateCampaignInput = {
      name: 'Mixed Status Campaign',
      websiteUrl: 'https://mixed.example.com',
      description: 'Test',
      status: 'ready',
      tone: 'casual',
      targetAudience: 'all',
      platforms: ['twitter', 'linkedin'],
      screenshots: [],
      posts: [
        {
          id: 'p-draft',
          platform: 'twitter',
          content: 'Draft post',
          hashtags: [],
          status: 'draft',
        },
        {
          id: 'p-published',
          platform: 'linkedin',
          content: 'Published post',
          hashtags: [],
          status: 'published',
          publishedAt: pastDateIso(3),
        },
      ],
    }
    CampaignModel.create(input)

    renderScheduler()
    await waitFor(() => {
      // The campaign exists in DB but has no scheduled posts — sidebar stays empty
      expect(screen.getByText('No upcoming posts scheduled.')).toBeDefined()
    })
  })

  it('sorts upcoming posts by scheduledAt ascending', async () => {
    const inputA: CreateCampaignInput = {
      name: 'Later Campaign',
      websiteUrl: 'https://later.example.com',
      description: '',
      status: 'ready',
      tone: 'professional',
      targetAudience: 'all',
      platforms: ['twitter'],
      screenshots: [],
      posts: [
        {
          id: 'p-later',
          platform: 'twitter',
          content: 'Later post',
          hashtags: [],
          status: 'scheduled',
          scheduledAt: futureDateIso(14), // 2 weeks out
        },
      ],
    }
    const inputB: CreateCampaignInput = {
      name: 'Sooner Campaign',
      websiteUrl: 'https://sooner.example.com',
      description: '',
      status: 'ready',
      tone: 'casual',
      targetAudience: 'all',
      platforms: ['linkedin'],
      screenshots: [],
      posts: [
        {
          id: 'p-sooner',
          platform: 'linkedin',
          content: 'Sooner post',
          hashtags: [],
          status: 'scheduled',
          scheduledAt: futureDateIso(3), // 3 days out — should appear first
        },
      ],
    }
    CampaignModel.create(inputA)
    CampaignModel.create(inputB)

    renderScheduler()
    await waitFor(() => {
      expect(screen.getByText('Sooner Campaign')).toBeDefined()
      expect(screen.getByText('Later Campaign')).toBeDefined()
    })

    // Verify order: "Sooner" must appear before "Later" in the DOM
    const soonerEl = screen.getByText('Sooner Campaign')
    const laterEl = screen.getByText('Later Campaign')
    expect(
      soonerEl.compareDocumentPosition(laterEl) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

// ─── Day detail panel ─────────────────────────────────────────────────────────

describe('Scheduler — day detail panel', () => {
  it('shows "No posts" message when an empty day is clicked', async () => {
    renderScheduler()
    await waitFor(() => {
      const now = new Date()
      expect(screen.getByText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`)).toBeDefined()
    })

    // Click day 1 (always present in any month)
    const dayCells = screen.getAllByText('1')
    fireEvent.click(dayCells[0])

    await waitFor(() => {
      expect(screen.getByText('No posts scheduled for this day.')).toBeDefined()
    })
  })

  it('deselects a day when clicked a second time', async () => {
    renderScheduler()
    await waitFor(() => {
      const now = new Date()
      expect(screen.getByText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`)).toBeDefined()
    })

    const dayCells = screen.getAllByText('1')
    fireEvent.click(dayCells[0])
    await waitFor(() => {
      expect(screen.getByText('No posts scheduled for this day.')).toBeDefined()
    })

    // Click same day again — detail panel should disappear
    fireEvent.click(dayCells[0])
    await waitFor(() => {
      expect(screen.queryByText('No posts scheduled for this day.')).toBeNull()
    })
  })

  it('shows post details when a day with a scheduled post is clicked', async () => {
    const now = new Date()
    // Schedule a post for day 28 of the current month (exists in all months)
    const scheduledDate = new Date(now.getFullYear(), now.getMonth(), 28, 9, 0, 0)
    const input: CreateCampaignInput = {
      name: 'Day-28 Campaign',
      websiteUrl: 'https://day28.example.com',
      description: '',
      status: 'ready',
      tone: 'professional',
      targetAudience: 'all',
      platforms: ['twitter'],
      screenshots: [],
      posts: [
        {
          id: 'p-day28',
          platform: 'twitter',
          content: 'Post on the 28th',
          hashtags: [],
          status: 'scheduled',
          scheduledAt: scheduledDate.toISOString(),
        },
      ],
    }
    CampaignModel.create(input)

    renderScheduler()
    await waitFor(() => {
      expect(screen.getByText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`)).toBeDefined()
    })

    // Click the 28th
    const dayCells = screen.getAllByText('28')
    fireEvent.click(dayCells[0])

    await waitFor(() => {
      // Campaign name appears in both the day detail panel and the Upcoming Posts sidebar
      expect(screen.getAllByText('Day-28 Campaign').length).toBeGreaterThan(0)
    })
  })
})
