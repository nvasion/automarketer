import type { Platform } from '../../../types'
import { BaseSocialConnector } from '../BaseSocialConnector'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../types'
import { SocialError } from '../types'

/**
 * Twitter/X connector — posts tweets via the Twitter API v2.
 *
 * API reference: https://developer.x.com/en/docs/x-api/tweets/manage-tweets/api-reference/post-tweets
 *
 * Required OAuth 2.0 scopes: tweet.write, users.read, offline.access
 * Character limit: 280 characters (Twitter's weighted count)
 *
 * Twitter character counting rules applied by this connector:
 *  - URLs (http/https) always count as {@link TWITTER_URL_CHAR_COUNT} characters,
 *    regardless of their actual length (Twitter normalises them to t.co links).
 *  - All other characters use UTF-16 code units (.length), which matches
 *    Twitter's weighted character count for BMP and Supplementary Plane chars.
 */
export const TWITTER_API_BASE = 'https://api.twitter.com'
export const TWITTER_CHAR_LIMIT = 280
/** Length Twitter assigns to any URL after normalisation to a t.co short link. */
export const TWITTER_URL_CHAR_COUNT = 23

export class TwitterConnector extends BaseSocialConnector {
  readonly platform: Platform = 'twitter'
  readonly charLimit = TWITTER_CHAR_LIMIT

  // ── Platform-specific character counting ──────────────────────────────────

  /**
   * Count characters using Twitter's weighted rules.
   *
   * URLs are always counted as {@link TWITTER_URL_CHAR_COUNT} characters (23).
   * All other characters use `.length` (UTF-16 code units).
   */
  override countCharacters(text: string): number {
    const urlPattern = /https?:\/\/\S+/g
    const urlMatches = text.match(urlPattern) ?? []
    const textWithoutUrls = text.replace(urlPattern, '')
    return textWithoutUrls.length + urlMatches.length * TWITTER_URL_CHAR_COUNT
  }

  // ── Platform-specific content formatting ──────────────────────────────────

  /**
   * Twitter posts use a single space before inline hashtags rather than the
   * double-newline separator used by LinkedIn/Facebook/Reddit.
   */
  protected override buildCombinedText(content: string, hashtags: string[]): string {
    if (hashtags.length === 0) return content
    return `${content} ${hashtags.join(' ')}`
  }

  // ── API call ──────────────────────────────────────────────────────────────

  /**
   * Publish a tweet on X (Twitter).
   *
   * For Twitter the combined text (content + hashtags) is the tweet itself —
   * the API does not treat hashtags as a separate field.
   *
   * @param request     Post content and optional hashtags.
   * @param credentials Credential provider supplying a tweet.write Bearer token.
   */
  async post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult> {
    const accessToken = await credentials.getAccessToken()

    // Enforce character limit before sending
    const { content, hashtags } = this.enforceLimit(
      request.content,
      request.hashtags ?? []
    )
    const text = this.buildCombinedText(content, hashtags)

    let response: Response
    try {
      response = await this.safeFetch(`${TWITTER_API_BASE}/2/tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ text }),
      })
    } catch (err) {
      throw new SocialError(
        `Network error contacting Twitter: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'twitter', retryable: false }
      )
    }

    if (!response.ok) {
      let rawResponse = ''
      try {
        rawResponse = await response.text()
      } catch {
        // ignore read errors
      }
      throw new SocialError(
        `Twitter API error ${response.status}: ${rawResponse}`,
        {
          httpStatus: response.status,
          platform: 'twitter',
          rawResponse,
          retryable: response.status === 429 || response.status >= 500,
        }
      )
    }

    const data = await response.json() as { data?: { id?: string; text?: string } }
    return {
      success: true,
      platform: 'twitter',
      postId: data.data?.id,
      url: data.data?.id
        ? `https://x.com/i/web/status/${data.data.id}`
        : undefined,
    }
  }
}
