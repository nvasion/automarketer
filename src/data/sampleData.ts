import { Campaign, PlatformConfig } from '../types'

export const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: 'in',
    color: '#ffffff',
    bgColor: '#0077B5',
    charLimit: 3000,
    description: 'Professional network — great for B2B content',
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    icon: '𝕏',
    color: '#ffffff',
    bgColor: '#000000',
    charLimit: 280,
    description: 'Fast-moving conversations and trending topics',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    icon: 'r/',
    color: '#ffffff',
    bgColor: '#FF4500',
    charLimit: 40000,
    description: 'Community-driven discussions and long-form posts',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: 'f',
    color: '#ffffff',
    bgColor: '#1877F2',
    charLimit: 63206,
    description: 'Wide audience reach and community building',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: '⬛',
    color: '#ffffff',
    bgColor: '#E1306C',
    charLimit: 2200,
    description: 'Visual-first storytelling and brand awareness',
  },
]

export const SAMPLE_CAMPAIGNS: Campaign[] = [
  {
    id: 'camp-001',
    name: 'Acme SaaS Product Launch',
    websiteUrl: 'https://acme.io',
    description: 'Launch campaign for our new project management SaaS platform targeting startup teams.',
    status: 'published',
    createdAt: '2026-05-10T09:00:00Z',
    tone: 'excited',
    targetAudience: 'Startup founders and product managers',
    platforms: ['linkedin', 'twitter', 'reddit'],
    screenshots: [
      { id: 'ss-1', name: 'dashboard.png', url: '', type: 'image/png' },
      { id: 'ss-2', name: 'features.png', url: '', type: 'image/png' },
    ],
    posts: [
      {
        id: 'post-001-li',
        platform: 'linkedin',
        content:
          "🚀 Excited to announce the launch of Acme — the project management platform built for modern startup teams!\n\nWe spent 18 months talking to 300+ founders and PMs to understand what truly slows teams down. The answer? Context switching, status meetings, and scattered tools.\n\nAcme brings everything together:\n✅ Real-time task boards with AI-assisted prioritization\n✅ One-click standup reports sent automatically\n✅ Deep integrations with Slack, GitHub, and Figma\n\nWe're opening up our beta today — completely free for teams under 10. Join 500+ teams already shipping faster.\n\n👇 Drop a comment or DM me for early access.",
        hashtags: ['#ProductLaunch', '#SaaS', '#ProjectManagement', '#Startup', '#Productivity'],
        status: 'published',
        publishedAt: '2026-05-12T10:00:00Z',
        engagements: { likes: 312, comments: 47, shares: 89, views: 4200 },
      },
      {
        id: 'post-001-tw',
        platform: 'twitter',
        content:
          "We just launched Acme — project management that doesn't suck 🚀\n\n→ AI-powered task prioritization\n→ Auto standup reports\n→ Works with your existing stack\n\nFree for teams under 10. Beta is live now 👇\nacme.io",
        hashtags: ['#buildinpublic', '#SaaS', '#startups'],
        status: 'published',
        publishedAt: '2026-05-12T10:05:00Z',
        engagements: { likes: 891, comments: 134, shares: 276, views: 18400 },
      },
      {
        id: 'post-001-rd',
        platform: 'reddit',
        content:
          "After 18 months of building and talking to 300+ startup teams, we just launched Acme publicly.\n\n**What problem we're solving:** The average PM spends 40% of their time on status updates and context-gathering rather than actual planning. We built Acme to automate the boring parts.\n\n**What makes it different:**\n- AI prioritization that learns your team's patterns\n- Automated standup reports (connect Slack, done)\n- A clean kanban that doesn't have 50 features you'll never use\n\nWe're free for teams under 10 people during beta. Would love brutal feedback from this community — what would make you actually switch from your current tool?",
        hashtags: [],
        status: 'published',
        publishedAt: '2026-05-12T10:10:00Z',
        engagements: { likes: 203, comments: 68, shares: 12, views: 3100 },
      },
    ],
  },
  {
    id: 'camp-002',
    name: 'HealthTrack App Awareness',
    websiteUrl: 'https://healthtrack.app',
    description: 'Awareness campaign for a personal health tracking mobile app.',
    status: 'ready',
    createdAt: '2026-05-15T14:30:00Z',
    tone: 'informative',
    targetAudience: 'Health-conscious adults aged 25-45',
    platforms: ['linkedin', 'twitter', 'instagram'],
    screenshots: [
      { id: 'ss-3', name: 'app-home.png', url: '', type: 'image/png' },
    ],
    posts: [
      {
        id: 'post-002-li',
        platform: 'linkedin',
        content:
          "📊 Did you know that 80% of people who track their health metrics consistently report better long-term outcomes?\n\nHealthTrack makes it simple to monitor what matters — sleep quality, nutrition, activity, and mental wellness — all in one place.\n\nOur new dashboard gives you a weekly health score with personalized recommendations backed by peer-reviewed research. No fads, no gimmicks.\n\nIf you're serious about your health in 2026, give HealthTrack a try. 14-day free trial, no credit card required.",
        hashtags: ['#HealthTech', '#Wellness', '#DigitalHealth', '#PersonalHealth'],
        status: 'scheduled',
        scheduledAt: '2026-05-20T09:00:00Z',
      },
      {
        id: 'post-002-tw',
        platform: 'twitter',
        content:
          "Your health data is scattered across 6 different apps 🤯\n\nHealthTrack brings it all together:\n• Sleep from Apple Watch\n• Nutrition from MyFitnessPal\n• Activity from Strava\n\nOne score. One dashboard. Clearer picture.\n\nFree 14-day trial 👇 healthtrack.app",
        hashtags: ['#health', '#wellness', '#quantifiedself'],
        status: 'scheduled',
        scheduledAt: '2026-05-20T09:05:00Z',
      },
      {
        id: 'post-002-ig',
        platform: 'instagram',
        content:
          "Your body is telling you something every single day 💪\n\nAre you listening?\n\nHealthTrack gives you a clear picture of your sleep, nutrition, activity, and mental wellness — with science-backed insights to help you feel your best.\n\nSwipe to see how your weekly health score works ➡️\n\nLink in bio for your free 14-day trial.",
        hashtags: ['#health', '#wellness', '#healthylifestyle', '#fittech', '#selfcare', '#healthapp', '#mindfulness'],
        status: 'draft',
      },
    ],
  },
  {
    id: 'camp-003',
    name: 'DevTools CLI Release',
    websiteUrl: 'https://devtools.dev',
    description: 'Developer community outreach for a new CLI toolchain release.',
    status: 'generating',
    createdAt: '2026-05-17T11:00:00Z',
    tone: 'casual',
    targetAudience: 'Software developers and DevOps engineers',
    platforms: ['twitter', 'reddit'],
    screenshots: [],
    posts: [
      {
        id: 'post-003-tw',
        platform: 'twitter',
        content:
          "Just shipped devtools v2.0 🛠️\n\nBiggest release yet:\n→ 3× faster builds\n→ Native TypeScript support (no config)\n→ Plugin marketplace with 200+ tools\n\nBreaking changes? Minimal. Migration guide: 5 steps.\n\nFull changelog: devtools.dev/v2",
        hashtags: ['#devtools', '#typescript', '#opensource', '#developer'],
        status: 'draft',
      },
      {
        id: 'post-003-rd',
        platform: 'reddit',
        content:
          "**devtools v2.0 is out — here's what we changed and why**\n\nHey r/programming! After 6 months of work and over 400 GitHub issues, we've shipped devtools v2.0.\n\n**The headline changes:**\n\n1. **3× faster build times** — We rewrote the core compiler in Rust. Yes, it was worth it.\n2. **Native TypeScript support** — Zero config. Drop it in, it just works.\n3. **Plugin marketplace** — 200+ community plugins, curated and security-scanned.\n\n**What we didn't break (intentionally):**\nAll v1.x configs still work. We have a 5-step migration guide if you're using any deprecated APIs.\n\nWould love questions, feedback, and bug reports. The team is watching this thread all day.",
        hashtags: [],
        status: 'draft',
      },
    ],
  },
]

export const STATS = {
  totalCampaigns: 12,
  activeCampaigns: 4,
  totalPostsPublished: 47,
  totalEngagements: 128400,
  avgEngagementRate: 4.2,
  topPlatform: 'twitter' as const,
}
