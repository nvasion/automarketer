import { useState, useCallback } from 'react'
import type { Platform } from '../types'
import type { Tone, EmojiUsage } from '../config/aiConfig'
import { loadAIConfig } from '../config/aiConfig'
import { createInferenceClient, ContentGenerationService, InferenceError } from '../services/ai'
import type { GeneratedPostDraft } from '../services/ai'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ContentGenerationOptions {
  campaignName: string
  websiteUrl: string
  description: string
  targetAudience: string
  platforms: Platform[]
  tone: Tone
  /** Overrides the saved default when provided. */
  emojiUsage?: EmojiUsage
  /** Overrides the saved default when provided. */
  autoHashtags?: boolean
}

export interface UseContentGenerationResult {
  /**
   * Trigger AI content generation.  Resolves with the post drafts on success;
   * rejects (and sets `error`) on failure.
   */
  generate: (options: ContentGenerationOptions) => Promise<GeneratedPostDraft[]>
  /** True while a generation request is in flight. */
  loading: boolean
  /** Human-readable error message from the last failed generation, or null. */
  error: string | null
  /** Clear the current error message. */
  clearError: () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook that wraps the ContentGenerationService.
 *
 * Reads the active AIConfig from localStorage at call time (so settings
 * changed by the user in Settings → AI are picked up on the next call
 * without requiring a page reload).
 *
 * Example:
 *   const { generate, loading, error } = useContentGeneration()
 *   const posts = await generate({ campaignName, platforms, tone, … })
 */
export function useContentGeneration(): UseContentGenerationResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(
    async (options: ContentGenerationOptions): Promise<GeneratedPostDraft[]> => {
      setLoading(true)
      setError(null)

      try {
        const config = loadAIConfig()
        const client = createInferenceClient(config)
        const service = new ContentGenerationService(client)

        const posts = await service.generatePosts(
          {
            campaignName: options.campaignName,
            websiteUrl: options.websiteUrl,
            description: options.description,
            targetAudience: options.targetAudience,
            platforms: options.platforms,
            tone: options.tone,
            emojiUsage: options.emojiUsage ?? config.defaults.emojiUsage,
            autoHashtags: options.autoHashtags ?? config.defaults.autoHashtags,
          },
          config.defaults.maxTokens,
          config.defaults.temperature
        )

        return posts
      } catch (err) {
        const message =
          err instanceof InferenceError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'An unexpected error occurred during content generation'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const clearError = useCallback(() => setError(null), [])

  return { generate, loading, error, clearError }
}
