/**
 * Social media posting connectors.
 *
 * Each connector implements the SocialConnector interface and provides:
 *  - validateContent() — character-limit check without modification
 *  - enforceLimit()    — truncate content/hashtags to fit the platform limit
 *  - post()            — publish content via the platform's official API
 *
 * Platform character limits (from platform documentation):
 *  - LinkedIn:  3,000 characters
 *  - Twitter/X:   280 characters
 *  - Reddit:   40,000 characters
 *  - Facebook: 63,206 characters
 *  - Instagram:  2,200 characters
 */

export type { SocialConnector } from './SocialConnector'
export type { CredentialProvider } from './types'
export { StaticCredentialProvider } from './types'
export type { RetryConfig } from './types'
export { DEFAULT_RETRY_CONFIG } from './types'
export { BaseSocialConnector, buildCombinedText, truncateAtWordBoundary } from './BaseSocialConnector'
export type {
  ContentValidation,
  EnforcedContent,
  SocialPostRequest,
  SocialPostResult,
} from './types'
export { SocialError } from './types'

export { LinkedInConnector, LINKEDIN_API_BASE, LINKEDIN_CHAR_LIMIT } from './platforms/LinkedInConnector'
export { TwitterConnector, TWITTER_API_BASE, TWITTER_CHAR_LIMIT } from './platforms/TwitterConnector'
export { RedditConnector, REDDIT_API_BASE, REDDIT_CHAR_LIMIT } from './platforms/RedditConnector'
export { FacebookConnector, FACEBOOK_GRAPH_BASE, FACEBOOK_CHAR_LIMIT } from './platforms/FacebookConnector'
export { InstagramConnector, INSTAGRAM_GRAPH_BASE, INSTAGRAM_CHAR_LIMIT } from './platforms/InstagramConnector'
