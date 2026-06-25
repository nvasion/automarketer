import type { InferenceProvider, InferenceRequest, InferenceResponse } from './types'

/**
 * Pluggable interface for AI inference backends.
 *
 * Any class that implements this interface can be dropped into the
 * ContentGenerationService without changing any business logic.
 * Built-in implementations: OpenRouterClient, CustomEndpointClient.
 */
export interface InferenceClient {
  /** Identifies which backend this client talks to. */
  readonly provider: InferenceProvider

  /**
   * Send a chat-completion request and return the generated text.
   * Throws an InferenceError if the request fails for any reason.
   */
  complete(request: InferenceRequest): Promise<InferenceResponse>
}
