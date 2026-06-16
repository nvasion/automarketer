/**
 * Public surface of the AI services module.
 *
 * Usage:
 *   import { createInferenceClient, ContentGenerationService } from '../services/ai'
 */

// Re-export the interface so consumers can type-annotate without importing from sub-files
export type { InferenceClient } from './InferenceClient'

// Client implementations
export { OpenRouterClient, OPENROUTER_BASE_URL, DEFAULT_OPENROUTER_MODEL } from './OpenRouterClient'
export { CustomEndpointClient } from './CustomEndpointClient'

// Content generation
export { ContentGenerationService } from './ContentGenerationService'
export type { ContentGenerationParams, GeneratedPostDraft } from './ContentGenerationService'

// Shared types
export { InferenceError } from './types'
export type {
  InferenceProvider,
  ChatMessage,
  InferenceRequest,
  InferenceResponse,
  InferenceClientConfig,
} from './types'

// ─── Factory ─────────────────────────────────────────────────────────────────

import type { InferenceClient } from './InferenceClient'
import { OpenRouterClient } from './OpenRouterClient'
import { CustomEndpointClient } from './CustomEndpointClient'
import type { AIConfig } from '../../config/aiConfig'

/**
 * Construct the correct InferenceClient for the given AIConfig.
 *
 * Reads provider settings from `config.providers[config.provider]` so that
 * adding a new backend only requires a new InferenceProvider key and a
 * corresponding client class — the factory itself stays unchanged.
 */
export function createInferenceClient(config: AIConfig): InferenceClient {
  const providerConfig = config.providers[config.provider]
  if (config.provider === 'custom') {
    return new CustomEndpointClient(providerConfig)
  }
  return new OpenRouterClient(providerConfig)
}
