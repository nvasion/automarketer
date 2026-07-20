/**
 * Tests for the AgentWarningBadge component.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgentWarningBadge from '../../src/components/AgentWarningBadge'

describe('AgentWarningBadge', () => {
  it('renders the warning icon and text', () => {
    render(<AgentWarningBadge />)
    expect(screen.getByText('⚠️')).toBeDefined()
    expect(screen.getByText('Higher token usage')).toBeDefined()
  })

  it('displays a tooltip with explanation on hover', () => {
    render(<AgentWarningBadge />)
    const badge = screen.getByText('Higher token usage').closest('span')
    expect(badge?.getAttribute('title')).toContain('Agent-based authentication')
    expect(badge?.getAttribute('title')).toContain('token')
  })

  it('applies default md size styles', () => {
    const { container } = render(<AgentWarningBadge />)
    const badge = container.firstChild as HTMLElement
    const styles = window.getComputedStyle(badge)
    
    expect(badge).toBeDefined()
    // Check that it has the warning background color
    expect(styles.backgroundColor).toMatch(/fef3c7|rgb\(254, 243, 199\)/i)
    expect(styles.color).toMatch(/92400e|rgb\(146, 64, 14\)/i)
  })

  it('applies sm size when specified', () => {
    const { container } = render(<AgentWarningBadge size="sm" />)
    const badge = container.firstChild as HTMLElement
    
    expect(badge).toBeDefined()
    // Sm size should have smaller font and padding
    const styles = window.getComputedStyle(badge)
    expect(styles.fontSize).toMatch(/10px|10\.5px/)
  })

  it('has help cursor for tooltip indication', () => {
    const { container } = render(<AgentWarningBadge />)
    const badge = container.firstChild as HTMLElement
    const styles = window.getComputedStyle(badge)
    
    expect(styles.cursor).toBe('help')
  })

  it('renders without crashing when no props provided', () => {
    expect(() => render(<AgentWarningBadge />)).not.toThrow()
  })
})