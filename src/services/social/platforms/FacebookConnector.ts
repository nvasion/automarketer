import type { Platform } from '../../../types'
import { BaseSocialConnector } from '../BaseSocialConnector'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../types'
import { SocialError } from '../types'
import { parseJsonBody } from '../../../utils/http'

/**
 * Facebook connector — publishes posts to a Facebook Page feed via the
 * Facebook Graph API.
 *
 * API reference: https://developers.facebook.com/docs/graph-api/reference/page/feed/
 *
 * Required permissions: pages_manage_posts, pages_read_engagement
 * Character limit: 63,206 characters (message field)
 */
export const FACEBOOK_GRAPH_BASE = 'https://graph.facebook.com/v18.0'
export const FACEBOOK_CHAR_LIMIT = 63_206

export class FacebookConnector extends BaseSocialConnector {
  readonly platform: Platform = 'facebook'
  readonly charLimit = FACEBOOK_CHAR_LIMIT

  /**
   * Publish a text post to a Facebook Page.
   *
   * @param request     Must include `request.facebook.pageId`.  An optional
   *                    `request.facebook.link` URL can be attached to the post.
   * @param credentials Page access token with pages_manage_posts permission.
   */
  async post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult> {
    const pageId = request.facebook?.pageId
    if (!pageId) {
      throw new SocialError(
        'Facebook post requires request.facebook.pageId',
        { platform: 'facebook' }
      )
    }

    const accessToken = await credentials.getAccessToken()

    // Enforce character limit before sending
    const { content, hashtags } = this.enforceLimit(
      request.content,
      request.hashtags ?? []
    )
    const message = this.buildCombinedText(content, hashtags)

    // With an attached image, publish a photo (Graph fetches the image by URL);
    // otherwise publish a plain text/link post to the page feed.
    const image = request.media?.[0]
    const body: Record<string, string> = {
      message,
      access_token: accessToken,
    }
    let endpoint: string
    if (image) {
      endpoint = `${FACEBOOK_GRAPH_BASE}/${pageId}/photos`
      body.url = image.url
    } else {
      endpoint = `${FACEBOOK_GRAPH_BASE}/${pageId}/feed`
      if (request.facebook?.link) {
        body.link = request.facebook.link
      }
    }

    let response: Response
    try {
      response = await this.safeFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new SocialError(
        `Network error contacting Facebook: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'facebook', retryable: false }
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
        `Facebook API error ${response.status}: ${rawResponse}`,
        {
          httpStatus: response.status,
          platform: 'facebook',
          rawResponse,
          retryable: response.status === 429 || response.status >= 500,
        }
      )
    }

    let data: { id?: string; post_id?: string }
    try {
      data = await parseJsonBody<{ id?: string; post_id?: string }>(response)
    } catch (err) {
      throw new SocialError(
        `Facebook returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'facebook' }
      )
    }
    // A photo post returns both the photo `id` and the feed `post_id`; prefer
    // the feed post id so the returned URL points at the published post.
    const postId = data.post_id ?? data.id
    return {
      success: true,
      platform: 'facebook',
      postId,
      url: postId
        ? `https://www.facebook.com/${postId}`
        : undefined,
    }
  }
}
