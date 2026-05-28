import type { Platform } from '../../../types'
import { BaseSocialConnector } from '../BaseSocialConnector'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../types'
import { SocialError } from '../types'

/**
 * Instagram connector — publishes image posts via the Instagram Graph API.
 *
 * Instagram publishing requires a two-step process:
 *  1. Create a media container (returns a container ID).
 *  2. Publish the container (returns the final media ID).
 *
 * API reference: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
 *
 * Required permissions: instagram_basic, instagram_content_publish,
 *                        pages_read_engagement
 * Character limit: 2,200 characters (caption field)
 */
export const INSTAGRAM_GRAPH_BASE = 'https://graph.facebook.com/v18.0'
export const INSTAGRAM_CHAR_LIMIT = 2_200

export class InstagramConnector extends BaseSocialConnector {
  readonly platform: Platform = 'instagram'
  readonly charLimit = INSTAGRAM_CHAR_LIMIT

  /**
   * Publish an image post to Instagram.
   *
   * @param request     Must include `request.instagram.userId` and
   *                    `request.instagram.imageUrl`.
   * @param credentials User access token with instagram_content_publish scope.
   */
  async post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult> {
    const userId = request.instagram?.userId
    const imageUrl = request.instagram?.imageUrl
    if (!userId) {
      throw new SocialError(
        'Instagram post requires request.instagram.userId',
        { platform: 'instagram' }
      )
    }
    if (!imageUrl) {
      throw new SocialError(
        'Instagram post requires request.instagram.imageUrl',
        { platform: 'instagram' }
      )
    }

    const accessToken = await credentials.getAccessToken()

    // Enforce character limit before sending
    const { content, hashtags } = this.enforceLimit(
      request.content,
      request.hashtags ?? []
    )
    const caption = this.buildCombinedText(content, hashtags)

    // ── Step 1: Create media container ────────────────────────────────────────
    let containerResponse: Response
    try {
      containerResponse = await this.safeFetch(
        `${INSTAGRAM_GRAPH_BASE}/${userId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
        }
      )
    } catch (err) {
      throw new SocialError(
        `Network error creating Instagram media container: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'instagram', retryable: false }
      )
    }

    if (!containerResponse.ok) {
      let rawResponse = ''
      try {
        rawResponse = await containerResponse.text()
      } catch {
        // ignore read errors
      }
      throw new SocialError(
        `Instagram media container error ${containerResponse.status}: ${rawResponse}`,
        {
          httpStatus: containerResponse.status,
          platform: 'instagram',
          rawResponse,
          retryable: containerResponse.status === 429 || containerResponse.status >= 500,
        }
      )
    }

    const containerData = await containerResponse.json() as { id?: string }
    const creationId = containerData.id
    if (!creationId) {
      throw new SocialError(
        'Instagram media container creation returned no ID',
        { platform: 'instagram' }
      )
    }

    // ── Step 2: Publish the container ────────────────────────────────────────
    let publishResponse: Response
    try {
      publishResponse = await this.safeFetch(
        `${INSTAGRAM_GRAPH_BASE}/${userId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
        }
      )
    } catch (err) {
      throw new SocialError(
        `Network error publishing Instagram media: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'instagram', retryable: false }
      )
    }

    if (!publishResponse.ok) {
      let rawResponse = ''
      try {
        rawResponse = await publishResponse.text()
      } catch {
        // ignore read errors
      }
      throw new SocialError(
        `Instagram publish error ${publishResponse.status}: ${rawResponse}`,
        {
          httpStatus: publishResponse.status,
          platform: 'instagram',
          rawResponse,
          retryable: publishResponse.status === 429 || publishResponse.status >= 500,
        }
      )
    }

    const publishData = await publishResponse.json() as { id?: string }
    return {
      success: true,
      platform: 'instagram',
      postId: publishData.id,
      url: publishData.id
        ? `https://www.instagram.com/p/${publishData.id}/`
        : undefined,
    }
  }
}
