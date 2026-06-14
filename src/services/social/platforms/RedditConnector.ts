import type { Platform } from '../../../types'
import { BaseSocialConnector } from '../BaseSocialConnector'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../types'
import { SocialError } from '../types'
import { parseJsonBody } from '../../../utils/http'
import { normalizeSubreddits } from '../../../utils/subreddits'

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
   * Submit a self (text) post to one or more subreddits.
   *
   * @param request     Must include `request.reddit.subreddit` (a single
   *                    subreddit name or an array of names) and
   *                    `request.reddit.title`. When multiple subreddits are
   *                    given, the post is submitted to each in turn and the
   *                    result lists every submission in `result.submissions`.
   * @param credentials Credential provider supplying a submit-scope access token.
   */
  async post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult> {
    const subreddits = normalizeSubreddits(request.reddit?.subreddit)
    const title = request.reddit?.title
    if (subreddits.length === 0) {
      throw new SocialError(
        'Reddit post requires request.reddit.subreddit (a subreddit name or non-empty array of names)',
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
    const nsfw = request.reddit?.nsfw ?? false

    const submissions: Array<{ target: string; postId?: string; url?: string }> = []
    for (const subreddit of subreddits) {
      try {
        const { postId, url } = await this.submit(subreddit, title, text, nsfw, accessToken)
        submissions.push({ target: subreddit, postId, url })
      } catch (err) {
        // A retry after a partial failure would re-submit (and duplicate) the
        // subreddits that already succeeded, so surface the failure as
        // non-retryable with the successful targets listed.
        if (submissions.length > 0 && err instanceof SocialError) {
          throw new SocialError(
            `${err.message} (already submitted to: ${submissions.map((s) => s.target).join(', ')})`,
            {
              httpStatus: err.httpStatus,
              platform: 'reddit',
              apiErrorCode: err.apiErrorCode,
              retryable: false,
              rawResponse: err.rawResponse,
            }
          )
        }
        throw err
      }
    }

    return {
      success: true,
      platform: 'reddit',
      postId: submissions[0].postId,
      url: submissions[0].url,
      ...(submissions.length > 1 && { submissions }),
    }
  }

  /** Submit a single self post to one subreddit and parse the response. */
  private async submit(
    subreddit: string,
    title: string,
    text: string,
    nsfw: boolean,
    accessToken: string
  ): Promise<{ postId?: string; url?: string }> {
    // Reddit's submit endpoint uses application/x-www-form-urlencoded
    const params = new URLSearchParams({
      api_type: 'json',
      kind: 'self',
      sr: subreddit,
      title,
      text,
      nsfw: String(nsfw),
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

    let data: {
      json?: { data?: { id?: string; url?: string }; errors?: unknown[] }
    }
    try {
      data = await parseJsonBody<typeof data>(response)
    } catch (err) {
      throw new SocialError(
        `Reddit returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'reddit' }
      )
    }

    // Reddit returns errors in the JSON body even on 200 responses
    const errors = data.json?.errors
    if (errors && errors.length > 0) {
      throw new SocialError(
        `Reddit submission error: ${JSON.stringify(errors)}`,
        { platform: 'reddit', rawResponse: JSON.stringify(data) }
      )
    }

    return {
      postId: data.json?.data?.id,
      url: data.json?.data?.url,
    }
  }
}
