import type { Platform } from '../types'

/**
 * Types for agent-based platform authentication.
 *
 * These types support credential-based authentication flows where users
 * provide username/password or API tokens directly instead of OAuth.
 */

// ─── Credentials ──────────────────────────────────────────────────────────────

/**
 * Credentials for agent-based platform authentication.
 *
 * Used when OAuth is not available or when users prefer direct credential
 * authentication for certain platforms.
 */
export interface AgentCredentials {
  /** Platform these credentials are for. */
  platform: Platform
  /** Username or account identifier. */
  username: string
  /** Password, API token, or secret key. */
  password: string
  /** Optional refresh token for token-based auth. */
  refreshToken?: string
  /** Timestamp when credentials were last verified (ISO 8601). */
  lastVerifiedAt?: string
  /** Whether credentials are currently valid. */
  isValid: boolean
}

// ─── Authentication Response ──────────────────────────────────────────────────

/**
 * Response from agent authentication attempt.
 */
export interface AgentAuthResponse {
  /** Whether authentication succeeded. */
  success: boolean
  /** Platform that was authenticated. */
  platform: Platform
  /** Access token or session identifier, if authenticated. */
  accessToken?: string
  /** Refresh token for renewing access, if applicable. */
  refreshToken?: string
  /** Token expiry timestamp (ISO 8601), if applicable. */
  expiresAt?: string
  /** Error message if authentication failed. */
  error?: string
  /** Warnings about the authentication state. */
  warnings?: AgentWarning[]
}

// ─── Platform Configuration ───────────────────────────────────────────────────

/**
 * Configuration for a platform agent.
 *
 * Includes metadata about token costs and capabilities for the posting queue.
 */
export interface PlatformAgentConfig {
  /** Platform identifier. */
  platform: Platform
  /** Display name for the platform. */
  displayName: string
  /** Whether the platform supports agent-based auth. */
  supportsAgentAuth: boolean
  /** Whether OAuth is also supported (hybrid platforms). */
  supportsOAuth: boolean
  /**
   * Token cost multiplier for rate limiting.
   * Higher values mean each post consumes more of the rate limit budget.
   * Useful for platforms with stricter limits or higher "cost" posts.
   */
  tokenCostMultiplier: number
  /** Maximum posts per day for this platform. */
  dailyPostLimit: number
  /** Required fields for agent authentication. */
  requiredAuthFields: ('username' | 'password' | 'apiKey' | 'apiSecret')[]
}

// ─── Warnings ─────────────────────────────────────────────────────────────────

/**
 * Severity level for agent warnings.
 */
export type AgentWarningLevel = 'info' | 'warning' | 'error'

/**
 * Warning message for UI display related to agent authentication.
 */
export interface AgentWarning {
  /** Severity level. */
  level: AgentWarningLevel
  /** Machine-readable warning code. */
  code: string
  /** Human-readable message for display. */
  message: string
  /** Optional field name this warning relates to. */
  field?: string
  /** Suggested action to resolve the warning. */
  suggestion?: string
}

// ─── UI State ─────────────────────────────────────────────────────────────────

/**
 * State for agent authentication form.
 */
export interface AgentAuthFormState {
  /** Selected platform. */
  platform: Platform | null
  /** Username input value. */
  username: string
  /** Password/token input value. */
  password: string
  /** Whether credentials are being validated. */
  isLoading: boolean
  /** Current error message, if any. */
  error: string | null
  /** Current warnings, if any. */
  warnings: AgentWarning[]
  /** Whether authentication succeeded. */
  isAuthenticated: boolean
}