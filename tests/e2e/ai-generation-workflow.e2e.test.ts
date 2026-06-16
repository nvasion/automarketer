/**
 * End-to-end tests for the AI content generation workflow.
 *
 * These tests exercise the complete pipeline:
 *   InferenceClient → ContentGenerationService → GeneratedPostDraft
 *
 * The external HTTP layer (OpenRouter / custom endpoint) is replaced with a
 * lightweight stub so tests remain deterministic and offline-capable while
 * still exercising the full service code path.
 *
 * Coverage goals:
 *   - All five platforms generate correctly shaped drafts
 *   - Character limits are enforced per platform
 *   - Hashtag extraction pipeline works end-to-end
 *   - Tone and emoji instructions reach the inference request
 *   - Factory function creates the correct client for each provider config
 *   - InferenceErrors propagate cleanly through the service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ContentGenerationService } from '../../src/services/ai/ContentGenerationService'
import { createInferenceClient } from '../../src/services/ai'
import type { InferenceClient } from '../../src/services/ai/InferenceClient'
import type { InferenceRequest, InferenceResponse } from '../../src/services/ai/types'
import { InferenceError } from '../../src/services/ai/types'
import type { ContentGenerationParams } from '../../src/services/ai/ContentGenerationService'
import { OpenRouterClient } from '../../src/services/ai/OpenRouterClient'
import { CustomEndpointClient } from '../../src/services/ai/CustomEndpointClient'
import { PLATFORM_CONFIGS } from '../../src/data/sampleData'
import type { Platform } from '../../src/types'

// ─── Stub inference client ────────────────────────────────────────────────────

/**
 * Creates a deterministic InferenceClient whose `complete()` method resolves
 * with a fixed response string.  Optionally accepts a factory so individual
 * tests can inspect the exact request sent to the client.
 */
function makeStubClient(
  responseOrFactory: string | ((req: InferenceRequest) => string) | Error
): InferenceClient & { calls: InferenceRequest[] } {
  const calls: InferenceRequest[] = []
  return {
    provider: 'openrouter',
    calls,
    complete: vi.fn(async (req: InferenceRequest): Promise<InferenceResponse> => {
      calls.push(req)
      if (responseOrFactory instanceof Error) throw responseOrFactory
      const content =
        typeof responseOrFactory === 'function'
          ? responseOrFactory(req)
          : responseOrFactory
      return { content }
    }),
  }
}

// ─── Base params shared across tests ─────────────────────────────────────────

const BASE_PARAMS: ContentGenerationParams = {
  campaignName: 'LaunchPad SaaS',
  websiteUrl: 'https://launchpad.io',
  description: 'A modern project management tool for remote teams',
  targetAudience: 'Product managers and engineering leads',
  platforms: ['linkedin'],
  tone: 'professional',
  emojiUsage: 'none',
  autoHashtags: false,
}

// ─── All five platforms ───────────────────────────────────────────────────────

const ALL_PLATFORMS: Platform[] = ['linkedin', 'twitter', 'reddit', 'facebook', 'instagram']

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Workflow 1: Single-platform generation ───────────────────────────────────

describe('Single-platform generation', () => {
  it('returns a GeneratedPostDraft with the correct platform', async () => {
    const client = makeStubClient('Check out LaunchPad — the remote team tool you need.')
    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', BASE_PARAMS)

    expect(draft.platform).toBe('linkedin')
    expect(typeof draft.content).toBe('string')
    expect(Array.isArray(draft.hashtags)).toBe(true)
  })

  it('trims whitespace from the generated content', async () => {
    const client = makeStubClient('  Leading and trailing spaces.  ')
    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', BASE_PARAMS)
    expect(draft.content).toBe('Leading and trailing spaces.')
  })

  it('calls the client with a system message and a user message', async () => {
    const client = makeStubClient('Post content')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('twitter', BASE_PARAMS)

    expect(client.calls).toHaveLength(1)
    const req = client.calls[0]
    expect(req.messages).toHaveLength(2)
    expect(req.messages[0].role).toBe('system')
    expect(req.messages[1].role).toBe('user')
  })

  it('embeds campaign details in the user prompt', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', BASE_PARAMS)

    const userMsg = client.calls[0].messages[1].content
    expect(userMsg).toContain('LaunchPad SaaS')
    expect(userMsg).toContain('https://launchpad.io')
    expect(userMsg).toContain('A modern project management tool for remote teams')
    expect(userMsg).toContain('Product managers and engineering leads')
  })
})

