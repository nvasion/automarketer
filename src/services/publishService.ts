/**
 * Publish service — API client for publishing posts to social platforms.
 *
 * Handles communication with the /api/publish/* endpoints for actually
 * posting content to LinkedIn, Twitter, etc.
 */

interface PublishResponse {
  success: boolean;
  platform: string;
  postId?: string;
  timestamp: string;
}

/** An image attachment (publicly-fetchable URL) to include with the post. */
export interface PublishMedia {
  url: string;
  mimeType?: string;
}

interface PublishRequest {
  content: string;
  hashtags?: string[];
  media?: PublishMedia[];
  linkedIn?: {
    authorId: string;
  };
  twitter?: Record<string, unknown>;
  reddit?: Record<string, unknown>;
  facebook?: Record<string, unknown>;
  instagram?: Record<string, unknown>;
}

interface ErrorResponse {
  error?: string;
  code?: string;
  httpStatus?: number;
}

export class PublishError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

async function request<T>(platform: string, body: PublishRequest): Promise<T> {
  console.info(`[publishService] POST /api/publish/${platform} (contentLength=${body.content.length})`);
  const res = await fetch(`/api/publish/${encodeURIComponent(platform)}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let data: ErrorResponse & T;
  try {
    data = await res.json();
  } catch {
    console.error(`[publishService] ${platform} publish returned non-JSON response (HTTP ${res.status})`);
    throw new PublishError(
      res.ok ? 'Received non-JSON response from server' : 'Failed to publish post',
      undefined,
      res.status,
    );
  }

  if (!res.ok) {
    const err = data as ErrorResponse;
    console.error(
      `[publishService] ${platform} publish failed: HTTP ${res.status} code=${err.code ?? 'unknown'} — ${err.error ?? 'no error message'}`,
    );
    throw new PublishError(
      err.error ?? 'Failed to publish post',
      err.code,
      res.status,
    );
  }

  console.info(`[publishService] ${platform} publish succeeded`);
  return data;
}

export const publishService = {
  /**
   * Publish a post to LinkedIn.
   *
   * @param content - The post content
   * @param hashtags - Optional hashtags to append
   * @param authorId - LinkedIn member URN (e.g., "urn:li:person:abc123")
   */
  async publishToLinkedIn(
    content: string,
    hashtags: string[],
    authorId: string,
  ): Promise<PublishResponse> {
    return request<PublishResponse>('linkedin', {
      content,
      hashtags,
      linkedIn: { authorId },
    });
  },

  /**
   * Publish a post to any supported platform.
   *
   * @param platform - The platform to publish to
   * @param content - The post content
   * @param hashtags - Optional hashtags
   * @param platformOptions - Platform-specific options
   * @param media - Optional image attachments (publicly-fetchable URLs)
   */
  async publish(
    platform: string,
    content: string,
    hashtags: string[],
    platformOptions?: Record<string, unknown>,
    media?: PublishMedia[],
  ): Promise<PublishResponse> {
    const body: PublishRequest = {
      content,
      hashtags,
      ...(platformOptions && { [platform]: platformOptions }),
      ...(media && media.length > 0 && { media }),
    };
    return request<PublishResponse>(platform, body);
  },
};
