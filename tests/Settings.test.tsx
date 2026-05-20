import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import Settings from '../src/pages/Settings'

function renderSettings() {
  return render(
    <HashRouter>
      <Settings />
    </HashRouter>
  )
}

function navigateToNotifications() {
  const tab = screen.getByText('Notifications')
  fireEvent.click(tab)
}

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