// ─── Workflow 2: All platforms generate correct shapes ───────────────────────

describe('All five platforms — generation and character limits', () => {
  for (const platform of ALL_PLATFORMS) {
    const cfg = PLATFORM_CONFIGS.find((p) => p.id === platform)!

    it(`${platform}: generates a draft within the ${cfg.charLimit}-char limit`, async () => {
      const client = makeStubClient(`Test post for ${platform} platform content`)
      const svc = new ContentGenerationService(client)
      const draft = await svc.generatePost(platform, { ...BASE_PARAMS, platforms: [platform] })

      expect(draft.platform).toBe(platform)
      const combined =
        draft.hashtags.length > 0
          ? `${draft.content}\n\n${draft.hashtags.join(' ')}`
          : draft.content
      expect(combined.length).toBeLessThanOrEqual(cfg.charLimit)
    })

    it(`${platform}: oversized AI response is truncated to fit within ${cfg.charLimit} chars`, async () => {
      // AI response that exceeds the platform character limit
      const oversized = `Oversized content. ${'word '.repeat(cfg.charLimit / 4).trim()} More words here.`
      const client = makeStubClient(oversized)
      const svc = new ContentGenerationService(client)
      const draft = await svc.generatePost(platform, { ...BASE_PARAMS, platforms: [platform] })

      const combined =
        draft.hashtags.length > 0
          ? `${draft.content}\n\n${draft.hashtags.join(' ')}`
          : draft.content
      expect(combined.length).toBeLessThanOrEqual(cfg.charLimit)
    })

    it(`${platform}: prompt includes the character limit (${cfg.charLimit})`, async () => {
      const client = makeStubClient('Content')
      const svc = new ContentGenerationService(client)
      await svc.generatePost(platform, { ...BASE_PARAMS, platforms: [platform] })

      const userMsg = client.calls[0].messages[1].content
      expect(userMsg).toContain(String(cfg.charLimit))
    })
  }
})

// ─── Workflow 3: Hashtag extraction pipeline ─────────────────────────────────

describe('Hashtag extraction and auto-hashtag pipeline', () => {
  it('extracts trailing hashtag block when autoHashtags=true', async () => {
    const client = makeStubClient(
      'LaunchPad transforms how remote teams collaborate.\n\n#RemoteWork #ProductManagement #SaaS'
    )
    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

    expect(draft.content).toBe('LaunchPad transforms how remote teams collaborate.')
    expect(draft.hashtags).toEqual(['#RemoteWork', '#ProductManagement', '#SaaS'])
  })

  it('returns no hashtags when autoHashtags=false even if AI includes them', async () => {
    const client = makeStubClient(
      'Great product!\n\n#SaaS #Launch'
    )
    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: false })

    // The entire AI response becomes the content (no hashtag splitting)
    expect(draft.hashtags).toHaveLength(0)
    expect(draft.content).toContain('#SaaS') // inline, not extracted
  })

  it('handles multiple trailing hashtag lines', async () => {
    const client = makeStubClient('Body text.\n\n#One #Two\n#Three #Four')
    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

    expect(draft.content).toBe('Body text.')
    expect(draft.hashtags).toEqual(['#One', '#Two', '#Three', '#Four'])
  })

  it('keeps inline hashtags in content when they are not trailing-only lines', async () => {
    const client = makeStubClient('Building in #public is #fun. This line has hashtags.')
    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

    expect(draft.hashtags).toHaveLength(0) // no trailing hashtag block
    expect(draft.content).toContain('#public')
    expect(draft.content).toContain('#fun')
  })

  it('truncates oversized content+hashtags to fit the platform limit', async () => {
    // Create content + hashtags that together exceed LinkedIn's limit
    const longBody = 'Word '.repeat(600).trim() // ~3000+ chars
    const response = `${longBody}\n\n#AI #SaaS #Marketing #Launch #Productivity`
    const client = makeStubClient(response)
    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

    const linkedinLimit = PLATFORM_CONFIGS.find((p) => p.id === 'linkedin')!.charLimit
    const combined =
      draft.hashtags.length > 0
        ? `${draft.content}\n\n${draft.hashtags.join(' ')}`
        : draft.content
    expect(combined.length).toBeLessThanOrEqual(linkedinLimit)
  })

  it('rejects an empty AI response as a failure', async () => {
    const client = makeStubClient('')
    const svc = new ContentGenerationService(client)
    // Empty output is unusable and now surfaces as an InferenceError so the
    // failure is logged and shown, rather than saved as a blank post.
    await expect(
      svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: false })
    ).rejects.toBeInstanceOf(InferenceError)
  })
})

