export type Platform = 'linkedin' | 'twitter' | 'reddit' | 'facebook' | 'instagram'

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed'

export type CampaignStatus = 'draft' | 'generating' | 'ready' | 'published'

/** Writing style for AI-generated posts. */
export type Tone = 'professional' | 'casual' | 'excited' | 'informative'

export interface GeneratedPost {
  id: string
  platform: Platform
  content: string
  hashtags: string[]
  status: PostStatus
  scheduledAt?: string
  publishedAt?: string
  engagements?: {
    likes: number
    comments: number
    shares: number
    views: number
  }
}

export interface Screenshot {
  id: string
  name: string
  url: string
  type: string
}

export interface Campaign {
  id: string
  name: string
  websiteUrl: string
  description: string
  status: CampaignStatus
  createdAt: string
  platforms: Platform[]
  screenshots: Screenshot[]
  posts: GeneratedPost[]
  tone: Tone
  targetAudience: string
  /**
   * Subreddits to post to when the campaign targets Reddit (bare names,
   * without "r/"). Required before a Reddit post can be published.
   */
  subreddits?: string[]
}

export interface PlatformConfig {
  id: Platform
  name: string
  icon: string
  color: string
  bgColor: string
  charLimit: number
  description: string
}
