/**
 * Platform types supported by agent-based authentication.
 */
export type PlatformType = 'reddit' | 'x';

/**
 * Type guard to validate PlatformType values.
 */
export function isPlatformType(value: string): value is PlatformType {
  return value === 'reddit' || value === 'x';
}

/**
 * Agent credentials structure for storing platform access.
 * These credentials are encrypted at rest in the database.
 */
export interface AgentCredentials {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Database record for agent credentials.
 */
export interface AgentCredentialsRecord {
  id: string;
  userId: string;
  platform: PlatformType;
  encryptedCredentials: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public representation of connection status (no sensitive data).
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
 * Response for credential validation operations.
 */
export interface ValidateCredentialsResponse {
  valid: boolean;
  message?: string;
  error?: string;
  code?: string;
}

/**
 * Validation result for credential input validation.
 */
export interface CredentialValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
  credentials?: AgentCredentials;
}