// ─── Workflow 4: Multi-platform batch generation ──────────────────────────────

describe('Multi-platform batch generation (generatePosts)', () => {
  it('generates drafts for all five platforms in a single call', async () => {
    let callIndex = 0
    const platformOrder: Platform[] = []
    const client = makeStubClient((_req) => {
      const platform = ALL_PLATFORMS[callIndex++]
      platformOrder.push(platform)
      return `Post content for platform index ${callIndex}`
    })
    const svc = new ContentGenerationService(client)
    const params: ContentGenerationParams = { ...BASE_PARAMS, platforms: ALL_PLATFORMS }
    const drafts = await svc.generatePosts(params)

    expect(drafts).toHaveLength(5)
    expect(drafts.map((d) => d.platform)).toEqual(ALL_PLATFORMS)
    expect(client.calls).toHaveLength(5)
  })

  it('resolves with one draft per requested platform', async () => {
    const platforms: Platform[] = ['twitter', 'instagram']
    const client = makeStubClient('Short content')
    const svc = new ContentGenerationService(client)
    const drafts = await svc.generatePosts({ ...BASE_PARAMS, platforms })

    expect(drafts).toHaveLength(2)
    expect(drafts[0].platform).toBe('twitter')
    expect(drafts[1].platform).toBe('instagram')
  })

  it('returns an empty array when platforms list is empty', async () => {
    const client = makeStubClient('Content')
    const svc = new ContentGenerationService(client)
    const drafts = await svc.generatePosts({ ...BASE_PARAMS, platforms: [] })
    expect(drafts).toHaveLength(0)
    expect(client.calls).toHaveLength(0)
  })

  it('rejects if any single platform generation fails', async () => {
    let count = 0
    const client = makeStubClient(() => {
      count++
      if (count === 3) throw new InferenceError('Third platform failed', 500, 'openrouter')
      return 'OK content'
    })
    const svc = new ContentGenerationService(client)
    await expect(
      svc.generatePosts({ ...BASE_PARAMS, platforms: ['linkedin', 'twitter', 'facebook'] })
    ).rejects.toThrow('Third platform failed')
  })

  it('all drafts respect their platform character limits in batch mode', async () => {
    const client = makeStubClient(`Long text: ${'content '.repeat(200)}`)
    const svc = new ContentGenerationService(client)
    const drafts = await svc.generatePosts({ ...BASE_PARAMS, platforms: ALL_PLATFORMS })

    for (const draft of drafts) {
      const cfg = PLATFORM_CONFIGS.find((p) => p.id === draft.platform)!
      const combined =
        draft.hashtags.length > 0
          ? `${draft.content}\n\n${draft.hashtags.join(' ')}`
          : draft.content
      expect(combined.length).toBeLessThanOrEqual(cfg.charLimit)
    }
  })
})

// ─── Workflow 5: Tone and emoji instructions in prompts ───────────────────────

describe('Tone and emoji instructions', () => {
  const tones = ['professional', 'casual', 'excited', 'informative'] as const
  const toneKeywords: Record<typeof tones[number], string> = {
    professional: 'formal',
    casual: 'conversational',
    excited: 'energetic',
    informative: 'educational',
  }

  for (const tone of tones) {
    it(`includes "${toneKeywords[tone]}" keyword for tone "${tone}"`, async () => {
      const client = makeStubClient('Post')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('linkedin', { ...BASE_PARAMS, tone })
      const userMsg = client.calls[0].messages[1].content
      expect(userMsg.toLowerCase()).toContain(toneKeywords[tone].toLowerCase())
    })
  }

  it('instructs "Do not use any emojis" when emojiUsage=none', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', { ...BASE_PARAMS, emojiUsage: 'none' })
    expect(client.calls[0].messages[1].content).toContain('not use any emojis')
  })

  it('instructs to use minimal emojis when emojiUsage=minimal', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', { ...BASE_PARAMS, emojiUsage: 'minimal' })
    expect(client.calls[0].messages[1].content).toContain('1–2 emojis')
  })

  it('instructs to use moderate emojis when emojiUsage=moderate', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', { ...BASE_PARAMS, emojiUsage: 'moderate' })
    expect(client.calls[0].messages[1].content).toContain('3–5 emojis')
  })

  it('instructs to use heavy emojis when emojiUsage=heavy', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', { ...BASE_PARAMS, emojiUsage: 'heavy' })
    expect(client.calls[0].messages[1].content).toContain('liberally')
  })

  it('requests hashtags when autoHashtags=true', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })
    expect(client.calls[0].messages[1].content).toContain('hashtag')
  })

  it('requests no hashtags when autoHashtags=false', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: false })
    expect(client.calls[0].messages[1].content).toContain('Do not include any hashtags')
  })
})

