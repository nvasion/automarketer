// ── DPoP Private Key Encryption ───────────────────────────────────────────────
// Provides at-rest encryption for DPoP (Demonstrating Proof of Possession)
// private key JWKs before they are persisted to the database.
//
// DPoP security relies entirely on the secrecy of the private key to bind
// access tokens to the client. Encrypting it at rest ensures a database
// compromise does not yield usable key material.
//
// Algorithm: AES-256-GCM (authenticated encryption — detects tampering)
//   Key source: BLUESKY_DPOP_ENCRYPTION_KEY env var (base64-encoded 32 bytes)
//   Stored format: v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
//
// Development fallback: if the env var is unset, the plaintext JWK is stored
//   with a "plain:" prefix and a warning is emitted. This keeps the local dev
//   workflow functional without requiring key management setup, but MUST NOT
//   be used in production.

import * as crypto from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const KEY_BYTES = 32; // 256-bit AES key

/** Resolve the AES-256 encryption key from the environment, or null in dev mode. */
function getEncryptionKey(): Buffer | null {
  const raw = process.env.BLUESKY_DPOP_ENCRYPTION_KEY;
  if (!raw) return null;

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[dpopKeyEncryption] BLUESKY_DPOP_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes ` +
        `(got ${key.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/**
 * Encrypt a DPoP private key JWK string for database storage.
 *
 * When BLUESKY_DPOP_ENCRYPTION_KEY is set, returns a versioned AES-256-GCM
 * ciphertext string. When unset (development only), returns the plaintext
 * prefixed with "plain:" and emits a warning.
 */
export function encryptDPoPKey(plaintext: string): string {
  const key = getEncryptionKey();

  if (!key) {
    console.warn(
      '[dpopKeyEncryption] BLUESKY_DPOP_ENCRYPTION_KEY is not set — DPoP private key will be ' +
        'stored without encryption. This is acceptable in development but MUST NOT be used in ' +
        'production. Set the env var to a base64-encoded 32-byte key: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    return `plain:${plaintext}`;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 128-bit GCM tag

  return `${VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a DPoP private key JWK string retrieved from the database.
 *
 * Handles both the encrypted format (v1:...) and the development-mode
 * unencrypted format (plain:...).
 */
export function decryptDPoPKey(stored: string): string {
  if (stored.startsWith('plain:')) {
    // Development mode — stored without encryption.
    return stored.slice('plain:'.length);
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      '[dpopKeyEncryption] BLUESKY_DPOP_ENCRYPTION_KEY is required to decrypt DPoP keys that ' +
        'were stored with encryption. Ensure the same key used for encryption is set in the environment.',
    );
  }

  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(
      `[dpopKeyEncryption] Unrecognised DPoP key ciphertext format (expected "${VERSION}:<iv>:<tag>:<data>")`,
    );
  }

  const [, ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encryptedData = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      '[dpopKeyEncryption] Failed to decrypt DPoP key — authentication tag mismatch. ' +
        'The key may have been tampered with, or the wrong BLUESKY_DPOP_ENCRYPTION_KEY is set.',
    );
  }
}
