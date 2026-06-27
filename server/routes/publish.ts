import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { accessTokenStore } from '../models/accessTokenStore.js';
import { resolveLinkedInAuthorId } from '../utils/platformOAuth.js';
import { LinkedInConnector } from '../../src/services/social/platforms/LinkedInConnector.js';
import { RedditConnector } from '../../src/services/social/platforms/RedditConnector.js';
import { TwitterConnector } from '../../src/services/social/platforms/TwitterConnector.js';
import { StaticCredentialProvider } from '../../src/services/social/types.js';
import type { SocialPostRequest } from '../../src/services/social/types.js';

const router = Router();

// ── Authentication guard ─────────────────────────────────────────────────────
router.use(requireAuth);

/**
 * POST /api/publish/:platform
 *
 * Publish a post to the specified platform.
 *
 * Body: {
 *   content: string,
 *   hashtags?: string[],
 *   linkedIn?: { authorId: string },                                          // required for LinkedIn
 *   reddit?: { subreddit: string | string[], title: string, nsfw?: boolean }, // required for Reddit
 *   twitter?: { ... },                // future
 *   facebook?: { ... },               // future
 *   instagram?: { ... }               // future
 * }
 */
router.post<{ platform: string }>('/:platform', async (req: Request<{ platform: string }>, res: Response): Promise<void> => {
  const userId = req.user!.sub;
  const { platform } = req.params;
  const { content, hashtags, linkedIn, twitter, reddit, facebook, instagram } = req.body as {
    content: string;
    hashtags?: string[];
    linkedIn?: { authorId: string };
    twitter?: Record<string, unknown>;
    reddit?: { subreddit?: string | string[]; title?: string; nsfw?: boolean };
    facebook?: Record<string, unknown>;
    instagram?: Record<string, unknown>;
  };

  console.log(
    `[publish] request: user=${userId} platform=${platform} contentLength=${content?.length ?? 0} ` +
      `options=${JSON.stringify({ linkedIn: !!linkedIn, twitter: !!twitter, reddit: !!reddit, facebook: !!facebook, instagram: !!instagram })}`,
  );

  // Validate platform
  const supportedPlatforms = ['linkedin', 'twitter', 'reddit', 'facebook', 'instagram'];
  if (!supportedPlatforms.includes(platform)) {
    console.error(`[publish] rejected: unknown platform "${platform}" (user=${userId})`);
    res.status(400).json({
      error: `Unknown platform. Valid platforms: ${supportedPlatforms.join(', ')}`,
      code: 'INVALID_PLATFORM',
    });
    return;
  }

  // Validate content
  if (!content || content.trim().length === 0) {
    console.error(`[publish] rejected: empty content (user=${userId} platform=${platform})`);
    res.status(400).json({
      error: 'Content is required',
      code: 'INVALID_CONTENT',
    });
    return;
  }

  try {
    // Get a usable access token. This warms the cache from the database on a
    // miss and transparently refreshes an expired token via its refresh token,
    // so the user does not have to reconnect when the short-lived token lapses.
    const accessToken = await accessTokenStore.getValidAccessToken(userId, platform);
    if (!accessToken) {
      console.error(
        `[publish] no usable ${platform} token for user=${userId} — returning 401 MISSING_TOKEN. ` +
          'See the [accessTokenStore] log lines above for the exact miss reason.',
      );
      res.status(401).json({
        error: `No access token found for ${platform}. Please connect your account first.`,
        code: 'MISSING_TOKEN',
      });
      return;
    }

    // Build the base post request. Platform-specific options (linkedIn, reddit)
    // are validated and merged in their respective `case` blocks below, so they
    // are intentionally not spread in here. Twitter/Facebook/Instagram carry no
    // extra request fields today.
    const postRequest: SocialPostRequest = {
      content,
      hashtags: hashtags ?? [],
    };

    // Create credential provider with the stored token
    const credentials = new StaticCredentialProvider(accessToken);

    // Select connector based on platform
    let postId: string | undefined;
    switch (platform) {
      case 'linkedin': {
        // The author ID (LinkedIn member URN) is resolved server-side during the
        // OAuth connect flow and stored alongside the token. Prefer the stored
        // value; fall back to one supplied in the request body for backwards
        // compatibility with clients that still send it from localStorage.
        let authorId = linkedIn?.authorId ?? accessTokenStore.getAuthorId(userId, 'linkedin') ?? undefined;
        if (!authorId) {
          // Connections made before author IDs were persisted have a token but no
          // stored URN. Resolve it on demand from the token and cache it so the
          // user does not have to reconnect.
          console.log(`[publish] no stored LinkedIn authorId for user=${userId} — resolving from access token`);
          authorId = await resolveLinkedInAuthorId(accessToken);
          if (authorId) {
            await accessTokenStore.setAuthorId(userId, 'linkedin', authorId);
            console.log(`[publish] resolved and stored LinkedIn authorId for user=${userId}`);
          }
        }
        if (!authorId) {
          console.error(
            `[publish] rejected: LinkedIn post without authorId (user=${userId}). ` +
              'No author ID was sent in the request and none is stored for this connection — reconnect LinkedIn to resolve the member URN.',
          );
          res.status(400).json({
            error: 'LinkedIn posts require an authorId (LinkedIn member URN)',
            code: 'MISSING_AUTHOR_ID',
          });
          return;
        }
        const connector = new LinkedInConnector();
        const result = await connector.post({ ...postRequest, linkedIn: { authorId } }, credentials);
        postId = result.postId;
        break;
      }
      case 'reddit': {
        // Validate Reddit-specific fields. `subreddit` accepts a single
        // subreddit name or an array of names.
        const hasSubreddit = Array.isArray(reddit?.subreddit)
          ? reddit.subreddit.length > 0
          : typeof reddit?.subreddit === 'string' && reddit.subreddit.trim().length > 0;
        if (!hasSubreddit) {
          console.error(`[publish] rejected: Reddit post without subreddit (user=${userId})`);
          res.status(400).json({
            error: 'Reddit posts require a subreddit (a name or non-empty array of names)',
            code: 'MISSING_SUBREDDIT',
          });
          return;
        }
        if (!reddit?.title || reddit.title.trim().length === 0) {
          console.error(`[publish] rejected: Reddit post without title (user=${userId})`);
          res.status(400).json({
            error: 'Reddit posts require a title',
            code: 'MISSING_TITLE',
          });
          return;
        }
        const connector = new RedditConnector();
        const result = await connector.post(
          {
            ...postRequest,
            // Both fields are guaranteed by the guards above.
            reddit: { subreddit: reddit!.subreddit!, title: reddit!.title!, nsfw: reddit!.nsfw },
          },
          credentials,
        );
        postId = result.postId;
        break;
      }
      case 'twitter': {
        // X/Twitter needs no extra fields — the tweet is content + hashtags,
        // posted as the authenticated account. The connector enforces the
        // 280-character limit before sending.
        const connector = new TwitterConnector();
        const result = await connector.post(postRequest, credentials);
        postId = result.postId;
        break;
      }
      // TODO: Add Facebook and Instagram connectors
      default:
        res.status(400).json({
          error: `Publishing to ${platform} is not yet implemented`,
          code: 'NOT_IMPLEMENTED',
        });
        return;
    }

    console.log(`[publish] success: user=${userId} platform=${platform} postId=${postId ?? 'unknown'}`);
    res.json({
      success: true,
      platform,
      postId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rawResponse =
      error instanceof Error && 'rawResponse' in error
        ? (error as Record<string, unknown>).rawResponse
        : undefined;
    console.error(
      `[publish] FAILED: user=${userId} platform=${platform} — ${message}` +
        (rawResponse ? `\n[publish] platform response body: ${String(rawResponse)}` : ''),
    );

    // Check if it's a known error type with status code
    if (error instanceof Error && 'httpStatus' in error) {
      const httpStatus = (error as Record<string, unknown>).httpStatus as number | undefined;
      res.status(httpStatus ?? 500).json({
        error: message,
        code: 'PLATFORM_ERROR',
        httpStatus,
      });
    } else {
      res.status(500).json({
        error: message,
        code: 'PUBLISH_FAILED',
      });
    }
  }
});

export default router;
