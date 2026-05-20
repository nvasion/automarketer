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

    // "Post Published" starts ON — its toggle thumb should be at left:23px
    const toggles = screen.getAllByText('Post Published')
    expect(toggles.length).toBeGreaterThan(0)

    // Find the toggle switch for "Post Published" via its parent row
    const row = screen.getByText('Post Published').closest('div[style]')!
    const thumb = row.parentElement!.querySelector('div > div > div') as HTMLElement

    // Initial left position should reflect "on" (23px)
    expect(thumb.style.left).toBe('23px')

    // Click the toggle track to switch it off
    const track = thumb.parentElement as HTMLElement
    fireEvent.click(track)

    // After toggle, thumb should be at 3px (off position)
    expect(thumb.style.left).toBe('3px')

    // Toggle back on
    fireEvent.click(track)
    expect(thumb.style.left).toBe('23px')
  })

  it('Weekly Digest starts toggled off', () => {
    renderSettings()
    navigateToNotifications()

    const label = screen.getByText('Weekly Digest')
    const row = label.closest('div')!
    // Walk up to the flex row that contains both label and toggle
    const flexRow = row.parentElement as HTMLElement
    const thumb = flexRow.querySelector('div[style*="border-radius: 50%"]') as HTMLElement

    expect(thumb.style.left).toBe('3px')
  })

  it('toggling a notification does not affect unrelated notification state', () => {
    renderSettings()
    navigateToNotifications()

    // Toggle "Post Published" off
    const postLabel = screen.getByText('Post Published')
    const postFlexRow = postLabel.closest('div')!.parentElement as HTMLElement
    const postTrack = postFlexRow.querySelector('div[style*="border-radius: 12px"]') as HTMLElement
    fireEvent.click(postTrack)

    // "Platform Errors" should still be on (left: 23px)
    const errLabel = screen.getByText('Platform Errors')
    const errFlexRow = errLabel.closest('div')!.parentElement as HTMLElement
    const errThumb = errFlexRow.querySelector('div[style*="border-radius: 50%"]') as HTMLElement
    expect(errThumb.style.left).toBe('23px')
  })

  it('Save Changes button is visible on the Notifications tab', () => {
    renderSettings()
    navigateToNotifications()
    expect(screen.getByText('Save Changes')).toBeDefined()
  })
})
