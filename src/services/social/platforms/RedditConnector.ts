import type { Platform } from '../../../types'
import { BaseSocialConnector } from '../BaseSocialConnector'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../types'
import { SocialError } from '../types'

/**
 * Reddit connector — submits self (text) posts via the Reddit OAuth API.
 *
 * API reference: https://www.reddit.com/dev/api/#POST_api_submit
 *
 * Required OAuth 2.0 scopes: submit
 * Character limit: 40,000 characters (text body)
 */
export const REDDIT_API_BASE = 'https://oauth.reddit.com'
export const REDDIT_CHAR_LIMIT = 40_000

export class RedditConnector extends BaseSocialConnector {
  readonly platform: Platform = 'reddit'
  readonly charLimit = REDDIT_CHAR_LIMIT

  /**
   * Submit a self (text) post to a Reddit subreddit.
   *
   * @param request     Must include `request.reddit.subreddit` and
   *                    `request.reddit.title`.
   * @param credentials Credential provider supplying a submit-scope access token.
   */
  async post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult> {
    const subreddit = request.reddit?.subreddit
    const title = request.reddit?.title
    if (!subreddit) {
      throw new SocialError(
        'Reddit post requires request.reddit.subreddit',
        { platform: 'reddit' }
      )
    }
    if (!title) {
      throw new SocialError(
        'Reddit post requires request.reddit.title',
        { platform: 'reddit' }
      )
    }

    const accessToken = await credentials.getAccessToken()

    // Enforce character limit before sending
    const { content, hashtags } = this.enforceLimit(
      request.content,
      request.hashtags ?? []
    )
    const text = this.buildCombinedText(content, hashtags)

    // Reddit's submit endpoint uses application/x-www-form-urlencoded
    const params = new URLSearchParams({
      api_type: 'json',
      kind: 'self',
      sr: subreddit,
      title,
      text,
      nsfw: String(request.reddit?.nsfw ?? false),
    })

    let response: Response
    try {
      response = await this.safeFetch(`${REDDIT_API_BASE}/api/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'AutoMarketer/1.0',
        },
        body: params.toString(),
      })
    } catch (err) {
      throw new SocialError(
        `Network error contacting Reddit: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'reddit', retryable: false }
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
        `Reddit API error ${response.status}: ${rawResponse}`,
        {
          httpStatus: response.status,
          platform: 'reddit',
          rawResponse,
          retryable: response.status === 429 || response.status >= 500,
        }
      )
    }

    const data = await response.json() as {
      json?: { data?: { id?: string; url?: string }; errors?: unknown[] }
    }

    // Reddit returns errors in the JSON body even on 200 responses
    const errors = data.json?.errors
    if (errors && errors.length > 0) {
      throw new SocialError(
        `Reddit submission error: ${JSON.stringify(errors)}`,
        { platform: 'reddit', rawResponse: JSON.stringify(data) }
      )
    }

    const postId = data.json?.data?.id
    const url = data.json?.data?.url

    return {
      success: true,
      platform: 'reddit',
      postId,
      url,
    }
  }
}
