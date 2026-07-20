/**
 * Platform types supported by agent-based authentication.
 */
export type PlatformType = 'reddit' | 'x';

/**
 * Agent credentials structure for storing platform access.
 * Used when connecting to a platform via agent authentication.
 */
export interface AgentCredentials {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Response type for agent connection status.
 */
export interface AgentConnectionStatus {
  connected: boolean;
  platform: PlatformType;
  lastValidated?: string;
  valid?: boolean;
  error?: string;
  message?: string;
}

/**
 * Request body for connecting to a platform.
 */
export interface ConnectRequest {
  platform: PlatformType;
  credentials: AgentCredentials;
}

/**
 * Response body for connection operations.
 */
export interface ConnectResponse {
  success: boolean;
  message: string;
}

/**
 * Response body for validation operations.
 */
export interface ValidateResponse {
  valid: boolean;
  message?: string;
  error?: string;
}