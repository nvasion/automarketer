/**
 * Sanitization helpers for queue execution logs.
 *
 * Error messages stored in {@link ExecutionLog} originate from third-party
 * social media APIs and from raw error objects.  Both can contain content
 * that must NOT round-trip into a UI or operator log untouched:
 *
 *  1. HTML / `<script>` payloads (XSS risk if the log is rendered).
 *  2. Bearer tokens, JWTs, API keys, OAuth secrets and URL-embedded
 *     credentials (information-disclosure risk if the log is exposed).
 *
 * {@link sanitizeErrorMessage} addresses both by stripping markup, redacting
 * secret-like substrings, and truncating to a bounded length so a malicious
 * upstream cannot blow up storage with an enormous payload.
 *
 * The implementation is dependency-free on purpose -- pulling in a DOM
 * sanitizer like DOMPurify would force a jsdom-style runtime into the
 * server bundle for what is, in practice, a tag-stripping job.
 */

/** Hard upper bound on the length of a stored error message. */
export const MAX_ERROR_MESSAGE_LENGTH = 500

/** Placeholder used when a secret is redacted. */
export const REDACTED_PLACEHOLDER = '[REDACTED]'

// Regexes for common secret shapes.  Order matters -- more specific patterns
// run first so that, e.g., "Bearer <jwt>" becomes "Bearer [REDACTED]" instead
// of "[REDACTED] [REDACTED]".
const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // "Authorization: Bearer <token>" / "Bearer <token>"
  {
    pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `$1 ${REDACTED_PLACEHOLDER}`,
  },
  // JWTs: three dot-delimited base64url segments.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: REDACTED_PLACEHOLDER,
  },
  // key=value style: api_key=..., access_token=..., password=..., secret=...
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token)\s*[:=]\s*["']?[^\s"'&]{4,}["']?/gi,
    replacement: `$1=${REDACTED_PLACEHOLDER}`,
  },
  // URL-embedded credentials: https://user:password@host
  {
    pattern: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/g,
    replacement: `$1${REDACTED_PLACEHOLDER}@`,
  },
]

/** Strip HTML-ish tags so the message is safe to render verbatim. */
function stripHtml(input: string): string {
  // Drop <script>...</script> and <style>...</style> *with* their contents,
  // then strip any remaining tags. Decoding entities is intentionally left
  // to the rendering layer.
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
}

/** Replace known secret shapes with {@link REDACTED_PLACEHOLDER}. */
function redactSecrets(input: string): string {
  let out = input
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * Sanitize an error message for safe storage and rendering.
 *
 * - `undefined` passes through (so optional fields stay optional).
 * - HTML tags are stripped (script/style with their contents).
 * - Known secret patterns are redacted.
 * - Output is truncated to {@link MAX_ERROR_MESSAGE_LENGTH} characters with
 *   a trailing ellipsis indicator.
 */
export function sanitizeErrorMessage(input: string | undefined): string | undefined {
  if (input === undefined) return undefined
  // Collapse runs of whitespace (incl. newlines and tabs from stack traces)
  // into a single space, and trim leading/trailing whitespace.
  const collapsed = String(input).replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return ''
  const stripped = stripHtml(collapsed)
  const redacted = redactSecrets(stripped)
  if (redacted.length <= MAX_ERROR_MESSAGE_LENGTH) return redacted
  return `${redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`
}
