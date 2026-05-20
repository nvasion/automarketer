# AutoMarketer

An AI-powered social media marketing campaign manager built with React and TypeScript. Create, manage, and analyze marketing campaigns across multiple platforms — LinkedIn, Twitter/X, Reddit, Facebook, and Instagram.

## Features

- **Dashboard** — Overview of key metrics: total campaigns, posts published, engagement rate, and total engagements
- **Campaign Management** — Create, list, filter, and view detailed campaign information
- **Multi-Step Campaign Wizard** — 4-step guided flow: enter website info → upload screenshots → select platforms & tone → review AI-generated content
- **Post Management** — View, edit, publish, and schedule posts per platform with character limit enforcement and engagement tracking
- **Scheduler** — Calendar interface to browse and manage scheduled and published posts by date
- **Analytics** — Weekly engagement bar charts, per-platform performance breakdowns, and top-performing posts table
- **Settings** — Configure profile, connected platforms, AI model preferences, and notification toggles

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Language | TypeScript (strict mode) |
| Build Tool | Vite 5 |
| Routing | React Router v6 |
| Testing | Vitest + React Testing Library |
| Linting | ESLint + TypeScript ESLint |

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at http://localhost:5173.

### Building

```bash
npm run build      # Production build
npm run preview    # Preview the production build locally
```

### Testing

```bash
npm test           # Run the full test suite once
npm run test:watch # Run tests in watch mode
```

### Linting

```bash
npm run lint
```

## Project Structure

```
automarketer/
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── Header.tsx        # Top navigation header
│   │   ├── Sidebar.tsx       # Main navigation sidebar with active-route highlighting
│   │   ├── PostCard.tsx      # Post display with platform info, status, actions, and engagement metrics
│   │   ├── PlatformBadge.tsx # Platform icon badge (sm/md/lg sizes)
│   │   └── StatusBadge.tsx   # Color-coded status indicator (draft, generating, ready, published, etc.)
│   ├── pages/                # Route-level page components
│   │   ├── Dashboard.tsx     # Home page with stat cards, recent campaigns, and platform performance
│   │   ├── CampaignList.tsx  # Campaign browser with search and status filters
│   │   ├── CampaignDetail.tsx# Single campaign view with tabbed posts by platform
│   │   ├── CreateCampaign.tsx# 4-step campaign creation wizard
│   │   ├── Scheduler.tsx     # Calendar view for scheduled and published posts
│   │   ├── Analytics.tsx     # Engagement charts and platform performance breakdown
│   │   └── Settings.tsx      # Profile, platforms, AI, and notification settings
│   ├── data/
│   │   └── sampleData.ts     # Mock campaigns, platform configs, and global stats
│   ├── types.ts              # Shared TypeScript interfaces and type aliases
│   ├── App.tsx               # Root component with routing
│   ├── main.tsx              # React entry point
│   ├── App.css               # App-level styles
│   └── index.css             # Global styles
├── tests/
│   ├── App.test.tsx          # Tests for app shell and Dashboard rendering
│   └── Settings.test.tsx     # Tests for Settings page tabs and toggle behavior
├── index.html                # HTML entry point
├── vite.config.ts            # Vite configuration
├── vitest.config.ts          # Vitest configuration
└── tsconfig.json             # TypeScript configuration
```

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | Dashboard | Home with metrics and recent campaigns |
| `/campaigns` | Campaign List | Browse and filter all campaigns |
| `/campaigns/:id` | Campaign Detail | View and manage posts for a single campaign |
| `/create` | Create Campaign | Step-by-step campaign creation wizard |
| `/scheduler` | Scheduler | Calendar view of scheduled/published posts |
| `/analytics` | Analytics | Engagement charts and performance data |
| `/settings` | Settings | User profile, platforms, AI, and notifications |

## Key Types

```typescript
type Platform = 'linkedin' | 'twitter' | 'reddit' | 'facebook' | 'instagram';
type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed';
type CampaignStatus = 'draft' | 'generating' | 'ready' | 'published';

interface Campaign {
  id: string;
  name: string;
  websiteUrl: string;
  description: string;
  status: CampaignStatus;
  createdAt: string;
  platforms: Platform[];
  posts: GeneratedPost[];
  tone: string;
  targetAudience?: string;
}

interface GeneratedPost {
  id: string;
  platform: Platform;
  content: string;
  hashtags: string[];
  status: PostStatus;
  scheduledAt?: string;
  publishedAt?: string;
  engagements?: { likes: number; comments: number; shares: number; views: number };
}
```

## Supported Platforms

| Platform | Character Limit |
|----------|----------------|
| LinkedIn | 3,000 |
| Twitter/X | 280 |
| Reddit | 40,000 |
| Facebook | 63,206 |
| Instagram | 2,200 |

## License

MIT
