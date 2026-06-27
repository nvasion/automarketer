import type { Platform } from '../../types'
import type {
  ContentValidation,
  CredentialProvider,
  EnforcedContent,
  RetryConfig,
  SocialPostRequest,
  SocialPostResult,
} from './types'
import { DEFAULT_RETRY_CONFIG, SocialError } from './types'
import type { SocialConnector } from './SocialConnector'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the combined post string from content and optional hashtags.
 *
 * Uses a double newline (`\n\n`) as the separator — the LinkedIn/Facebook/Reddit
 * convention. Exported so tests and external utilities can call it directly.
 * Platform connectors that need a different format override the protected
 * `buildCombinedText()` instance method instead of calling this function.
 */
export function buildCombinedText(content: string, hashtags: string[]): string {
  if (hashtags.length === 0) return content
  return `${content}\n\n${hashtags.join(' ')}`
}

/**
 * Truncate text at the last whitespace boundary before `limit` characters.
 * Appends an ellipsis (…) when truncation occurs.
 *
 * Scans backwards for any whitespace character (space, newline, tab) to avoid
 * breaking in the middle of a word.
 */
export function truncateAtWordBoundary(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1)
  // Walk backwards to find the nearest whitespace break point
  let lastBreak = -1
  for (let i = cut.length - 1; i >= 0; i--) {
    if (/\s/.test(cut[i])) {
      lastBreak = i
      break
    }
  }
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut) + '…'
}

// ─── Base class ───────────────────────────────────────────────────────────────

/**
 * Shared implementation of character-limit utilities and HTTP retry logic.
 *
 * Platform connectors extend this class and implement only `post()`.  They may
 * additionally override:
 *
 *  - `countCharacters()` — platform-specific character weighting (e.g. Twitter).
 *  - `buildCombinedText()` — platform-specific content + hashtag layout.
 */
export abstract class BaseSocialConnector implements SocialConnector {
  abstract readonly platform: Platform
  abstract readonly charLimit: number

  protected readonly retryConfig: RetryConfig

