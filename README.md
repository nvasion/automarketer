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
- **Authentication** — Secure registration and login with bcrypt password hashing (12 rounds) and JWT session management via httpOnly cookies; all app routes are protected and redirect to `/login` when unauthenticated
- **AI Content Generation** — Real AI-powered post generation via OpenRouter (100+ models) or any self-hosted OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, …). Falls back to built-in template content when no key is configured

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Language | TypeScript (strict mode) |
| Build Tool | Vite 5 |
| Routing | React Router v6 |
| Backend API | Express 5 |
| Authentication | JSON Web Tokens (JWT) + bcryptjs |
| Testing | Vitest + React Testing Library + Supertest |
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

Run both the React dev server and the Express API server together:

```bash
npm run dev:full
```

Or start them separately in two terminals:

```bash
npm run dev          # Vite dev server → http://localhost:5173
npm run dev:server   # Express API     → http://localhost:3001
```

Vite proxies `/api/*` requests to the Express server, so frontend code always calls `/api/auth/...` with no cross-origin issues.

#### Building

```bash
npm run build          # Production build (frontend)
npm run build:server   # Compile Express server TypeScript
npm run preview        # Preview the production frontend build locally
```

#### Testing

The test suite covers both frontend components (React Testing Library in jsdom) and backend API routes (Supertest in Node):

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
├── server/                   # Express API server
│   ├── app.ts                # Express app factory (exported for Supertest)
│   ├── index.ts              # Server entry point (binds to PORT)
│   ├── types.ts              # Shared server TypeScript interfaces + Express.Request augmentation
│   ├── middleware/
│   │   └── auth.ts           # requireAuth middleware — verifies JWT from httpOnly cookie
│   ├── models/
│   │   └── userStore.ts      # In-memory user store (replace with DB ORM in next phase)
│   ├── routes/
│   │   └── auth.ts           # POST /register, POST /login, POST /logout, GET /me
│   └── utils/
│       └── config.ts         # jwtSecret() helper with fail-fast production guard
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── Header.tsx        # Top navigation header
│   │   ├── Sidebar.tsx       # Main navigation sidebar with active-route highlighting
│   │   ├── PostCard.tsx      # Post display with platform info, status, actions, and engagement metrics
│   │   ├── PlatformBadge.tsx # Platform icon badge (sm/md/lg sizes)
│   │   ├── StatusBadge.tsx   # Color-coded status indicator (draft, generating, ready, published, etc.)
│   │   └── ProtectedRoute.tsx# Redirects unauthenticated users to /login; shows null while loading
│   ├── contexts/
│   │   └── AuthContext.tsx   # React auth context: user state, login, register, logout via cookie session
│   ├── pages/                # Route-level page components
│   │   ├── Login.tsx         # Sign-in form
│   │   ├── Register.tsx      # Account creation form
│   │   ├── Dashboard.tsx     # Home page with stat cards, recent campaigns, and platform performance
│   │   ├── CampaignList.tsx  # Campaign browser with search and status filters
│   │   ├── CampaignDetail.tsx# Single campaign view with tabbed posts by platform
│   │   ├── CreateCampaign.tsx# 4-step campaign creation wizard with real AI generation
│   │   ├── Scheduler.tsx     # Calendar view for scheduled and published posts
│   │   ├── Analytics.tsx     # Engagement charts and platform performance breakdown
│   │   └── Settings.tsx      # Profile, platforms, AI inference config, and notifications
│   ├── services/
│   │   ├── authService.ts    # fetch wrappers for /api/auth/* — uses httpOnly cookies via credentials:'include'
│   │   └── ai/               # AI inference abstraction layer (see above)
│   ├── config/
│   │   └── aiConfig.ts       # AIConfig type + localStorage persistence
│   ├── hooks/
│   │   └── useContentGeneration.ts  # React hook for content generation
│   ├── data/
│   │   └── sampleData.ts     # Mock campaigns, platform configs, and global stats
│   ├── types.ts              # Shared TypeScript interfaces and type aliases
│   ├── App.tsx               # Root component with routing (public + protected routes)
│   ├── main.tsx              # React entry point (wraps app in AuthProvider + BrowserRouter)
│   ├── App.css               # App-level styles
│   └── index.css             # Global styles
├── tests/
│   ├── auth.server.test.ts   # Supertest integration tests for register/login/logout/me routes
│   ├── Login.test.tsx        # Login page form behaviour and error handling
│   ├── Register.test.tsx     # Register page form validation and submission
│   ├── services/ai/          # Unit tests for OpenRouterClient, CustomEndpointClient, ContentGenerationService
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
├── vite.config.ts            # Vite configuration (with /api proxy to PORT 3001)
├── vitest.config.ts          # Vitest configuration (jsdom for frontend, node for server tests)
├── tsconfig.json             # TypeScript configuration (frontend)
└── tsconfig.server.json      # TypeScript configuration (server — targets Node ESM)
```

## Routes

### Public (no authentication required)

| Path | Page | Description |
|------|------|-------------|
| `/login` | Login | Sign-in form |
| `/register` | Register | Account creation form |

### Protected (redirect to `/login` when unauthenticated)

| Path | Page | Description |
|------|------|-------------|
| `/` | Dashboard | Home with metrics and recent campaigns |
| `/campaigns` | Campaign List | Browse and filter all campaigns |
| `/campaigns/:id` | Campaign Detail | View and manage posts for a single campaign |
| `/create` | Create Campaign | Step-by-step campaign creation wizard |
| `/scheduler` | Scheduler | Calendar view of scheduled/published posts |
| `/analytics` | Analytics | Engagement charts and performance data |
| `/settings` | Settings | User profile, platforms, AI, and notifications |

## API Endpoints

The Express server runs on port `3001` and is proxied by Vite under `/api/*` during development.

| Method | Path | Auth required | Description |
|--------|------|---------------|-------------|
| `POST` | `/api/auth/register` | No | Create a new account; sets an `httpOnly` `auth_token` cookie on success; returns `{ user }` |
| `POST` | `/api/auth/login` | No | Sign in; sets an `httpOnly` `auth_token` cookie on success; returns `{ user }` |
| `POST` | `/api/auth/logout` | No | Clears the `auth_token` cookie server-side |
| `GET` | `/api/auth/me` | `auth_token` cookie | Returns the current user's public profile |
| `GET` | `/api/health` | No | Service health check |

> **Security note:** Tokens are stored exclusively in `httpOnly` cookies set by the server. No token is ever placed in the JSON response body or `localStorage`, which eliminates XSS-based session-hijacking risk. The browser attaches the cookie automatically on every request via `credentials: 'include'`.

### Authentication rate limiting

All `/api/auth/*` routes are protected by a rate limiter: **20 requests per 15-minute window per IP**. Exceeding the limit returns `429 Too Many Requests`.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `dev-secret-change-in-production` | Secret used to sign JWTs — **must be overridden in production** (e.g. `openssl rand -hex 64`) |
| `PORT` | `3001` | Express API server port |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin (must be set in production) |

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
