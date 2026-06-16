import type { Platform } from '../../types'
import type { Tone, EmojiUsage } from '../../config/aiConfig'
import type { InferenceClient } from './InferenceClient'
import { InferenceError } from './types'
import { PLATFORM_CONFIGS } from '../../data/sampleData'

// ─── Public API types ────────────────────────────────────────────────────────

export interface ContentGenerationParams {
  campaignName: string
  websiteUrl: string
  description: string
  targetAudience: string
  platforms: Platform[]
  tone: Tone
  emojiUsage: EmojiUsage
  autoHashtags: boolean
}

export interface GeneratedPostDraft {
  platform: Platform
  /** Main post body without hashtags. */
  content: string
  /** Extracted hashtag tokens (e.g. ["#SaaS", "#ProductLaunch"]). */
  hashtags: string[]
}

// ─── Prompt-building helpers ─────────────────────────────────────────────────

const TONE_DESCRIPTIONS: Record<Tone, string> = {
  professional: 'formal, authoritative, and business-focused — avoid slang, use clear professional language',
  casual: 'friendly, conversational, and approachable — relaxed language, like talking to a colleague',
  excited: 'energetic, enthusiastic, and high-energy — convey excitement and momentum',
  informative: 'educational, detailed, and factual — focus on delivering clear information and value',
}

const EMOJI_INSTRUCTIONS: Record<EmojiUsage, string> = {
  none: 'Do not use any emojis.',
  minimal: 'Use at most 1–2 emojis in the entire post, only where they genuinely add value.',
  moderate: 'Use 3–5 emojis placed naturally throughout the post.',
  heavy: 'Use emojis liberally to make the post visually engaging.',
}

const PLATFORM_INSTRUCTIONS: Record<Platform, (charLimit: number) => string> = {
  linkedin: (limit) =>
    `Write a LinkedIn post for a professional audience. Add value, encourage discussion, and use line breaks and bullet points for readability. Stay under ${limit} characters.`,
  twitter: (limit) =>
    `Write a tweet for X (Twitter). Make every word count. Use a strong hook, short punchy sentences, and stay strictly under ${limit} characters total (including hashtags).`,
  reddit: (limit) =>
    `Write a Reddit post. Reddit users value authenticity, transparency, and substance — avoid corporate spin. Use Markdown formatting (bold via **text**, bullet points). Stay under ${limit} characters.`,
  facebook: (limit) =>
    `Write a Facebook post. A conversational tone that invites comments and shares works best here. You can be more detailed than Twitter. Stay under ${limit} characters.`,
  instagram: (limit) =>
    `Write an Instagram caption. The content must complement a visual; open with a hook and end with a call-to-action (e.g. "Link in bio"). Stay under ${limit} characters.`,
}

function buildSystemPrompt(): string {
  return (
    'You are an expert social media copywriter specialising in marketing campaigns. ' +
    'You write high-converting, platform-native content that engages audiences and drives action. ' +
    'You always respect platform character limits and write content that feels authentic to each platform\'s culture and audience. ' +
    'You produce only the finished post — no preamble, no commentary, no markdown code fences. ' +
    'Never restate, summarise, or repeat these instructions, the character limit, or the field labels; output only the post text itself.'
  )
}

function buildUserPrompt(platform: Platform, params: ContentGenerationParams): string {
  const cfg = PLATFORM_CONFIGS.find((p) => p.id === platform)!

  const hashtagInstruction = params.autoHashtags
    ? 'Append 3–7 relevant hashtags on a new line after the main content, separated from it by a blank line.'
    : 'Do not include any hashtags.'

  return [
    PLATFORM_INSTRUCTIONS[platform](cfg.charLimit),
    '',
    `Product / service: ${params.campaignName}`,
    `Website: ${params.websiteUrl}`,
    `Description: ${params.description}`,
    `Target audience: ${params.targetAudience || 'general audience'}`,
    `Tone: ${TONE_DESCRIPTIONS[params.tone]}`,
    `Emojis: ${EMOJI_INSTRUCTIONS[params.emojiUsage]}`,
    `Hashtags: ${hashtagInstruction}`,
    '',
    'Write only the post content now.',
  ].join('\n')
}

// ─── Output validation ───────────────────────────────────────────────────────

/**
 * High-signal phrases that appear in our prompt instructions but essentially
 * never in a genuine finished post. When a model is too weak (or not
 * instruction-tuned) it restates the prompt instead of writing the post; this
 * catches that so it can be reported as a failure rather than saved as content.
 */
