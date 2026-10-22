// DRAFT - pending owner review before deploy.
//
// Copy for /privacy and /terms, as structured sections (rendered by
// LegalPage.tsx). The privacy policy describes what the code actually stores
// (server/db/*Table.ts, server/models/accessTokenStore.ts, server/routes/*);
// change it together with the code. Any occurrence of LEGAL_CONTACT in the
// text is rendered as a mailto link.

export const LEGAL_CONTACT = 'privacy@notify.tynhub.com'
export const LEGAL_UPDATED = 'October 2026'

export interface LegalSection {
  id: string
  heading: string
  paragraphs?: string[]
  items?: string[]
  /** Text after the list. */
  after?: string[]
}

export interface LegalDoc {
  title: string
  lead: string
  sections: LegalSection[]
}

export const PRIVACY: LegalDoc = {
  title: 'Privacy policy',
  lead: 'AutoMarketer is a TynHub product. This policy explains what AutoMarketer stores when you use it, why, who else handles it, and how to remove it.',
  sections: [
    {
      id: 'what-we-store',
      heading: 'What we store',
      items: [
        'Your account: your email address and a bcrypt hash of your password. We never store the password itself, and we do not ask for your name; the app shows one derived from your email address.',
        'Your campaigns: name, website, description, tone, platforms, subreddits, the posts generated for each platform and your edits, their status, scheduled times and publishing results.',
        'Images you add to a campaign, so platforms can fetch them when you publish. Each image is served at an unguessable public address: anyone with that link can open it.',
        'Connected social accounts: for each platform you connect, the access token, the refresh token and expiry where the platform issues them, and the account identifier it returns (for example your LinkedIn member ID, or your Bluesky DID and server). For LinkedIn we also read the pages you manage, so you can post as one of them.',
        'Your AI generation preferences (tone, emoji use, hashtags, length and creativity), so they follow your account across browsers.',
        'Scheduling and analytics: the scheduled times, publish status and engagement figures recorded with your campaign posts.',
      ],
      after: [
        'We set one cookie, auth_token, an httpOnly cookie that keeps you signed in. AutoMarketer has no advertising or third-party analytics cookies. Your browser also keeps your theme, your AI settings and a local copy of your campaigns in its own storage.',
      ],
    },
    {
      id: 'ai-key',
      heading: 'Your AI model key',
      paragraphs: [
        'Your AI key never reaches our servers. It is kept in your browser’s local storage and sent from your browser straight to the provider you choose: OpenRouter, or an OpenAI-compatible endpoint you configure. Your campaign brief goes to that provider so it can write the posts, under the provider’s own terms and privacy policy. Only your non-secret generation preferences are saved on our servers.',
      ],
    },
    {
      id: 'protection',
      heading: 'How tokens are protected',
      paragraphs: [
        'You sign in on each platform’s own page, so we never see your social media passwords. The tokens a platform gives us are stored on our servers, tied to your account only, and used only to publish what you ask AutoMarketer to publish and to keep the connection refreshed. They are sent only over HTTPS, and only to the platform that issued them.',
        'For Bluesky, the private key your tokens are bound to (DPoP) is encrypted at rest with AES-256-GCM. Access and refresh tokens for the other platforms are not yet encrypted separately in our database; they are protected by restricted access to the database and our hosting provider’s controls. Account passwords are stored only as bcrypt hashes.',
      ],
    },
    {
      id: 'use',
      heading: 'How we use it',
      paragraphs: [
        'We use your data only to run AutoMarketer for you: to sign you in, keep your campaigns, publish to the platforms you choose and show your schedule and results. We do not sell your data, use it for advertising, or use your content to train AI models.',
      ],
    },
    {
      id: 'processors',
      heading: 'Who else handles it',
      items: [
        'DigitalOcean hosts the app and its database.',
        'Cloudflare provides DNS and network delivery for tynhub.com addresses.',
        'The social platforms you connect: LinkedIn, X (Twitter), Reddit, Meta (Facebook and Instagram) and Bluesky (or the Bluesky server you use). Each receives the posts and images you publish there and handles them under its own policies.',
        'The AI provider you choose with your own key, which receives your campaign brief directly from your browser.',
      ],
      after: ['AutoMarketer does not send email.'],
    },
    {
      id: 'your-choices',
      heading: 'Disconnecting accounts and deleting data',
      items: [
        'Disconnect a platform in Settings, Connected Platforms: its tokens are deleted from our servers. You can also revoke AutoMarketer’s access from the platform’s own settings at any time.',
        `The app has no delete button yet. To delete a campaign, or your account and everything stored with it, email ${LEGAL_CONTACT} from the address you signed up with. We delete your account, campaigns, images, tokens and preferences within 30 days.`,
        'Posts you have already published stay on each platform until you delete them there.',
        'Clearing your browser’s site data removes your AI key and the local copies kept in your browser.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      paragraphs: [
        'We keep your data while your account exists, until you delete it or ask us to. Backups kept by our hosting provider may hold copies for a short time before they expire. Our servers and hosting providers keep technical logs, such as IP addresses and the pages requested, for a limited time for security and troubleshooting.',
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      paragraphs: ['AutoMarketer is a tool for businesses and is not directed at children under 16.'],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      paragraphs: [
        'When we change this policy we update this page and the date above. For a significant change we will also post a notice in the app before it takes effect.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      paragraphs: [`Questions and requests about your data: ${LEGAL_CONTACT}.`],
    },
  ],
}

export const TERMS: LegalDoc = {
  title: 'Terms of service',
  lead: 'These terms apply when you use AutoMarketer, a TynHub product at automarketer.tynhub.com. By creating an account or using the service, you agree to them.',
  sections: [
    {
      id: 'service',
      heading: 'The service',
      paragraphs: [
        'AutoMarketer helps you write posts with an AI model you choose and publish them to social platforms through their official APIs. We improve it over time, so features may change; anything described as coming next is not available yet.',
      ],
    },
    {
      id: 'account',
      heading: 'Your account',
      paragraphs: [
        `You must be at least 16 and able to agree to these terms. Give a real email address, keep your password safe, and tell us at ${LEGAL_CONTACT} if you think someone else has used your account. You are responsible for what happens under your account.`,
      ],
    },
    {
      id: 'content',
      heading: 'What you publish',
      paragraphs: [
        'You are responsible for everything you publish through AutoMarketer, including posts the AI writes for you. AI output can be wrong, out of date or unsuitable, so review every post before it goes out.',
        'Your content stays yours. You allow us to store it, process it and send it to the platforms and the AI provider you choose, only to run the service for you.',
      ],
    },
    {
      id: 'platforms',
      heading: 'Social platforms and their rules',
      paragraphs: [
        'Each platform you connect has its own terms, community rules, rate limits and API restrictions, and so does each subreddit. You agree to follow them. Platforms may limit, reject or remove posts, or suspend accounts, and may change their APIs in ways that stop a connection from working. We are not responsible for a platform’s decisions or outages.',
      ],
    },
    {
      id: 'ai-provider',
      heading: 'Your AI provider',
      paragraphs: [
        'You bring your own AI key. Your use of that provider, and anything it charges, is between you and the provider under its terms. Set a spending limit on the key.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Acceptable use',
      paragraphs: ['Do not use AutoMarketer to:'],
      items: [
        'send spam: bulk or repetitive unsolicited posts, or posts that fake engagement;',
        'impersonate a person, brand or organization, or mislead people about who is posting;',
        'publish anything unlawful, deceptive, harassing or hateful, or that infringes someone else’s rights;',
        'get around a platform’s limits or rules;',
        'break, overload, probe or reverse-engineer the service, or reach accounts or data that are not yours.',
      ],
    },
    {
      id: 'as-is',
      heading: 'Service provided as is',
      paragraphs: [
        'AutoMarketer is provided as is and as available, without warranties of any kind. It may be unavailable at times, and posts may fail or be delayed. Keep your own copies of anything important.',
      ],
    },
    {
      id: 'liability',
      heading: 'Limit of liability',
      paragraphs: [
        'To the extent the law allows, TynHub is not liable for indirect, incidental or consequential losses, including lost profits, lost data, or action a platform takes against your account. Our total liability for any claim is limited to the greater of what you paid us for AutoMarketer in the 12 months before the claim, or 50 US dollars.',
      ],
    },
    {
      id: 'termination',
      heading: 'Ending your use',
      paragraphs: [
        `You can stop using AutoMarketer at any time: disconnect your platforms and email ${LEGAL_CONTACT} to delete your account. We may suspend or close an account that breaks these terms or puts the service or its platform connections at risk, and we will tell you when we do unless the law or a security risk prevents it.`,
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      paragraphs: [
        'When we change these terms we update this page and the date above. If you keep using AutoMarketer after a change, the new terms apply.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      paragraphs: [`Questions about these terms: ${LEGAL_CONTACT}.`],
    },
  ],
}
