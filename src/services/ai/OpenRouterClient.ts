import type { InferenceClient } from './InferenceClient'
import type { InferenceProvider, InferenceRequest, InferenceResponse, InferenceClientConfig } from './types'
import { InferenceError } from './types'
import { parseJsonBody } from '../../utils/http'

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

    type Body = {
      choices?: {
        message?: { content?: string; reasoning?: string }
        finish_reason?: string
      }[]
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }
    let data: Body
    try {
      data = await parseJsonBody<Body>(response)
    } catch (err) {
      throw new InferenceError(
        `OpenRouter returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'openrouter'
      )
    }

    const choice = data.choices?.[0]
    const content = choice?.message?.content
    if (!content) {
      // Explain WHY it was empty so the error is actionable. Reasoning models
      // (e.g. minimax-m3) commonly exhaust max_tokens on reasoning and return
      // no answer content, or return only a `reasoning` field.
      const finish = choice?.finish_reason
      const detail =
        finish === 'length'
          ? ' — the model hit the max_tokens limit before producing any answer. ' +
            'Increase Max Tokens in Settings → AI, or use a non-reasoning model.'
          : choice?.message?.reasoning
          ? ' — the model returned only reasoning tokens and no answer. ' +
            'Try a non-reasoning / instruct model (e.g. gpt-4o-mini, claude-3.5-haiku).'
          : finish
          ? ` (finish_reason=${finish}).`
          : '.'
      throw new InferenceError(`OpenRouter returned empty content${detail}`, undefined, 'openrouter')
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