const INSTRUCTION_ECHO_SIGNALS: readonly RegExp[] = [
  /\bunder \d+ characters\b/i,
  /\bcharacters?\s+(?:total|including hashtags)\b/i,
  /\bhashtags?\s+on a new line\b/i,
  /\bplaced naturally\b/i,
  /\bwrite (?:only the post|a tweet|a linkedin|a reddit|a facebook|an instagram)\b/i,
  /\bproduce a (?:tweet|post|caption)\b/i,
  /\b\d+[–-]\d+ relevant hashtags\b/i,
  /\bstrong hook\b/i,
  /^(?:Tone|Emojis|Hashtags|Target audience|Website|Description|Product \/ service):/im,
]

/**
 * True when `text` looks like the model echoed the prompt instructions instead
 * of writing a post. Requires two distinct signals to keep false positives off
 * genuine content.
 */
function looksLikeInstructionEcho(text: string): boolean {
  const hits = INSTRUCTION_ECHO_SIGNALS.filter((re) => re.test(text)).length
  return hits >= 2
}

// ─── Hashtag parsing ─────────────────────────────────────────────────────────

/**
 * Splits generated text into the main body and a trailing block of hashtags.
 *
 * A "trailing hashtag block" is one or more consecutive lines at the end of
 * the text where every non-empty word starts with '#'.  Lines that mix prose
 * and hashtags (inline hashtags) are kept as part of the content.
 */
function splitHashtags(raw: string): { content: string; hashtags: string[] } {
  const lines = raw.split('\n')

  let hashtagStart = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (trimmed === '') continue // skip blank separators

    const words = trimmed.split(/\s+/).filter(Boolean)
    const allHashtags = words.length > 0 && words.every((w) => w.startsWith('#'))
    if (allHashtags) {
      hashtagStart = i
    } else {
      break
    }
  }

  const hashtagLines = lines.slice(hashtagStart)
  const contentLines = lines.slice(0, hashtagStart)

  const hashtags: string[] = []
  for (const line of hashtagLines) {
    const matches = line.match(/#\w+/g)
    if (matches) hashtags.push(...matches)
  }

  return { content: contentLines.join('\n').trim(), hashtags }
}

// ─── Character-limit enforcement ─────────────────────────────────────────────

/** Truncate at the last word boundary before `limit` characters. */
function truncateAtWordBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…'
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Generates platform-specific social media post drafts using an InferenceClient.
 *
 * Responsibilities:
 *  - Build platform-aware, tone-aware prompts
 *  - Call the configured InferenceClient
 *  - Parse and separate hashtags from body content
 *  - Enforce per-platform character limits
 */
export class ContentGenerationService {
  constructor(private readonly client: InferenceClient) {}

  /**
   * Generate a single post draft for one platform.
   */
  async generatePost(
    platform: Platform,
    params: ContentGenerationParams,
    maxTokens = 1024,
    temperature = 0.7
  ): Promise<GeneratedPostDraft> {
    const response = await this.client.complete({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(platform, params) },
      ],
      maxTokens,
      temperature,
    })

    const cfg = PLATFORM_CONFIGS.find((p) => p.id === platform)!
    const raw = response.content.trim()

    // Reject unusable responses so they surface as a (logged) failure rather
    // than being saved as post content.
    if (!raw) {
      throw new InferenceError(`The model returned an empty response for ${platform}.`)
    }
    if (looksLikeInstructionEcho(raw)) {
      throw new InferenceError(
        `The model echoed the prompt instead of writing a ${platform} post. ` +
          'This usually means the selected model is too weak or not instruction-tuned — ' +
          'try a more capable model in Settings → AI.',
      )
    }

    // Split body from trailing hashtag block
    const { content, hashtags } = params.autoHashtags
      ? splitHashtags(raw)
      : { content: raw, hashtags: [] }

    // Enforce character limit on the combined text
    const combined =
      hashtags.length > 0 ? `${content}\n\n${hashtags.join(' ')}` : content

    if (combined.length > cfg.charLimit) {
      // Truncate and re-split so hashtags stay valid
      const truncated = truncateAtWordBoundary(combined, cfg.charLimit)
      const reparsed = params.autoHashtags
        ? splitHashtags(truncated)
        : { content: truncated, hashtags: [] }
      return { platform, content: reparsed.content, hashtags: reparsed.hashtags }
    }

    return { platform, content, hashtags }
  }

  /**
   * Generate post drafts for every platform in params.platforms in parallel.
   * Rejects with the first error encountered (any single failure aborts all).
   */
  async generatePosts(
    params: ContentGenerationParams,
    maxTokens = 1024,
    temperature = 0.7
  ): Promise<GeneratedPostDraft[]> {
    return Promise.all(
      params.platforms.map((platform) =>
        this.generatePost(platform, params, maxTokens, temperature)
      )
    )
  }
}
