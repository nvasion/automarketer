import type { Platform } from '../../../types'
import { BaseSocialConnector } from '../BaseSocialConnector'
import type { CredentialProvider, SocialPostRequest, SocialPostResult } from '../types'
import { SocialError } from '../types'

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

    const body = {
      author: authorId,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
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

    const data = await response.json() as { id?: string }
    return {
      success: true,
      platform: 'linkedin',
      postId: data.id,
    }
  }
}
