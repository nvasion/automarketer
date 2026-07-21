import type { Platform } from '../types'

/**
 * Platforms whose connection relies on agent-based authentication (an AI
 * agent driving the platform's own login/automation flow) rather than a
 * standard OAuth 2.0 grant. Agent-based auth makes additional API calls on
 * the user's behalf, which consumes more tokens than direct authentication.
 */
export const AGENT_AUTH_PLATFORMS: ReadonlySet<Platform> = new Set(['reddit', 'twitter'])

/** True when `platformId` uses agent-based authentication (Reddit, X/Twitter). */
export function isAgentAuthPlatform(platformId: Platform): boolean {
  return AGENT_AUTH_PLATFORMS.has(platformId)
}
