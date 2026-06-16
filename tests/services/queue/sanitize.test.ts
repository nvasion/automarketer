import { describe, it, expect } from 'vitest'
import {
  sanitizeErrorMessage,
  MAX_ERROR_MESSAGE_LENGTH,
  REDACTED_PLACEHOLDER,
} from '../../../src/services/queue/sanitize'

describe('sanitizeErrorMessage', () => {
  it('returns undefined when given undefined (preserves optional semantics)', () => {
    expect(sanitizeErrorMessage(undefined)).toBeUndefined()
  })

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeErrorMessage('   \n\t   ')).toBe('')
  })

  it('leaves a plain message untouched', () => {
    expect(sanitizeErrorMessage('Request failed: timeout')).toBe(
      'Request failed: timeout'
    )
  })

  describe('XSS / HTML stripping', () => {
    it('removes <script>...</script> blocks with their contents', () => {
      const input = 'Error: <script>alert("xss")</script> denied'
      const out = sanitizeErrorMessage(input)!
      expect(out).not.toContain('<script')
      expect(out).not.toContain('alert("xss")')
      expect(out).toContain('Error:')
      expect(out).toContain('denied')
    })

    it('removes <style>...</style> blocks with their contents', () => {
      const out = sanitizeErrorMessage('a <style>body{}</style> b')!
      expect(out).not.toContain('<style')
      expect(out).not.toContain('body{}')
    })

    it('strips inline tags but keeps the surrounding text', () => {
      const out = sanitizeErrorMessage(
        '<img src=x onerror="alert(1)"> upload failed <b>500</b>'
      )!
      expect(out).not.toContain('<')
      expect(out).not.toContain('>')
      expect(out).toContain('upload failed')
      expect(out).toContain('500')
    })

    it('handles deliberately malformed tags', () => {
      const out = sanitizeErrorMessage('<<scr<script>ipt>alert(1)</script>')!
      expect(out).not.toContain('<script')
      expect(out).not.toContain('alert(1)')
    })
  })

  describe('secret redaction', () => {
    it('redacts "Bearer <token>" while keeping the keyword', () => {
      const out = sanitizeErrorMessage(
        'auth failed: Bearer abcdef1234567890XYZ'
      )!
      expect(out).toContain('Bearer')
      expect(out).toContain(REDACTED_PLACEHOLDER)
      expect(out).not.toContain('abcdef1234567890XYZ')
    })

    it('redacts JWT-shaped tokens', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      const out = sanitizeErrorMessage(`token=${jwt} expired`)!
      expect(out).not.toContain(jwt)
      expect(out).toContain(REDACTED_PLACEHOLDER)
    })

    it('redacts api_key=… style query parameters', () => {
      const out = sanitizeErrorMessage(
        'GET /v1/posts?api_key=sk_live_abcdef12345 failed'
      )!
      expect(out).not.toContain('sk_live_abcdef12345')
      expect(out).toMatch(/api_key=\[REDACTED\]/i)
    })

    it('redacts password / secret fields', () => {
      const out = sanitizeErrorMessage(
        'login failure password="hunter2!secret" for user x'
      )!
      expect(out).not.toContain('hunter2!secret')
      expect(out).toMatch(/password=\[REDACTED\]/i)
    })

    it('redacts URL-embedded credentials', () => {
      const out = sanitizeErrorMessage(
        'connect ECONNREFUSED https://admin:s3cr3t@db.internal:5432'
      )!
      expect(out).not.toContain('admin:s3cr3t')
      expect(out).toContain('[REDACTED]@db.internal')
    })

    it('does not over-redact unrelated key=value pairs', () => {
      const out = sanitizeErrorMessage('post_id=123 user_id=42')!
      expect(out).toBe('post_id=123 user_id=42')
    })
  })

  describe('length bounds', () => {
    it('truncates strings longer than MAX_ERROR_MESSAGE_LENGTH', () => {
      const long = 'A'.repeat(2_000)
      const out = sanitizeErrorMessage(long)!
      expect(out.length).toBe(MAX_ERROR_MESSAGE_LENGTH)
      expect(out.endsWith('...')).toBe(true)
    })

    it('keeps strings at the boundary intact', () => {
      const exact = 'A'.repeat(MAX_ERROR_MESSAGE_LENGTH)
      const out = sanitizeErrorMessage(exact)!
      expect(out.length).toBe(MAX_ERROR_MESSAGE_LENGTH)
      expect(out.endsWith('...')).toBe(false)
    })
  })

  describe('whitespace normalisation', () => {
    it('collapses runs of newlines/tabs into single spaces', () => {
      const out = sanitizeErrorMessage('Error:\n\n\tdetails    here')!
      expect(out).toBe('Error: details here')
    })
  })
})
