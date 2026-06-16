import type { Platform } from '../../types'
import type {
  ContentValidation,
  CredentialProvider,
  EnforcedContent,
  SocialPostRequest,
  SocialPostResult,
} from './types'

/**
 * Pluggable interface for social media platform connectors.
 *
 * Any class that implements this interface can be swapped in without touching
 * business logic. Built-in implementations: LinkedInConnector, TwitterConnector,
 * RedditConnector, FacebookConnector, InstagramConnector.
 */
export interface SocialConnector {
  /** Identifies which platform this connector targets. */
  readonly platform: Platform

  /** Maximum number of characters allowed by the platform. */
  readonly charLimit: number

  /**
   * Count the number of characters in `text` using the platform's own weighting
   * rules.
   *
   * The default implementation returns `text.length` (UTF-16 code units).
   * Platforms with special rules (e.g. Twitter's URL normalisation) override
   * this method so that `validateContent` and `enforceLimit` apply the correct
   * budget calculation.
   */
  countCharacters(text: string): number

  /**
   * Check whether the combined post text fits within the platform limit.
   *
   * Does NOT modify any content — use enforceLimit() to truncate.
   *
   * @param content  Main post body.
   * @param hashtags Optional hashtag tokens appended after the content.
   */
  validateContent(content: string, hashtags?: string[]): ContentValidation

  /**
   * Return a version of the content (and hashtags) that is guaranteed to fit
   * within the platform character limit.
   *
   * Strategy:
   *  1. If already within limit → return unchanged.
   *  2. Otherwise truncate content at the last word boundary that keeps the
   *     combined text (content + hashtags) within the limit.
   *  3. If the hashtags alone already exceed the limit, drop them entirely and
   *     truncate just the content.
   *
   * @param content  Main post body.
   * @param hashtags Optional hashtag tokens appended after the content.
   */
  enforceLimit(content: string, hashtags?: string[]): EnforcedContent

  /**
   * Publish a post to the platform.
   *
   * Implementations must call enforceLimit() before sending so the API never
   * receives content that exceeds the platform limit.
   *
   * @param request     Post payload (content + optional platform-specific fields).
   * @param credentials Credential provider that supplies a valid OAuth 2.0 access
   *                    token, refreshing it transparently when required.
   * @throws {SocialError} if the request fails for any reason.
   */
  post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult>
}
