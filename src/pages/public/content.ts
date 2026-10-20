// Copy shared by the public pages. Keep it true to what ships: anything not
// live yet goes in NEXT, not in the steps or features.

export interface Step {
  id: string
  title: string
  /** The page in the app where this happens, shown as "Settings → …". */
  where: string
  body: string
  /** Screenshot name in src/assets/shots, and the app path it shows. */
  shot?: { name: string; path: string; alt: string }
  points?: string[]
}

export const STEPS: Step[] = [
  {
    id: 'connect',
    title: 'Connect your accounts',
    where: 'Settings → Connected Platforms',
    body: 'Sign in to each network once with its own OAuth screen. AutoMarketer stores the access token for your account only, refreshes it when it expires, and never sees your password.',
    shot: { name: 'platforms', path: '/settings', alt: 'Settings, Connected Platforms: LinkedIn, X, Reddit, Facebook, Instagram and Bluesky with Connect buttons' },
    points: ['LinkedIn, X, Reddit, Facebook, Instagram and Bluesky', 'Bluesky uses AT Protocol OAuth with DPoP-bound tokens'],
  },
  {
    id: 'model',
    title: 'Bring your own AI model',
    where: 'Settings → AI Settings',
    body: 'Paste an OpenRouter key for 100+ models, or point AutoMarketer at any OpenAI-compatible endpoint such as Ollama, vLLM or LM Studio. Set the tone, emoji use, hashtags and creativity once.',
    shot: { name: 'ai', path: '/settings', alt: 'Settings, AI Settings: provider choice between OpenRouter and a custom endpoint, model, and generation preferences' },
    points: ['Your key stays in your browser and is never sent to AutoMarketer’s server', 'No key yet? The wizard writes template posts so you can try the whole flow'],
  },
  {
    id: 'describe',
    title: 'Describe what you’re marketing',
    where: 'New Campaign → Website info',
    body: 'Give the campaign a name, the website it promotes and a few sentences about it. Add screenshots of the product if you have them; they travel with the campaign.',
    shot: { name: 'wizard-info', path: '/create', alt: 'New Campaign wizard, step 1: campaign name, website URL and description' },
  },
  {
    id: 'platforms',
    title: 'Pick the platforms and the tone',
    where: 'New Campaign → Platforms & tone',
    body: 'Choose where the campaign goes and how it should sound: professional, casual, excited or informative. For Reddit, list the subreddits to post to.',
    shot: { name: 'wizard-platforms', path: '/create', alt: 'New Campaign wizard, step 3: platform cards and tone choices' },
  },
  {
    id: 'review',
    title: 'Review a post for every platform',
    where: 'New Campaign → Generated content',
    body: 'AutoMarketer writes one post per platform, each in that network’s voice and within its limit: 280 characters on X, 3,000 on LinkedIn, 2,200 on Instagram. Edit anything before you save.',
    shot: { name: 'wizard-review', path: '/create', alt: 'New Campaign wizard, step 4: a generated post for each selected platform with character counts' },
    points: ['Long posts are trimmed at a word boundary, never mid-word', 'Hashtags are kept whole: the post text is trimmed around them'],
  },
  {
    id: 'publish',
    title: 'Publish and follow the results',
    where: 'Campaign → Publish All',
    body: 'Publish the whole campaign with Publish All, or one post at a time, through each platform’s official API. The dashboard, calendar and analytics then show what went out, where, and how it did.',
    shot: { name: 'campaign', path: '/campaigns', alt: 'A campaign page with a Publish All button, its platforms, post counts and each post with its status' },
    points: ['Reddit posts to several subreddits; a partial failure is never retried, so nothing posts twice'],
  },
]

export const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'One brief, every network',
    body: 'Write the campaign once. AutoMarketer turns it into a post for each platform you pick, in that platform’s voice and length.',
  },
  {
    title: 'Your model, your keys',
    body: 'OpenRouter or any OpenAI-compatible endpoint, including models you host yourself. Keys stay in your browser; only your style preferences sync.',
  },
  {
    title: 'Official APIs only',
    body: 'Every post goes out through the platform’s own API on an OAuth connection you approved, so you can revoke it from the platform at any time.',
  },
  {
    title: 'Limits handled for you',
    body: 'Character limits are enforced before anything is sent. Long posts are trimmed at a word boundary, keeping your hashtags whenever they fit.',
  },
  {
    title: 'Calendar and analytics',
    body: 'See every scheduled and published post on a calendar, with engagement by week and by platform, and your best-performing posts.',
  },
  {
    title: 'Part of TynHub',
    body: 'AutoMarketer is a TynHub product, alongside Routini. It will cross-post into TynHub xibits as the network opens.',
  },
]

export const SHIPPED = [
  'Campaign wizard: brief, screenshots, platforms and tone, generated posts',
  'One-click OAuth for LinkedIn, X, Reddit, Facebook, Instagram and Bluesky',
  'Publishing through each platform’s official API, with limits enforced',
  'Reddit campaigns across several subreddits',
  'OpenRouter and custom OpenAI-compatible endpoints, with a template fallback',
  'Dashboard, calendar and analytics',
  'Accounts with campaigns stored per user',
]

export const NEXT = [
  'Automatic publishing at the scheduled time (the posting queue is built and tested)',
  'Cross-posting into TynHub xibits',
  'Sign in with TynHub across the network',
  'Model keys stored server-side, behind a proxy',
]

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Do I need an AI key to try it?',
    a: 'No. Without a key the wizard writes template posts for each platform, so you can go through the whole flow. Add an OpenRouter key or your own endpoint in Settings → AI Settings when you want posts written for your campaign.',
  },
  {
    q: 'Where does my AI key go?',
    a: 'It stays in your browser’s local storage and is sent only to the model provider you chose. It is never sent to AutoMarketer’s server. Set a spending limit on the key at your provider, as you would for any key used in a browser.',
  },
  {
    q: 'Does AutoMarketer get my social media passwords?',
    a: 'No. You sign in on each platform’s own page and approve access; AutoMarketer receives an access token, stored for your account only. You can revoke it from the platform at any time.',
  },
  {
    q: 'Which platforms, and what are the limits?',
    a: 'LinkedIn (3,000 characters), X (280), Reddit (40,000), Facebook (63,206), Instagram (2,200) and Bluesky (300). Each post is checked against its platform’s limit before it is sent.',
  },
  {
    q: 'Can posts go out on a schedule?',
    a: 'The calendar shows scheduled and published posts today, and you publish with Publish now. Automatic publishing at the scheduled time is next: the queue behind it, with retries and per-platform rate limits, is built and tested.',
  },
]
