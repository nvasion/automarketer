import type { InferenceClient } from './InferenceClient'
import type { InferenceProvider, InferenceRequest, InferenceResponse, InferenceClientConfig } from './types'
import { InferenceError } from './types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini'

/**
 * Inference client backed by the OpenRouter API.
 *
 * OpenRouter exposes an OpenAI-compatible chat-completions endpoint that
 * can route to dozens of different models (GPT-4o, Claude, Llama, Gemini, …)
 * via a single API key.
 *
 * Docs: https://openrouter.ai/docs
 */
export class OpenRouterClient implements InferenceClient {
  readonly provider: InferenceProvider = 'openrouter'

  private readonly config: Required<InferenceClientConfig>

  constructor(config: InferenceClientConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || OPENROUTER_BASE_URL,
      model: config.model || DEFAULT_OPENROUTER_MODEL,
    }
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    const model = request.model ?? this.config.model
    const referer =
      typeof window !== 'undefined' ? window.location.origin : 'https://automarketer.app'

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': referer,
          'X-Title': 'AutoMarketer',
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          max_tokens: request.maxTokens ?? 1024,
          temperature: request.temperature ?? 0.7,
        }),
      })
    } catch (err) {
      throw new InferenceError(
        `Network error contacting OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'openrouter'
      )
    }

    if (!response.ok) {
      let body = ''
      try {
        body = await response.text()
      } catch {
        // ignore body-read errors
      }
      throw new InferenceError(
        `OpenRouter API error ${response.status}: ${body}`,
        response.status,
        'openrouter'
      )
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new InferenceError('OpenRouter returned empty content', undefined, 'openrouter')
    }

    return {
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    }
  }
}
