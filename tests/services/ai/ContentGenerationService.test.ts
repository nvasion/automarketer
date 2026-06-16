import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContentGenerationService } from '../../../src/services/ai/ContentGenerationService'
import type { InferenceClient } from '../../../src/services/ai/InferenceClient'
import type { InferenceRequest, InferenceResponse } from '../../../src/services/ai/types'
import { InferenceError } from '../../../src/services/ai/types'
import type { ContentGenerationParams } from '../../../src/services/ai/ContentGenerationService'

// ─── Mock client ──────────────────────────────────────────────────────────────

function makeMockClient(response: string | Error): InferenceClient {
  return {
    provider: 'openrouter',
    complete: vi.fn((): Promise<InferenceResponse> => {
      if (response instanceof Error) return Promise.reject(response)
      return Promise.resolve({ content: response })
    }),
  }
}

// ─── Base params ──────────────────────────────────────────────────────────────

const BASE_PARAMS: ContentGenerationParams = {
  campaignName: 'TestApp',
  websiteUrl: 'https://testapp.io',
  description: 'A great testing tool',
  targetAudience: 'QA engineers',
  platforms: ['linkedin'],
  tone: 'professional',
  emojiUsage: 'none',
  autoHashtags: false,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContentGenerationService', () => {
  // ── generatePost ────────────────────────────────────────────────────────────

  describe('generatePost()', () => {
    it('calls complete() with a system + user message', async () => {
      const client = makeMockClient('Great post content here')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('linkedin', BASE_PARAMS)

      expect(client.complete).toHaveBeenCalledOnce()
      const [req] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [InferenceRequest]
      expect(req.messages).toHaveLength(2)
      expect(req.messages[0].role).toBe('system')
      expect(req.messages[1].role).toBe('user')
    })

    it('embeds campaign details in the user prompt', async () => {
      const client = makeMockClient('Post')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('linkedin', BASE_PARAMS)

      const [req] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [InferenceRequest]
      const userMsg = req.messages[1].content
      expect(userMsg).toContain('TestApp')
      expect(userMsg).toContain('https://testapp.io')
      expect(userMsg).toContain('A great testing tool')
      expect(userMsg).toContain('QA engineers')
    })

    it('mentions the platform character limit in the prompt', async () => {
      const client = makeMockClient('Post')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('twitter', BASE_PARAMS)

      const [req] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [InferenceRequest]
      // Twitter char limit is 280
      expect(req.messages[1].content).toContain('280')
    })

    it('returns the generated content trimmed', async () => {
      const client = makeMockClient('  Hello LinkedIn!  ')
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('linkedin', BASE_PARAMS)
      expect(result.content).toBe('Hello LinkedIn!')
    })

    it('returns empty hashtags when autoHashtags is false', async () => {
      const client = makeMockClient('Content without hashtags')
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: false })
      expect(result.hashtags).toHaveLength(0)
    })

    it('extracts trailing hashtag block when autoHashtags is true', async () => {
      const client = makeMockClient('Main post content.\n\n#AI #Marketing #SaaS')
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

      expect(result.content).toBe('Main post content.')
      expect(result.hashtags).toEqual(['#AI', '#Marketing', '#SaaS'])
    })

    it('keeps inline hashtags as part of the content', async () => {
      const client = makeMockClient('Building in #public is fun. Here is the post.')
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

      // No trailing hashtag-only line → hashtags stays empty, content stays intact
      expect(result.hashtags).toHaveLength(0)
      expect(result.content).toContain('#public')
    })

    it('enforces character limit — truncates content that exceeds platform limit', async () => {
      // Twitter limit is 280
      const longContent = 'A'.repeat(300)
      const client = makeMockClient(longContent)
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('twitter', BASE_PARAMS)

      const combined = result.hashtags.length > 0
        ? `${result.content}\n\n${result.hashtags.join(' ')}`
        : result.content
      expect(combined.length).toBeLessThanOrEqual(280)
    })

    // ── Unusable-output rejection (so failures log + surface) ──────────────────

    it('throws InferenceError when the model returns an empty response', async () => {
      const client = makeMockClient('   ')
      const svc = new ContentGenerationService(client)
      await expect(svc.generatePost('twitter', BASE_PARAMS)).rejects.toBeInstanceOf(InferenceError)
    })

    it('throws InferenceError when the model echoes the prompt instead of a post', async () => {
      // The kind of garbage a too-weak model returns: a restatement of the prompt.
      const echo =
        'We need to produce a tweet for X (Twitter) under 280 characters total including hashtags. ' +
        'Must have a strong hook, short punchy sentences. Use 3-5 emojis placed naturally. ' +
        'Append 3-7 relevant hashtags on a new line after the main content.'
      const client = makeMockClient(echo)
      const svc = new ContentGenerationService(client)
      await expect(svc.generatePost('twitter', BASE_PARAMS)).rejects.toThrow(/echoed the prompt/i)
    })

    it('does not falsely reject genuine content that happens to contain one signal phrase', async () => {
      // "strong hook" alone is a single signal — below the two-signal threshold.
      const client = makeMockClient('Our launch opens with a strong hook for busy founders. Try it today!')
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('linkedin', BASE_PARAMS)
      expect(result.content).toContain('strong hook')
    })

    it('does not truncate content within the platform limit', async () => {
      const content = 'Short tweet'
      const client = makeMockClient(content)
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('twitter', BASE_PARAMS)
      expect(result.content).toBe('Short tweet')
    })

    it('passes maxTokens and temperature to the client', async () => {
      const client = makeMockClient('Post')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('linkedin', BASE_PARAMS, 512, 0.3)

      const [req] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [InferenceRequest]
      expect(req.maxTokens).toBe(512)
      expect(req.temperature).toBe(0.3)
    })

    it('propagates InferenceError from the client', async () => {
      const err = new InferenceError('API key invalid', 401, 'openrouter')
      const client = makeMockClient(err)
      const svc = new ContentGenerationService(client)
      await expect(svc.generatePost('linkedin', BASE_PARAMS)).rejects.toThrow('API key invalid')
    })

    it('includes the correct platform in the result', async () => {
      const client = makeMockClient('Content')
      const svc = new ContentGenerationService(client)
      const result = await svc.generatePost('instagram', BASE_PARAMS)
      expect(result.platform).toBe('instagram')
    })
  })

  // ── generatePosts ───────────────────────────────────────────────────────────

  describe('generatePosts()', () => {
    it('calls generatePost for each platform in params.platforms', async () => {
      const client = makeMockClient('Post content')
      const svc = new ContentGenerationService(client)
      const params: ContentGenerationParams = {
        ...BASE_PARAMS,
        platforms: ['linkedin', 'twitter', 'instagram'],
      }
      const results = await svc.generatePosts(params)

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.platform)).toEqual(['linkedin', 'twitter', 'instagram'])
      // One complete() call per platform
      expect(client.complete).toHaveBeenCalledTimes(3)
    })

    it('resolves with drafts for all platforms', async () => {
      const client = makeMockClient('Generated post')
      const svc = new ContentGenerationService(client)
      const params: ContentGenerationParams = { ...BASE_PARAMS, platforms: ['reddit', 'facebook'] }
      const results = await svc.generatePosts(params)

      expect(results.every((r) => r.content === 'Generated post')).toBe(true)
    })

    it('rejects if any platform generation fails', async () => {
      let callCount = 0
      const client: InferenceClient = {
        provider: 'openrouter',
        complete: vi.fn(() => {
          callCount++
          if (callCount === 2) return Promise.reject(new InferenceError('Second call failed'))
          return Promise.resolve({ content: 'OK' })
        }),
      }
      const svc = new ContentGenerationService(client)
      const params: ContentGenerationParams = { ...BASE_PARAMS, platforms: ['linkedin', 'twitter'] }

      await expect(svc.generatePosts(params)).rejects.toThrow('Second call failed')
    })

    it('returns an empty array when platforms list is empty', async () => {
      const client = makeMockClient('Post')
      const svc = new ContentGenerationService(client)
      const results = await svc.generatePosts({ ...BASE_PARAMS, platforms: [] })
      expect(results).toHaveLength(0)
      expect(client.complete).not.toHaveBeenCalled()
    })
  })

  // ── Tone and emoji in prompts ────────────────────────────────────────────────

  describe('Prompt content', () => {
    it('includes tone description in the user prompt', async () => {
      const client = makeMockClient('Post')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('linkedin', { ...BASE_PARAMS, tone: 'casual' })

      const [req] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [InferenceRequest]
      // The casual tone maps to "friendly, conversational, and approachable…"
      expect(req.messages[1].content).toContain('conversational')
    })

    it('instructs to omit emojis when emojiUsage is none', async () => {
      const client = makeMockClient('Post')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('linkedin', { ...BASE_PARAMS, emojiUsage: 'none' })

      const [req] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [InferenceRequest]
      expect(req.messages[1].content).toContain('not use any emojis')
    })

    it('instructs to append hashtags when autoHashtags is true', async () => {
      const client = makeMockClient('Post')
      const svc = new ContentGenerationService(client)
      await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

      const [req] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [InferenceRequest]
      expect(req.messages[1].content).toContain('hashtag')
    })
  })
})

// ─── splitHashtags behaviour (via generatePost) ───────────────────────────────

describe('Hashtag parsing edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles multiple trailing hashtag lines', async () => {
    const client = makeMockClient('Body text.\n\n#One #Two\n#Three #Four')
    const svc = new ContentGenerationService(client)
    const result = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

    expect(result.content).toBe('Body text.')
    expect(result.hashtags).toEqual(['#One', '#Two', '#Three', '#Four'])
  })

  it('handles content with no trailing hashtag block', async () => {
    const client = makeMockClient('Just a plain post with no hashtags at all')
    const svc = new ContentGenerationService(client)
    const result = await svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: true })

    expect(result.content).toBe('Just a plain post with no hashtags at all')
    expect(result.hashtags).toHaveLength(0)
  })

  it('rejects an empty response as a failure (rather than saving empty content)', async () => {
    const client = makeMockClient('')
    const svc = new ContentGenerationService(client)
    // An empty model response is unusable — it now surfaces as an InferenceError
    // so the failure is logged and shown, instead of being saved as a blank post.
    await expect(
      svc.generatePost('linkedin', { ...BASE_PARAMS, autoHashtags: false })
    ).rejects.toBeInstanceOf(InferenceError)
  })
})
