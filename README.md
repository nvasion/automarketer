# AutoMarketer

An AI-powered social media marketing campaign manager built with React and TypeScript. Create, manage, and analyze marketing campaigns across multiple platforms — LinkedIn, Twitter/X, Reddit, Facebook, and Instagram.

## Features

- **Dashboard** — Overview of key metrics: total campaigns, posts published, engagement rate, and total engagements
- **Campaign Management** — Create, list, filter, and view detailed campaign information
- **Multi-Step Campaign Wizard** — 4-step guided flow: enter website info → upload screenshots → select platforms & tone → review AI-generated content
- **Post Management** — View, edit, publish, and schedule posts per platform with character limit enforcement and engagement tracking
- **Scheduler** — Calendar interface to browse and manage scheduled and published posts by date
- **Analytics** — Weekly engagement bar charts, per-platform performance breakdowns, and top-performing posts table
- **Settings** — Configure profile, connected platforms, AI inference endpoint, and notification toggles
- **AI Content Generation** — Real AI-powered post generation via OpenRouter (100+ models) or any self-hosted OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, …). Falls back to built-in template content when no key is configured

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Language | TypeScript (strict mode) |
| Build Tool | Vite 5 |
| Routing | React Router v6 |
| Testing | Vitest + React Testing Library |
| Linting | ESLint + TypeScript ESLint |
| Containerisation | Docker + Compose v2 |
| Database | PostgreSQL 15 |
| Production server | nginx 1.25 |

## Getting Started

Two options: **Docker Compose** (recommended — zero local setup) or a **local Node.js** install.

---

### Option A — Docker Compose (recommended)

#### Prerequisites

