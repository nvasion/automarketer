import type { Platform } from '../../types'

/**
 * Core types for the social media posting abstraction layer.
 *
 * These types form the contract between the platform-specific connectors
 * and the rest of the application.
 */

// ─── Validation & enforcement ─────────────────────────────────────────────────

/** Result of a content character-limit validation check. */
export interface ContentValidation {
  /** Whether the combined content fits within the platform's character limit. */
  valid: boolean
  /** Length of the combined text (content + hashtags). */
  characterCount: number
  /** The platform's character limit. */
  limit: number
  /** How many characters over the limit. 0 when within the limit. */
  overflowBy: number
}

/** Result after enforcing the platform character limit. */
export interface EnforcedContent {
  /** Post body, truncated if necessary. */
  content: string
  /** Hashtag tokens. May be reduced if content + hashtags exceeded the limit. */
  hashtags: string[]
  /** True when any truncation was applied. */
  truncated: boolean
}

// ─── Post request / result ────────────────────────────────────────────────────

/**
 * Common request payload sent to every platform connector.
 *
 * Platform-specific fields are isolated in their own optional namespaces so
 * the common interface stays stable as new platforms are added.
 */
export interface SocialPostRequest {
  /** Main post body (already within the character limit, or enforceLimit()
   *  should be called first). */
  content: string
  /** Hashtag tokens to append after the content (e.g. ["#SaaS", "#Launch"]). */
  hashtags?: string[]

  // ── Platform-specific options ──────────────────────────────────────────────

  /** LinkedIn-specific options. */
  linkedIn?: {
    /** LinkedIn member URN of the author, e.g. "urn:li:person:abc123". */
    authorId: string
  }
  /** Reddit-specific options. */
  reddit?: {
    /**
     * Target subreddit(s) to submit the post to. Accepts a single subreddit
     * name or an array of names. "r/" prefixes are tolerated and stripped,
     * e.g. "programming", "r/programming", or ["startups", "SaaS"].
     */
    subreddit: string | string[]
    /** Post title (required for Reddit self-posts). */
    title: string
    /** Whether the post contains NSFW content. Defaults to false. */
    nsfw?: boolean
  }
  /** Facebook-specific options. */
  facebook?: {
    /** Facebook Page ID to post on behalf of. */
    pageId: string
    /** Optional link to attach to the post. */
    link?: string
  }
  /** Instagram-specific options. */
  instagram?: {
    /** Instagram user ID. */
    userId: string
    /** Publicly accessible image URL to attach to the caption (required). */
    imageUrl: string
  }
}

/** Result returned by every connector after attempting a post. */
export interface SocialPostResult {
  /** Whether the post was successfully published. */
  success: boolean
  /** Platform that handled the post. */
  platform: Platform
  /** Platform-assigned post / tweet / submission identifier. */
  postId?: string
  /** Direct URL to the published post, if available. */
  url?: string
  /**
   * Per-target results when a single request fans out to multiple targets
   * (e.g. a Reddit post submitted to several subreddits). Present only when
   * more than one target was posted to; `postId`/`url` then reflect the
   * first submission.
   */
  submissions?: Array<{ target: string; postId?: string; url?: string }>
}

// ─── Credentials ──────────────────────────────────────────────────────────────

/**
 * Abstraction over OAuth 2.0 credential storage.
 *
 * Implementations are responsible for caching tokens and transparently
 * refreshing them before they expire, so callers never need to handle
 * token refresh logic directly.
 */
export interface CredentialProvider {
  /** Return a valid access token, refreshing it automatically if necessary. */
  getAccessToken(): Promise<string>
}

/**
 * Convenience implementation backed by a static token string.
 *
 * Suitable for testing and for short-lived scripts where automatic token
 * refresh is not required.
 */
export class StaticCredentialProvider implements CredentialProvider {
  constructor(private readonly token: string) {}
  async getAccessToken(): Promise<string> {
    return this.token
  }
}

// ─── Retry ───────────────────────────────────────────────────────────────────

/** Configuration for automatic retry and exponential back-off. */
export interface RetryConfig {
  /** Maximum number of additional attempts after the initial try. Default: 3. */
  maxRetries: number
  /** Delay in milliseconds before the first retry. Default: 1 000 ms. */
  initialDelayMs: number
  /** Multiplier applied to the delay after each subsequent retry. Default: 2. */
  backoffMultiplier: number
}

/** Default retry configuration used by {@link BaseSocialConnector}. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1_000,
  backoffMultiplier: 2,
}

// ─── Error class ─────────────────────────────────────────────────────────────

/**
 * Error thrown by social connectors when a posting request fails.
 *
 * All platform connectors must throw this type so that the posting queue can
 * make intelligent retry decisions and surface actionable diagnostics.
 */
export class SocialError extends Error {
  /** HTTP status code returned by the platform API, if available. */
  readonly httpStatus?: number
  /** Platform that produced the error. */
  readonly platform?: Platform
  /** Platform-specific error code string returned in the API response body. */
  readonly apiErrorCode?: string
  /** Whether the operation is safe to retry (e.g. 429, 5xx). */
  readonly retryable: boolean
  /** Raw response body, preserved for debugging. */
  readonly rawResponse?: string

  constructor(
    message: string,
    options: {
      httpStatus?: number
      platform?: Platform
      apiErrorCode?: string
      retryable?: boolean
      rawResponse?: string
    } = {}
  ) {
    super(message)
    this.name = 'SocialError'
    this.httpStatus = options.httpStatus
    this.platform = options.platform
    this.apiErrorCode = options.apiErrorCode
    this.retryable = options.retryable ?? false
    this.rawResponse = options.rawResponse
    // Restore prototype chain (needed when transpiling to ES5)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