  constructor(retryConfig: Partial<RetryConfig> = {}) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
  }

  // ── Character counting ─────────────────────────────────────────────────────

  /**
   * Count characters using platform weighting rules.
   *
   * Default: `text.length` (UTF-16 code units).  Override in platform
   * connectors that apply different rules (e.g. TwitterConnector normalises
   * URLs to a fixed 23-character weight).
   */
  countCharacters(text: string): number {
    return text.length
  }

  // ── Content formatting ─────────────────────────────────────────────────────

  /**
   * Combine content and hashtags into a single string for the platform.
   *
   * Default: content + `\n\n` + hashtags.  Override per platform when a
   * different separator or layout is required (e.g. inline hashtags on Twitter).
   */
  protected buildCombinedText(content: string, hashtags: string[]): string {
    return buildCombinedText(content, hashtags)
  }

  // ── Validation & enforcement ───────────────────────────────────────────────

  /** @inheritdoc */
  validateContent(content: string, hashtags: string[] = []): ContentValidation {
    const combinedText = this.buildCombinedText(content, hashtags)
    const characterCount = this.countCharacters(combinedText)
    const overflowBy = Math.max(0, characterCount - this.charLimit)
    return {
      valid: overflowBy === 0,
      characterCount,
      limit: this.charLimit,
      overflowBy,
    }
  }

  /** @inheritdoc */
  enforceLimit(content: string, hashtags: string[] = []): EnforcedContent {
    // Guard against degenerate limits
    if (this.charLimit <= 1) {
      return { content: '…', hashtags: [], truncated: true }
    }

    const combined = this.buildCombinedText(content, hashtags)

    // Already within limit — nothing to do.
    if (this.countCharacters(combined) <= this.charLimit) {
      return { content, hashtags, truncated: false }
    }

    // Compute the character budget consumed by the hashtag block (including the
    // platform-specific separator) using the same formatting and counting rules
    // as the rest of this connector.
    const hashtagBlock = this.buildCombinedText('', hashtags)
    const hashtagCost = this.countCharacters(hashtagBlock)
    const contentBudget = this.charLimit - hashtagCost

    // If the hashtag block alone exceeds the limit, drop all hashtags and
    // truncate only the content.
    if (contentBudget <= 0) {
      return {
        content: truncateAtWordBoundary(content, this.charLimit),
        hashtags: [],
        truncated: true,
      }
    }

    return {
      content: truncateAtWordBoundary(content, contentBudget),
      hashtags,
      truncated: true,
    }
  }

  // ── HTTP with retry ────────────────────────────────────────────────────────

  /**
   * Execute a `fetch` request with automatic retry on transient failures.
   *
   * Retry behaviour:
   *  - Network errors: retried up to `maxRetries` times.
   *  - HTTP 429 (rate limited): waits for the `Retry-After` header value (or
   *    the current back-off interval) before retrying.
   *  - HTTP 5xx (server errors): retried with exponential back-off.
   *  - All other responses (including 4xx) are returned immediately.
   */
  protected async safeFetch(url: string, init: RequestInit): Promise<Response> {
    let backoffMs = this.retryConfig.initialDelayMs

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        await BaseSocialConnector.delayMs(backoffMs)
        backoffMs = Math.min(backoffMs * this.retryConfig.backoffMultiplier, 60_000)
      }

      let response: Response
      try {
        response = await fetch(url, init)
      } catch (networkErr) {
        if (attempt < this.retryConfig.maxRetries) continue
        throw networkErr
      }

      // Rate-limited: respect Retry-After when present
      if (response.status === 429 && attempt < this.retryConfig.maxRetries) {
        const retryAfterMs = BaseSocialConnector.parseRetryAfterMs(
          response.headers.get('Retry-After'),
          backoffMs
        )
        await BaseSocialConnector.delayMs(retryAfterMs)
        backoffMs = Math.min(backoffMs * this.retryConfig.backoffMultiplier, 60_000)
        continue
      }

      // Server error: retry with back-off
      if (response.status >= 500 && attempt < this.retryConfig.maxRetries) continue

      return response
    }

    // Unreachable: the loop always returns or throws before reaching here.
    /* v8 ignore next */
    throw new Error('safeFetch: exhausted retries')
  }

  // ── Media ──────────────────────────────────────────────────────────────────

  /**
   * Fetch an image attachment as a Blob so a connector can re-upload its bytes
   * to a platform's media endpoint. Uses web-standard `fetch`/`Blob`, so it runs
   * unchanged on the server (Node 18+) and in the browser.
   *
   * @throws {SocialError} when the URL cannot be fetched.
   */
  protected async fetchMediaBlob(url: string): Promise<{ blob: Blob; contentType: string }> {
    let response: Response
    try {
      response = await fetch(url)
    } catch (err) {
      throw new SocialError(
        `Network error fetching media ${url}: ${err instanceof Error ? err.message : String(err)}`,
        { platform: this.platform, retryable: false }
      )
    }
    if (!response.ok) {
      throw new SocialError(`Failed to fetch media ${url}: HTTP ${response.status}`, {
        platform: this.platform,
        httpStatus: response.status,
        retryable: response.status >= 500,
      })
    }
    const blob = await response.blob()
    const contentType = blob.type || response.headers.get('content-type') || 'application/octet-stream'
    return { blob, contentType }
  }

  private static delayMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private static parseRetryAfterMs(header: string | null, fallbackMs: number): number {
    if (!header) return fallbackMs
    if (/^\d+$/.test(header)) return parseInt(header, 10) * 1_000
    const date = new Date(header)
    return isNaN(date.getTime()) ? fallbackMs : Math.max(0, date.getTime() - Date.now())
  }

  abstract post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult>
}
