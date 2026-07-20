import type { Platform } from '../../src/types'
import type { AgentCredentials, AgentAuthResponse, AgentWarning } from '../../src/types/agentAuth'

/**
 * Server-side types for agent-based authentication API.
 *
 * These types define the request/response contracts for agent auth endpoints.
 */

// ─── API Request Types ────────────────────────────────────────────────────────

/**
 * Request body for authenticating with agent credentials.
 */
export interface AgentAuthRequest {
  /** Platform to authenticate with. */
  platform: Platform
  /** Username or account identifier. */
  username: string
  /** Password, API token, or secret key. */
  password: string
  /** Optional flag to store credentials for future use. */
  remember?: boolean
}

/**
 * Request body for validating stored credentials.
 */
export interface ValidateAgentCredentialsRequest {
  /** Platform to validate credentials for. */
  platform: Platform
  /** Optional credential ID if validating specific stored credentials. */
  credentialId?: string
}

/**
 * Request body for revoking agent credentials.
 */
export interface RevokeAgentCredentialsRequest {
  /** Platform to revoke credentials for. */
  platform: Platform
}

/**
 * Request body for refreshing agent tokens.
 */
export interface RefreshAgentTokenRequest {
  /** Platform to refresh token for. */
  platform: Platform
  /** Current refresh token. */
  refreshToken: string
}

// ─── API Response Types ───────────────────────────────────────────────────────

/**
 * Standard API response wrapper for agent authentication operations.
 * Aligned with frontend AgentAuthResponse for consistency.
 */
export interface AgentAuthApiResponse {
  /** Whether the operation succeeded. */
  success: boolean
  /** Error message if operation failed. */
  error?: string
  /** Warnings about the operation. */
  warnings?: AgentWarning[]
}

/**
 * Response from agent authentication endpoint on success.
 * Aligned with frontend AgentAuthResponse structure - tokens at root level.
 */
export interface AgentAuthSuccessResponse extends AgentAuthApiResponse {
  success: true
  /** Authenticated platform. */
  platform: Platform
  /** Access token or session identifier. */
  accessToken: string
  /** Refresh token for renewing access, if applicable. */
  refreshToken?: string
  /** Token expiry timestamp (ISO 8601), if applicable. */
  expiresAt?: string
  /** Account information returned by the platform. */
  accountInfo?: {
    /** Display name or username. */
    displayName: string
    /** Account ID on the platform. */
    accountId: string
    /** Profile URL, if available. */
    profileUrl?: string
    /** Avatar URL, if available. */
    avatarUrl?: string
  }
}

/**
 * Response from agent authentication failure.
 */
export interface AgentAuthFailureResponse extends AgentAuthApiResponse {
  success: false
  /** Error code for programmatic handling. */
  errorCode?: string
  /** HTTP status code to return. */
  httpStatus: number
}

/**
 * Response containing stored credentials info (sanitized).
 */
export interface StoredCredentialsInfo {
  /** Platform these credentials are for. */
  platform: Platform
  /** Masked username (e.g. "joh***@example.com"). */
  maskedUsername: string
  /** When credentials were last verified (ISO 8601). */
  lastVerifiedAt?: string
  /** Whether credentials are currently valid. */
  isValid: boolean
  /** When credentials were created (ISO 8601). */
  createdAt: string
  /** When credentials were last updated (ISO 8601). */
  updatedAt: string
}

/**
 * Response listing all stored agent credentials.
 */
export interface ListAgentCredentialsResponse extends AgentAuthApiResponse {
  /** List of stored credentials (sanitized). */
  credentials: StoredCredentialsInfo[]
}

// ─── Database/Storage Types ───────────────────────────────────────────────────

/**
 * Database record for agent credentials.
 *
 * This is the persisted format - sensitive fields should be encrypted at rest.
 */
export interface AgentCredentialsRecord {
  /** Unique identifier for this credential record. */
  id: string
  /** User ID these credentials belong to. */
  userId: string
  /** Platform these credentials are for. */
  platform: Platform
  /** Encrypted username. */
  encryptedUsername: string
  /** Encrypted password/token. */
  encryptedPassword: string
  /** Encrypted refresh token, if applicable. */
  encryptedRefreshToken?: string
  /** IV for encryption, if using AES-GCM or similar. */
  encryptionIv: string
  /** Whether credentials are currently valid. */
  isValid: boolean
  /** When credentials were last verified (ISO 8601). */
  lastVerifiedAt?: string
  /** When credentials were created (ISO 8601). */
  createdAt: string
  /** When credentials were last updated (ISO 8601). */
  updatedAt: string
}

// ─── Service Layer Types ──────────────────────────────────────────────────────

/**
 * Result from agent authentication service.
 */
export interface AgentAuthServiceResult {
  /** Whether authentication succeeded. */
  success: boolean
  /** Platform that was authenticated. */
  platform: Platform
  /** Credentials object if successful. */
  credentials?: AgentCredentials
  /** Auth response data. */
  authResponse: AgentAuthResponse
  /** Error if authentication failed. */
  error?: {
    /** Error code. */
    code: string
    /** Error message. */
    message: string
    /** HTTP status code. */
    httpStatus: number
  }
}

/**
 * Configuration for platform-specific agent behavior.
 */
export interface PlatformAgentServerConfig {
  /** Platform identifier. */
  platform: Platform
  /** API endpoint for authentication. */
  authEndpoint?: string
  /** API endpoint for token refresh. */
  refreshEndpoint?: string
  /** Required headers for API requests. */
  requiredHeaders?: Record<string, string>
  /** Whether to use DPoP (Demonstrating Proof of Possession). */
  useDpop?: boolean
  /** Token cost multiplier for rate limiting. */
  tokenCostMultiplier: number
  /** Daily post limit. */
  dailyPostLimit: number
}