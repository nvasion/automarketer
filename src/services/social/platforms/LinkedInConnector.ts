import type { Platform } from '../../../types'
import { BaseSocialConnector } from '../BaseSocialConnector'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../types'
import { SocialError } from '../types'
import { parseJsonBody } from '../../../utils/http'

/**
 * LinkedIn connector — posts text updates via the LinkedIn UGC Posts API.
 *
 * API reference: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
 *
 * Required OAuth 2.0 scopes: w_member_social (personal posts)
 * Character limit: 3,000 characters (combined content + hashtags)
 */
export const LINKEDIN_API_BASE = 'https://api.linkedin.com'
export const LINKEDIN_CHAR_LIMIT = 3_000

export class LinkedInConnector extends BaseSocialConnector {
  readonly platform: Platform = 'linkedin'
  readonly charLimit = LINKEDIN_CHAR_LIMIT

  /**
   * Publish a text post (UGC share) to LinkedIn.
   *
   * @param request     Must include `request.linkedIn.authorId` — the LinkedIn
   *                    member URN, e.g. "urn:li:person:abc123".
   * @param credentials Credential provider supplying a w_member_social access token.
   */
  async post(request: SocialPostRequest, credentials: CredentialProvider): Promise<SocialPostResult> {
    const authorId = request.linkedIn?.authorId
    if (!authorId) {
      throw new SocialError(
        'LinkedIn post requires request.linkedIn.authorId (member URN)',
        { platform: 'linkedin' }
      )
    }

    const accessToken = await credentials.getAccessToken()

    // Enforce character limit before sending
    const { content, hashtags } = this.enforceLimit(
      request.content,
      request.hashtags ?? []
    )
    const text = this.buildCombinedText(content, hashtags)

    const shareContent: Record<string, unknown> = {
      shareCommentary: { text },
      shareMediaCategory: 'NONE',
    }

    // Attach the first image, if any: register an upload, PUT the bytes, then
    // reference the returned asset URN as IMAGE media on the share.
    const image = request.media?.[0]
    if (image) {
      const asset = await this.uploadImage(authorId, accessToken, image.url)
      shareContent.shareMediaCategory = 'IMAGE'
      shareContent.media = [{ status: 'READY', media: asset }]
    }

    const body = {
      author: authorId,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': shareContent,
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    }

    let response: Response
    try {
      response = await this.safeFetch(`${LINKEDIN_API_BASE}/v2/ugcPosts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new SocialError(
        `Network error contacting LinkedIn: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'linkedin', retryable: false }
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
        `LinkedIn API error ${response.status}: ${rawResponse}`,
        {
          httpStatus: response.status,
          platform: 'linkedin',
          rawResponse,
          retryable: response.status === 429 || response.status >= 500,
        }
      )
    }

    let data: { id?: string }
    try {
      data = await parseJsonBody<{ id?: string }>(response)
    } catch (err) {
      throw new SocialError(
        `LinkedIn returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'linkedin' }
      )
    }
    return {
      success: true,
      platform: 'linkedin',
      postId: data.id,
    }
  }

  /**
   * Upload an image to LinkedIn and return its asset URN.
   *
   * Two steps per the Assets API:
   *   1. registerUpload → returns an upload URL and the asset URN.
   *   2. POST the image bytes to that upload URL.
   * The asset URN is then referenced as IMAGE media on the UGC share.
   */
  private async uploadImage(authorId: string, accessToken: string, imageUrl: string): Promise<string> {
    // ── Step 1: register the upload ──────────────────────────────────────────
    let registerResponse: Response
    try {
      registerResponse = await this.safeFetch(`${LINKEDIN_API_BASE}/v2/assets?action=registerUpload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: authorId,
            serviceRelationships: [
              { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
            ],
          },
        }),
      })
    } catch (err) {
      throw new SocialError(
        `Network error registering LinkedIn upload: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'linkedin', retryable: false }
      )
    }

    if (!registerResponse.ok) {
      let rawResponse = ''
      try {
        rawResponse = await registerResponse.text()
      } catch {
        // ignore read errors
      }
      throw new SocialError(`LinkedIn registerUpload error ${registerResponse.status}: ${rawResponse}`, {
        httpStatus: registerResponse.status,
        platform: 'linkedin',
        rawResponse,
        retryable: registerResponse.status === 429 || registerResponse.status >= 500,
      })
    }

    let register: {
      value?: {
        asset?: string
        uploadMechanism?: {
          'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: { uploadUrl?: string }
        }
      }
    }
    try {
      register = await parseJsonBody(registerResponse)
    } catch (err) {
      throw new SocialError(
        `LinkedIn registerUpload returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'linkedin' }
      )
    }

    const asset = register.value?.asset
    const uploadUrl =
      register.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']
        ?.uploadUrl
    if (!asset || !uploadUrl) {
      throw new SocialError('LinkedIn registerUpload returned no asset or upload URL', {
        platform: 'linkedin',
      })
    }

    // ── Step 2: upload the image bytes ───────────────────────────────────────
    const { blob } = await this.fetchMediaBlob(imageUrl)
    let uploadResponse: Response
    try {
      uploadResponse = await this.safeFetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: blob,
      })
    } catch (err) {
      throw new SocialError(
        `Network error uploading image to LinkedIn: ${err instanceof Error ? err.message : String(err)}`,
        { platform: 'linkedin', retryable: false }
      )
    }
    if (!uploadResponse.ok) {
      let rawResponse = ''
      try {
        rawResponse = await uploadResponse.text()
      } catch {
        // ignore read errors
      }
      throw new SocialError(`LinkedIn image upload error ${uploadResponse.status}: ${rawResponse}`, {
        httpStatus: uploadResponse.status,
        platform: 'linkedin',
        rawResponse,
        retryable: uploadResponse.status === 429 || uploadResponse.status >= 500,
      })
    }

    return asset
  }
}
