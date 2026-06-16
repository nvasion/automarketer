import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useContentGeneration } from '../../src/hooks/useContentGeneration'
import { InferenceError } from '../../src/services/ai/types'
import type { GeneratedPostDraft } from '../../src/services/ai'

// ─── Module mocks ──────────────────────────────────────────────────────────────
//
// We mock the service layer so the hook can be tested in isolation
// without needing a real fetch() or OpenRouter account.

const mockGeneratePosts = vi.fn<[unknown, number, number], Promise<GeneratedPostDraft[]>>()

vi.mock('../../src/services/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ai')>()
  return {
    ...actual,
    createInferenceClient: vi.fn(() => ({ provider: 'openrouter', complete: vi.fn() })),
    ContentGenerationService: vi.fn().mockImplementation(() => ({
      generatePosts: mockGeneratePosts,
    })),
  }
})

vi.mock('../../src/config/aiConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/aiConfig')>()
  return {
    ...actual,
    loadAIConfig: vi.fn(() => ({
      provider: 'openrouter',
      providers: {
        openrouter: { apiKey: 'test-key', model: 'gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
        custom: { apiKey: '', model: '', baseUrl: '' },
      },
      defaults: { tone: 'professional', emojiUsage: 'moderate', autoHashtags: true, maxTokens: 1024, temperature: 0.7 },
    })),
  }
})

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_DRAFTS: GeneratedPostDraft[] = [
  { platform: 'linkedin', content: 'LinkedIn post', hashtags: ['#test'] },
  { platform: 'twitter', content: 'Tweet', hashtags: [] },
]

const BASE_OPTIONS = {
  campaignName: 'My Campaign',
  websiteUrl: 'https://example.com',
  description: 'A product description',
  targetAudience: 'Developers',
  platforms: ['linkedin', 'twitter'] as const,
  tone: 'professional' as const,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useContentGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  // ── Initial state ───────────────────────────────────────────────────────────

  it('starts with loading=false and error=null', () => {
    const { result } = renderHook(() => useContentGeneration())
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  // ── Successful generation ────────────────────────────────────────────────────

  it('returns generated post drafts on success', async () => {
    mockGeneratePosts.mockResolvedValueOnce(MOCK_DRAFTS)
    const { result } = renderHook(() => useContentGeneration())

    let posts: GeneratedPostDraft[] = []
    await act(async () => {
      posts = await result.current.generate(BASE_OPTIONS)
    })

    expect(posts).toHaveLength(2)
    expect(posts[0].platform).toBe('linkedin')
    expect(posts[1].platform).toBe('twitter')
  })

  it('sets loading=true during generation and false afterwards', async () => {
    let resolveGeneration!: (v: GeneratedPostDraft[]) => void
    mockGeneratePosts.mockReturnValueOnce(
      new Promise<GeneratedPostDraft[]>((res) => { resolveGeneration = res })
    )

    const { result } = renderHook(() => useContentGeneration())

    // Start generation — don't await yet
    act(() => {
      void result.current.generate(BASE_OPTIONS)
    })

    // loading should be true immediately
    expect(result.current.loading).toBe(true)

    // Resolve the generation
    await act(async () => {
      resolveGeneration(MOCK_DRAFTS)
    })

    expect(result.current.loading).toBe(false)
  })

  it('error remains null after a successful generation', async () => {
    mockGeneratePosts.mockResolvedValueOnce(MOCK_DRAFTS)
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      await result.current.generate(BASE_OPTIONS)
    })

    expect(result.current.error).toBeNull()
  })

  // ── Error handling ───────────────────────────────────────────────────────────

  it('sets error message when generation fails with InferenceError', async () => {
    mockGeneratePosts.mockRejectedValueOnce(new InferenceError('Invalid API key', 401, 'openrouter'))
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      try {
        await result.current.generate(BASE_OPTIONS)
      } catch {
        // expected to throw
      }
    })

    expect(result.current.error).toBe('Invalid API key')
  })

  it('sets error message from a generic Error', async () => {
    mockGeneratePosts.mockRejectedValueOnce(new Error('Network error'))
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      try { await result.current.generate(BASE_OPTIONS) } catch { /* expected */ }
    })

    expect(result.current.error).toBe('Network error')
  })

  it('sets a fallback error message for non-Error rejections', async () => {
    mockGeneratePosts.mockRejectedValueOnce('something weird')
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      try { await result.current.generate(BASE_OPTIONS) } catch { /* expected */ }
    })

    expect(result.current.error).toContain('unexpected error')
  })

  it('logs the failure with provider/model/status context (no API key leaked)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGeneratePosts.mockRejectedValueOnce(new InferenceError('Invalid API key', 401, 'openrouter'))
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      try { await result.current.generate(BASE_OPTIONS) } catch { /* expected */ }
    })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = String(errorSpy.mock.calls[0][0])
    expect(logged).toContain('Content generation FAILED')
    expect(logged).toContain('provider=openrouter')
    expect(logged).toContain('model=gpt-4o-mini')
    expect(logged).toContain('status=401')
    expect(logged).toContain('Invalid API key')
    // The API key must never appear in the log.
    expect(logged).not.toContain('test-key')
    errorSpy.mockRestore()
  })

  it('sets loading=false after a failed generation', async () => {
    mockGeneratePosts.mockRejectedValueOnce(new Error('fail'))
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      try { await result.current.generate(BASE_OPTIONS) } catch { /* expected */ }
    })

    expect(result.current.loading).toBe(false)
  })

  it('re-throws the error so callers can react', async () => {
    const err = new InferenceError('Quota exceeded', 429)
    mockGeneratePosts.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useContentGeneration())

    await expect(
      act(async () => {
        await result.current.generate(BASE_OPTIONS)
      })
    ).rejects.toThrow('Quota exceeded')
  })

  // ── clearError ───────────────────────────────────────────────────────────────

  it('clearError() resets error to null', async () => {
    mockGeneratePosts.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      try { await result.current.generate(BASE_OPTIONS) } catch { /* expected */ }
    })
    expect(result.current.error).not.toBeNull()

    act(() => {
      result.current.clearError()
    })
    expect(result.current.error).toBeNull()
  })

  // ── Config defaults are applied ──────────────────────────────────────────────

  it('uses config emojiUsage when not specified in options', async () => {
    mockGeneratePosts.mockResolvedValueOnce(MOCK_DRAFTS)
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      await result.current.generate(BASE_OPTIONS) // no emojiUsage in options
    })

    // The mock should have received a params object with emojiUsage from config defaults ('moderate')
    const [params] = mockGeneratePosts.mock.calls[0] as [{ emojiUsage: string }, number, number]
    expect(params.emojiUsage).toBe('moderate')
  })

  it('overrides config emojiUsage when specified in options', async () => {
    mockGeneratePosts.mockResolvedValueOnce(MOCK_DRAFTS)
    const { result } = renderHook(() => useContentGeneration())

    await act(async () => {
      await result.current.generate({ ...BASE_OPTIONS, emojiUsage: 'heavy' })
    })

    const [params] = mockGeneratePosts.mock.calls[0] as [{ emojiUsage: string }, number, number]
    expect(params.emojiUsage).toBe('heavy')
  })
})
