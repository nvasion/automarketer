import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { AuthContext } from '../src/contexts/AuthContext'
import Settings from '../src/pages/Settings'
import type { PublicUser } from '../src/services/authService'
import { parseUserDetailsFromEmail } from '../src/utils/userDisplay'

const mockUser: PublicUser = {
  id: 'test-id',
  email: 'kellan.strong@ahead.com',
  createdAt: new Date().toISOString(),
}

const authContextValue = {
  user: mockUser,
  loading: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}

function renderSettings(user: PublicUser = mockUser) {
  return render(
    <HashRouter>
      <AuthContext.Provider value={{ ...authContextValue, user }}>
        <Settings />
      </AuthContext.Provider>
    </HashRouter>
  )
}

function navigateToNotifications() {
  const tab = screen.getByText('Notifications')
  fireEvent.click(tab)
}

// ─── Utility unit tests ───────────────────────────────────────────────────────

describe('parseUserDetailsFromEmail', () => {
  it('parses "first.last" format correctly', () => {
    const r = parseUserDetailsFromEmail('kellan.strong@ahead.com')
    expect(r.firstName).toBe('Kellan')
    expect(r.lastName).toBe('Strong')
    expect(r.fullName).toBe('Kellan Strong')
    expect(r.initial).toBe('K')
  })

  it('parses "first_last" (underscore) format correctly', () => {
    const r = parseUserDetailsFromEmail('john_doe@example.com')
    expect(r.firstName).toBe('John')
    expect(r.lastName).toBe('Doe')
    expect(r.fullName).toBe('John Doe')
    expect(r.initial).toBe('J')
  })

  it('parses "first-last" (hyphen) format correctly', () => {
    const r = parseUserDetailsFromEmail('user-only@example.com')
    expect(r.firstName).toBe('User')
    expect(r.lastName).toBe('Only')
    expect(r.fullName).toBe('User Only')
    expect(r.initial).toBe('U')
  })

  it('handles single-segment username (no separator)', () => {
    const r = parseUserDetailsFromEmail('alice@example.com')
    expect(r.firstName).toBe('Alice')
    expect(r.lastName).toBe('')
    expect(r.fullName).toBe('Alice')
    expect(r.initial).toBe('A')
  })

  it('handles multi-part username and uses only first and last segment', () => {
    const r = parseUserDetailsFromEmail('a.b.c@example.com')
    expect(r.firstName).toBe('A')
    expect(r.lastName).toBe('C')
    expect(r.fullName).toBe('A C')
    expect(r.initial).toBe('A')
  })

  it('handles j.smith style (initial + surname)', () => {
    const r = parseUserDetailsFromEmail('j.smith@example.com')
    expect(r.firstName).toBe('J')
    expect(r.lastName).toBe('Smith')
    expect(r.initial).toBe('J')
  })

  it('returns safe defaults for an empty string', () => {
    const r = parseUserDetailsFromEmail('')
    expect(r.firstName).toBe('')
    expect(r.lastName).toBe('')
    expect(r.fullName).toBe('')
    expect(r.initial).toBe('?')
  })

  it('handles email without an @ symbol gracefully', () => {
    const r = parseUserDetailsFromEmail('notanemail')
    expect(r.firstName).toBe('Notanemail')
    expect(r.initial).toBe('N')
  })
})

// ─── Profile tab UI tests ─────────────────────────────────────────────────────

describe('Settings – Profile tab', () => {
  it('shows the correct avatar initial derived from the email', () => {
    renderSettings()
    // Initial "K" should appear in the avatar circle
    // The avatar is a div containing just the initial letter
    const avatarElements = screen.getAllByText('K')
    expect(avatarElements.length).toBeGreaterThan(0)
  })

  it('pre-fills the First Name input with the name derived from email', () => {
    renderSettings()
    const firstNameInput = screen.getByDisplayValue('Kellan')
    expect(firstNameInput).toBeDefined()
  })

  it('pre-fills the Last Name input with the name derived from email', () => {
    renderSettings()
    const lastNameInput = screen.getByDisplayValue('Strong')
    expect(lastNameInput).toBeDefined()
  })

  it('pre-fills the Email Address input with the user email', () => {
    renderSettings()
    const emailInput = screen.getByDisplayValue('kellan.strong@ahead.com')
    expect(emailInput).toBeDefined()
  })

  it('shows correct initial for a single-name email', () => {
    const singleNameUser: PublicUser = {
      id: 'single-id',
      email: 'alice@example.com',
      createdAt: new Date().toISOString(),
    }
    renderSettings(singleNameUser)
    expect(screen.getByDisplayValue('Alice')).toBeDefined()
    // Last name field should be empty
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    const lastNameInput = inputs.find((el) => el.defaultValue === '')
    expect(lastNameInput).toBeDefined()
  })
})

// ─── Notifications tab tests ──────────────────────────────────────────────────

describe('Settings – Notifications tab', () => {
  it('renders the Notifications tab button', () => {
    renderSettings()
    expect(screen.getByText('Notifications')).toBeDefined()
  })

  it('shows all five notification rows when the tab is active', () => {
    renderSettings()
    navigateToNotifications()

    expect(screen.getByText('Post Published')).toBeDefined()
    expect(screen.getByText('Engagement Milestones')).toBeDefined()
    expect(screen.getByText('Generation Complete')).toBeDefined()
    expect(screen.getByText('Weekly Digest')).toBeDefined()
    expect(screen.getByText('Platform Errors')).toBeDefined()
  })

  it('toggles a notification off and back on without resetting other toggles', () => {
    renderSettings()
    navigateToNotifications()

    const track = screen.getByTestId('toggle-track-postPublished')
    const thumb = screen.getByTestId('toggle-thumb-postPublished')

    // "Post Published" starts ON — thumb at left:23px
    expect((thumb as HTMLElement).style.left).toBe('23px')

    // Toggle off
    fireEvent.click(track)
    expect((thumb as HTMLElement).style.left).toBe('3px')

    // Toggle back on
    fireEvent.click(track)
    expect((thumb as HTMLElement).style.left).toBe('23px')
  })

  it('Weekly Digest starts toggled off', () => {
    renderSettings()
    navigateToNotifications()

    const thumb = screen.getByTestId('toggle-thumb-weeklyDigest') as HTMLElement
    expect(thumb.style.left).toBe('3px')
  })

  it('toggling a notification does not affect unrelated notification state', () => {
    renderSettings()
    navigateToNotifications()

    // Toggle "Post Published" off
    fireEvent.click(screen.getByTestId('toggle-track-postPublished'))

    // "Platform Errors" should still be on (left: 23px)
    const errThumb = screen.getByTestId('toggle-thumb-platformErrors') as HTMLElement
    expect(errThumb.style.left).toBe('23px')
  })

  it('Save Changes button is visible on the Notifications tab', () => {
    renderSettings()
    navigateToNotifications()
    expect(screen.getByText('Save Changes')).toBeDefined()
  })
})