- [Docker Desktop 4.x](https://www.docker.com/products/docker-desktop/) (includes Compose v2)  
  Verify with: `docker compose version`

#### 1. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set a secure `POSTGRES_PASSWORD`. That is all that is required to start the app.

To enable AI content generation, enter your API key **inside the running app** via **Settings → AI Settings** — not in `.env`. Putting a secret in a `VITE_*` variable bakes it into the compiled JavaScript bundle, making it trivially readable by anyone who opens DevTools. Keys entered through Settings are stored in browser localStorage and are never sent to AutoMarketer's own servers. See [Security](#security) below for details.

#### 2. Start all services

```bash
docker compose up --build
```

This single command:
- Builds the React dev server image
- Pulls the PostgreSQL 15 image
- Waits for the database to pass its health check before starting the app
- Mounts your source directory into the container for live hot-module reload

#### 3. Open the app

| Service | URL |
|---------|-----|
| React dev server | http://localhost:5173 |
| PostgreSQL | `localhost:5432` (use any DB client) |

#### Useful Docker commands

```bash
docker compose up --build        # start all services (rebuild images)
docker compose up -d             # start in detached (background) mode
docker compose down              # stop and remove containers
docker compose down -v           # stop and remove containers + volumes (wipes DB)
docker compose logs -f app       # tail app logs
docker compose logs -f db        # tail database logs
docker compose exec db psql -U postgres -d automarketer  # open psql shell
```

#### Production deployment

```bash
cp .env.example .env
# edit .env — set strong credentials; POSTGRES_PASSWORD is required

docker compose -f docker-compose.prod.yml up --build -d
```

The production compose file uses the `production` Dockerfile stage: TypeScript is compiled and bundled by Node, then served as static files by nginx on port 80. No Node.js or source code is present in the final image.

---

### Option B — Local Node.js

#### Prerequisites

- Node.js 18 or higher
- npm

#### Installation

```bash
npm install
```

#### Development

```bash
npm run dev
```

The app will be available at http://localhost:5173.

#### Building

```bash
npm run build      # Production build
npm run preview    # Preview the production build locally
```

#### Testing

```bash
npm test           # Run the full test suite once
npm run test:watch # Run tests in watch mode
```

#### Linting

```bash
npm run lint
```

## AI Content Generation

AutoMarketer generates platform-specific social media posts using a **pluggable inference client abstraction**.  The same `ContentGenerationService` works with any backend — just swap the client.

### Quick start: OpenRouter

1. Get a free API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Launch the app and go to **Settings → AI Settings → API Key**, then paste the key and click **Save Changes**

That's it. The next campaign you create will generate real, campaign-specific content across all selected platforms.

> **Why not use a `.env` variable?**  `VITE_*` variables are compiled into the JS bundle and are trivially readable by anyone who opens browser DevTools. Keys entered through Settings stay in browser `localStorage` and are never included in the build output.

### Using a custom / self-hosted endpoint

Any [OpenAI-compatible `/chat/completions` endpoint](https://platform.openai.com/docs/api-reference/chat) works — Ollama, vLLM, LM Studio, LocalAI, and others.

In **Settings → AI Settings**:
1. Switch provider to **Custom Endpoint**
2. Enter the **Endpoint URL** (e.g. `http://localhost:11434/v1` for Ollama)
3. Enter the **Model** name (e.g. `llama3`, `mistral`)
4. Optionally add an **API Key** if your endpoint requires one
5. Click **Save Changes**

### Fallback behaviour

When no API key or endpoint URL is configured the campaign wizard uses built-in template posts (one per platform) so the workflow remains fully usable without any backend.

### Service architecture

```
src/services/ai/
├── types.ts                  # InferenceProvider, InferenceRequest/Response, InferenceError
├── InferenceClient.ts        # Pluggable interface — implement this to add a new backend
├── OpenRouterClient.ts       # OpenRouter implementation (100+ models via one key)
├── CustomEndpointClient.ts   # OpenAI-compatible endpoint implementation
├── ContentGenerationService.ts  # Platform-aware prompts + hashtag parsing + char-limit enforcement
└── index.ts                  # Public exports + createInferenceClient() factory

src/config/aiConfig.ts        # AIConfig + ProviderConfig types, validation, localStorage persistence
src/hooks/useContentGeneration.ts  # React hook wrapping ContentGenerationService
```

The `AIConfig.providers` field is a `Record<InferenceProvider, ProviderConfig>` — adding a new backend requires only a new key in that record, keeping the root interface stable.

### Security

- API keys are entered by users in **Settings → AI Settings** and stored in browser `localStorage`.
- `localStorage` is readable by any same-origin JavaScript (XSS risk). Users should set **spending limits** on their API keys to cap potential exposure.
- A future backend proxy will allow keys to be stored server-side, eliminating this surface. See the security notice in the Settings UI for a live reminder.
- Custom endpoint URLs are validated to be `http://` or `https://` before saving (SSRF mitigation for a future server-side proxy).

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
│   │   ├── CreateCampaign.tsx# 4-step campaign creation wizard with real AI generation
│   │   ├── Scheduler.tsx     # Calendar view for scheduled and published posts
│   │   ├── Analytics.tsx     # Engagement charts and platform performance breakdown
│   │   └── Settings.tsx      # Profile, platforms, AI inference config, and notifications
│   ├── services/
│   │   ├── ai/               # AI inference abstraction layer (see above)
│   │   └── social/           # Social media posting connectors (see above)
│   ├── config/
│   │   └── aiConfig.ts       # AIConfig type + localStorage persistence
│   ├── hooks/
│   │   └── useContentGeneration.ts  # React hook for content generation
│   ├── data/
│   │   └── sampleData.ts     # Mock campaigns, platform configs, and global stats
│   ├── types.ts              # Shared TypeScript interfaces and type aliases
│   ├── App.tsx               # Root component with routing
│   ├── main.tsx              # React entry point
│   ├── App.css               # App-level styles
│   └── index.css             # Global styles
├── tests/
│   ├── services/ai/          # Unit tests for OpenRouterClient, CustomEndpointClient, ContentGenerationService
│   ├── services/social/      # Unit tests for BaseSocialConnector and all platform connectors
│   ├── config/               # Unit tests for aiConfig load/save/merge
│   ├── hooks/                # Tests for useContentGeneration hook
│   ├── App.test.tsx          # Tests for app shell and Dashboard rendering
│   └── Settings.test.tsx     # Tests for Settings page tabs and toggle behavior
├── Dockerfile                # Multi-stage build: development → builder → production (nginx)
├── docker-compose.yml        # Development: app + PostgreSQL with hot-module reload
├── docker-compose.prod.yml   # Production: pre-built nginx image + PostgreSQL
├── nginx.conf                # nginx SPA config — gzip, asset caching, and index.html fallback
├── .env.example              # Environment variable template (copy to .env)
├── .dockerignore             # Files excluded from the Docker build context
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

## Social Media Posting Connectors

AutoMarketer implements platform-specific posting connectors for all five supported social platforms.  Each connector enforces character limits, validates content, and calls the platform's official API.

### Architecture

```
src/services/social/
├── types.ts                 # SocialPostRequest/Result, ContentValidation, EnforcedContent, SocialError
├── SocialConnector.ts       # Pluggable interface — implement this to add a new platform
├── BaseSocialConnector.ts   # Shared char-limit utilities: validateContent(), enforceLimit()
├── platforms/
│   ├── LinkedInConnector.ts  # LinkedIn UGC Posts API v2 (3,000 chars)
│   ├── TwitterConnector.ts   # Twitter API v2 — create tweet (280 chars)
│   ├── RedditConnector.ts    # Reddit OAuth API — self post submission (40,000 chars)
│   ├── FacebookConnector.ts  # Facebook Graph API v18 — page feed (63,206 chars)
│   └── InstagramConnector.ts # Instagram Graph API v18 — two-step container+publish (2,200 chars)
└── index.ts                 # Public exports
```

### Character-limit enforcement

Every connector calls `enforceLimit()` before sending to the API, so oversized content is never submitted:

1. **Within limit** — content returned unchanged.
2. **Content too long** — truncated at the last word boundary; an ellipsis (…) is appended.
3. **Hashtags alone exceed the limit** — all hashtags are dropped and the content is truncated.

```typescript
import { LinkedInConnector } from './src/services/social'

const connector = new LinkedInConnector()

// Validate without modifying
const validation = connector.validateContent(content, hashtags)
// { valid: false, characterCount: 3250, limit: 3000, overflowBy: 250 }

// Enforce (truncate) to fit
const enforced = connector.enforceLimit(content, hashtags)
// { content: '...', hashtags: [...], truncated: true }

// Post via API (requires OAuth access token)
const result = await connector.post(
  {
    content,
    hashtags,
    linkedIn: { authorId: 'urn:li:person:abc123' },
  },
  accessToken
)
// { success: true, platform: 'linkedin', postId: 'urn:li:ugcPost:...' }
```

### API requirements per platform

| Platform | API | Required scope / permission |
|----------|-----|----------------------------|
| LinkedIn | LinkedIn REST API v2 — `/v2/ugcPosts` | `w_member_social` |
| Twitter/X | Twitter API v2 — `/2/tweets` | `tweet.write`, `users.read` |
| Reddit | Reddit OAuth API — `/api/submit` | `submit` |
| Facebook | Facebook Graph API v18 — `/{pageId}/feed` | `pages_manage_posts` |
| Instagram | Instagram Graph API v18 — `/{userId}/media` + `/{userId}/media_publish` | `instagram_content_publish` |

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
