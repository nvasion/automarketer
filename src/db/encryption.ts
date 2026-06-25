/**
 * Client-side AES-256-GCM encryption utilities.
 *
 * These functions provide a Web Crypto–based interface for encrypting and
 * decrypting sensitive string data before writing to browser storage.
 *
 * Intended use
 * ────────────
 * When the schema adds sensitive fields (e.g. social platform OAuth tokens,
 * third-party API keys) those values MUST be encrypted via this module before
 * persisting to localStorage or IndexedDB.  Non-sensitive campaign metadata
 * (name, description, status) does not require field-level encryption.
 *
 * Usage example
 * ─────────────
 *   const key = await getOrCreateStorageKey()
 *   const encrypted = await encryptField(oauthToken, key)
 *   localStorage.setItem('my_token', encrypted)
 *
 *   const key = await getOrCreateStorageKey()
 *   const token = await decryptField(localStorage.getItem('my_token')!, key)
 *
 * Key management
 * ──────────────
 * A per-session encryption key is generated once using `generateStorageKey()`
 * and cached as a JWK in `sessionStorage` (cleared when the browser tab
 * closes).  This prevents at-rest attacks from other tabs or browser
 * extensions, but does NOT protect against XSS within the same origin.
 * Server-side encryption (e.g. via cloud KMS) must be applied once the app
 * migrates to a real backend, per PRD security requirements.
 *
 * Browser support
 * ───────────────
 * Requires `window.crypto.subtle`, available in all modern browsers and in
 * Node 19+ / jsdom 20+.  Tests that run in environments without `crypto.subtle`
 * should mock this module.
 */

/** Session-storage key used to cache the JWK export of the storage key. */
const STORAGE_KEY_SESSION_ITEM = 'automarketer_storage_key_jwk'

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Generate a new AES-256-GCM CryptoKey.
 * The key is extractable so it can be serialised to JWK for session caching.
 */
export async function generateStorageKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Return the cached per-session storage key, or generate and cache a new one.
 *
 * Call this function each time you need the key rather than storing the
 * `CryptoKey` object in a module-level variable — the session storage cache
 * ensures we always return the same logical key within a browser session.
 */
export async function getOrCreateStorageKey(): Promise<CryptoKey> {
  const cached = sessionStorage.getItem(STORAGE_KEY_SESSION_ITEM)
  if (cached) {
    try {
      const jwk: JsonWebKey = JSON.parse(cached)
      return crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
    } catch {
      // Corrupted or tampered cache — regenerate below.
    }
  }

  const key = await generateStorageKey()
  const jwk = await crypto.subtle.exportKey('jwk', key)
  sessionStorage.setItem(STORAGE_KEY_SESSION_ITEM, JSON.stringify(jwk))
  return key
}

// ─── Encrypt / decrypt ────────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 plaintext string under the given AES-256-GCM key.
 *
 * Returns a string in the format `<ivBase64>:<ciphertextBase64>` that is safe
 * to store in `localStorage` or any string-valued field.
 */
export async function encryptField(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV recommended for GCM
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const ivB64 = btoa(String.fromCharCode(...iv))
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
  return `${ivB64}:${ctB64}`
}

/**
 * Decrypt a value produced by `encryptField()`.
 *
 * Throws if the ciphertext is malformed or the key does not match the one used
 * during encryption (e.g. after a session boundary).
 */
export async function decryptField(encrypted: string, key: CryptoKey): Promise<string> {
  const colonIdx = encrypted.indexOf(':')
  if (colonIdx === -1) throw new Error('Malformed encrypted value: missing separator')

  const ivB64 = encrypted.slice(0, colonIdx)
  const ctB64 = encrypted.slice(colonIdx + 1)

  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0))

  const plainBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plainBytes)
}