// ─── Workflow 6: Inference parameters forwarded to client ────────────────────

describe('Inference parameters forwarded to client', () => {
  it('passes custom maxTokens and temperature', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', BASE_PARAMS, 512, 0.3)

    const req = client.calls[0]
    expect(req.maxTokens).toBe(512)
    expect(req.temperature).toBe(0.3)
  })

  it('defaults to maxTokens=1024 and temperature=0.7', async () => {
    const client = makeStubClient('Post')
    const svc = new ContentGenerationService(client)
    await svc.generatePost('linkedin', BASE_PARAMS)

    const req = client.calls[0]
    expect(req.maxTokens).toBe(1024)
    expect(req.temperature).toBe(0.7)
  })
})

// ─── Workflow 7: Error propagation ───────────────────────────────────────────

describe('Error propagation', () => {
  it('propagates InferenceError with original message and status', async () => {
    const err = new InferenceError('API key expired', 401, 'openrouter')
    const client = makeStubClient(err)
    const svc = new ContentGenerationService(client)

    await expect(svc.generatePost('linkedin', BASE_PARAMS)).rejects.toThrow('API key expired')
    await expect(svc.generatePost('linkedin', BASE_PARAMS)).rejects.toBeInstanceOf(InferenceError)
  })

  it('propagates generic network errors', async () => {
    const err = new Error('Network connection refused')
    const client = makeStubClient(err)
    const svc = new ContentGenerationService(client)
    await expect(svc.generatePost('twitter', BASE_PARAMS)).rejects.toThrow('Network connection refused')
  })

  it('InferenceError captures status code and provider', async () => {
    const err = new InferenceError('Rate limited', 429, 'openrouter')
    expect(err.statusCode).toBe(429)
    expect(err.provider).toBe('openrouter')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('InferenceError')
  })
})

// ─── Workflow 8: Client factory wires up correct providers ───────────────────

describe('Client factory (createInferenceClient)', () => {
  it('returns an OpenRouterClient for provider=openrouter', () => {
    const client = createInferenceClient({
      provider: 'openrouter',
      providers: {
        openrouter: { apiKey: 'test-key', model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
        custom: { apiKey: '', model: '', baseUrl: '' },
      },
      defaults: { tone: 'professional', emojiUsage: 'none', autoHashtags: false, maxTokens: 1024, temperature: 0.7 },
    })
    expect(client).toBeInstanceOf(OpenRouterClient)
    expect(client.provider).toBe('openrouter')
  })

  it('returns a CustomEndpointClient for provider=custom', () => {
    const client = createInferenceClient({
      provider: 'custom',
      providers: {
        openrouter: { apiKey: '', model: '', baseUrl: '' },
        custom: { apiKey: 'local-key', model: 'llama3', baseUrl: 'http://localhost:11434/v1' },
      },
      defaults: { tone: 'casual', emojiUsage: 'minimal', autoHashtags: true, maxTokens: 512, temperature: 0.5 },
    })
    expect(client).toBeInstanceOf(CustomEndpointClient)
    expect(client.provider).toBe('custom')
  })

  it('created OpenRouterClient can complete a stubbed request via fetch mock', async () => {
    const responseBody = {
      choices: [{ message: { content: 'Generated LinkedIn post' } }],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(responseBody)),
      json: () => Promise.resolve(responseBody),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createInferenceClient({
      provider: 'openrouter',
      providers: {
        openrouter: { apiKey: 'test-key', model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
        custom: { apiKey: '', model: '', baseUrl: '' },
      },
      defaults: { tone: 'professional', emojiUsage: 'none', autoHashtags: false, maxTokens: 1024, temperature: 0.7 },
    })

    const svc = new ContentGenerationService(client)
    const draft = await svc.generatePost('linkedin', BASE_PARAMS)
    expect(draft.content).toBe('Generated LinkedIn post')
    expect(fetchMock).toHaveBeenCalledOnce()

    vi.unstubAllGlobals()
  })
})
