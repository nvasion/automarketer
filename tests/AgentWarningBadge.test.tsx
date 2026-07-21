/**
 * Tests for the AgentWarningBadge component and its agent-auth-platform
 * helpers, plus the platforms that should surface it inside
 * PlatformConnectionModal (Reddit and X/Twitter use agent-based auth).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgentWarningBadge from '../src/components/AgentWarningBadge'
import PlatformConnectionModal from '../src/components/PlatformConnectionModal'
import { AGENT_AUTH_PLATFORMS, isAgentAuthPlatform } from '../src/utils/agentAuthPlatforms'
import type { PlatformConfig } from '../src/types'

vi.mock('../src/services/platformConfigService', () => ({
  fetchPlatformClientIds: vi.fn().mockResolvedValue({
    twitter: 'test-twitter-client-id',
    reddit: 'test-reddit-client-id',
    linkedin: 'test-linkedin-client-id',
  }),
}))

const REDDIT: PlatformConfig = {
  id: 'reddit',
  name: 'Reddit',
  icon: 'r/',
  color: '#ffffff',
  bgColor: '#FF4500',
  charLimit: 40000,
  description: 'Community discussions',
}

const TWITTER: PlatformConfig = {
  id: 'twitter',
  name: 'X (Twitter)',
  icon: '𝕏',
  color: '#ffffff',
  bgColor: '#000000',
  charLimit: 280,
  description: 'Fast-moving conversations',
}

const LINKEDIN: PlatformConfig = {
  id: 'linkedin',
  name: 'LinkedIn',
  icon: 'in',
  color: '#ffffff',
  bgColor: '#0077B5',
  charLimit: 3000,
  description: 'Professional network',
}

describe('AgentWarningBadge', () => {
  it('renders the warning icon and "Higher token usage" text', () => {
    render(<AgentWarningBadge />)
    expect(screen.getByText('⚠️')).toBeDefined()
    expect(screen.getByText('Higher token usage')).toBeDefined()
  })

  it('explains the extra token usage in the tooltip', () => {
    render(<AgentWarningBadge />)
    const badge = screen.getByText('Higher token usage').closest('span')
    expect(badge?.getAttribute('title')).toContain('Agent-based authentication')
    expect(badge?.getAttribute('title')).toContain('token')
  })

  it('renders at sm size without throwing', () => {
    expect(() => render(<AgentWarningBadge size="sm" />)).not.toThrow()
  })
})

describe('isAgentAuthPlatform / AGENT_AUTH_PLATFORMS', () => {
  it('flags reddit and twitter as agent-auth platforms', () => {
    expect(isAgentAuthPlatform('reddit')).toBe(true)
    expect(isAgentAuthPlatform('twitter')).toBe(true)
    expect(AGENT_AUTH_PLATFORMS.has('reddit')).toBe(true)
    expect(AGENT_AUTH_PLATFORMS.has('twitter')).toBe(true)
  })

  it('does not flag other platforms', () => {
    expect(isAgentAuthPlatform('linkedin')).toBe(false)
    expect(isAgentAuthPlatform('facebook')).toBe(false)
    expect(isAgentAuthPlatform('instagram')).toBe(false)
    expect(isAgentAuthPlatform('bluesky')).toBe(false)
  })
})

describe('AgentWarningBadge inside PlatformConnectionModal', () => {
  async function renderModal(platform: PlatformConfig) {
    render(<PlatformConnectionModal platform={platform} onClose={vi.fn()} onConnect={vi.fn()} />)
    // Flush the fetchPlatformClientIds() promise so the modal settles.
    await screen.findByText(`Connect ${platform.name}`)
  }

  it('shows the warning badge for Reddit', async () => {
    await renderModal(REDDIT)
    expect(screen.getByText('Higher token usage')).toBeDefined()
  })

  it('shows the warning badge for X/Twitter', async () => {
    await renderModal(TWITTER)
    expect(screen.getByText('Higher token usage')).toBeDefined()
  })

  it('does not show the warning badge for platforms with standard OAuth', async () => {
    await renderModal(LINKEDIN)
    expect(screen.queryByText('Higher token usage')).toBeNull()
  })
})
