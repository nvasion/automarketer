// ── Agent Credentials Encryption ──────────────────────────────────────────────
// Provides at-rest encryption for agent-based platform credentials
// (username, password, clientId, clientSecret) before they are persisted
// to the database.
//
// Agent-based authentication stores user credentials directly, which are
// highly sensitive. Encrypting them at rest ensures a database compromise
// does not yield usable credential material.
//
// Algorithm: AES-256-GCM (authenticated encryption — detects tampering)
//   Key source: AGENT_CREDENTIALS_ENCRYPTION_KEY env var (base64-encoded 32 bytes)
//   Stored format: v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
//
// Development fallback: if the env var is unset, credentials are stored
// with a "plain:" prefix and a warning is emitted. This keeps the local dev
// workflow functional without requiring key management setup, but MUST NOT
// be used in production.

import * as crypto from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const KEY_BYTES = 32; // 256-bit AES key

/**
 * Structure of agent credentials to be encrypted.
 */
export interface AgentCredentials {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Module-level encryption key cache for dependency injection.
 * Allows tests to override the key without modifying environment variables.
 */
let encryptionKeyOverride: Buffer | undefined;

/**
 * Set the encryption key explicitly (for testing/dependency injection).
 * This allows tests to use a known key without relying on environment variables.
 */
export function setEncryptionKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[agentCredentialEncryption] Key must decode to exactly ${KEY_BYTES} bytes ` +
        `(got ${key.length}).`,
    );
  }
  encryptionKeyOverride = key;
}

/**
 * Clear the encryption key override, reverting to environment variable lookup.
 */
export function clearEncryptionKey(): void {
  encryptionKeyOverride = undefined;
}

/** Resolve the AES-256 encryption key from the environment, or null in dev mode. */
function getEncryptionKey(): Buffer | null {
  // Check for injected key first (for testing)
  if (encryptionKeyOverride) {
    return encryptionKeyOverride;
  }

  const raw = process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) return null;

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[agentCredentialEncryption] AGENT_CREDENTIALS_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes ` +
        `(got ${key.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/**
 * Encrypt agent credentials for database storage.
 *
 * When AGENT_CREDENTIALS_ENCRYPTION_KEY is set, returns a versioned AES-256-GCM
 * ciphertext string. When unset (development only), returns the plaintext
 * JSON with a "plain:" prefix and emits a warning.
 */
export function encryptAgentCredentials(credentials: AgentCredentials): string {
  const key = getEncryptionKey();

  if (!key) {
    console.warn(
      '[agentCredentialEncryption] AGENT_CREDENTIALS_ENCRYPTION_KEY is not set — credentials will be ' +
        'stored without encryption. This is acceptable in development but MUST NOT be used in ' +
        'production. Set the env var to a base64-encoded 32-byte key: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    const plaintext = JSON.stringify(credentials);
    return `plain:${plaintext}`;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const plaintext = JSON.stringify(credentials);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 128-bit GCM tag

  return `${VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt agent credentials retrieved from the database.
 *
 * Handles both the encrypted format (v1:...) and the development-mode
 * unencrypted format (plain:...).
 */
export function decryptAgentCredentials(stored: string): AgentCredentials {
  if (stored.startsWith('plain:')) {
    // Development mode — stored without encryption.
    const plaintext = stored.slice('plain:'.length);
    try {
      return JSON.parse(plaintext) as AgentCredentials;
    } catch {
      throw new Error(
        '[agentCredentialEncryption] Failed to parse plaintext credentials — data may be corrupted.',
      );
    }
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      '[agentCredentialEncryption] AGENT_CREDENTIALS_ENCRYPTION_KEY is required to decrypt credentials that ' +
        'were stored with encryption. Ensure the same key used for encryption is set in the environment.',
    );
  }

  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(
      `[agentCredentialEncryption] Unrecognised credentials ciphertext format (expected "${VERSION}:<iv>:<tag>:<data>")`,
    );
  }

  const [, ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encryptedData = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(encryptedData), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext) as AgentCredentials;
  } catch {
    throw new Error(
      '[agentCredentialEncryption] Failed to decrypt credentials — authentication tag mismatch. ' +
        'The data may have been tampered with, or the wrong AGENT_CREDENTIALS_ENCRYPTION_KEY is set.',
    );
  }
}