import type { InferenceClient } from './InferenceClient'
import type { InferenceProvider, InferenceRequest, InferenceResponse, InferenceClientConfig } from './types'
import { InferenceError } from './types'
import { parseJsonBody } from '../../utils/http'

/**
 * Inference client for any OpenAI-compatible endpoint.
 *
 * Use this to point AutoMarketer at a self-hosted model (Ollama, vLLM,
 * LM Studio, LocalAI, …) or any provider that exposes an OpenAI-style
 * /chat/completions endpoint.
 *
 * The only required config field is `baseUrl` — `apiKey` is optional for
 * endpoints that don't require authentication.
 */
export class CustomEndpointClient implements InferenceClient {
  readonly provider: InferenceProvider = 'custom'

  private readonly config: Required<InferenceClientConfig>

  constructor(config: InferenceClientConfig) {
    if (!config.baseUrl) {
      throw new InferenceError(
        'CustomEndpointClient requires a baseUrl pointing to an OpenAI-compatible /chat/completions endpoint',
        undefined,
        'custom'
      )
    }
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl.replace(/\/$/, ''), // trim trailing slash
      model: config.model,
    }
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    const model = request.model ?? this.config.model

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: request.messages,
          max_tokens: request.maxTokens ?? 1024,
          temperature: request.temperature ?? 0.7,
        }),
      })
    } catch (err) {
      throw new InferenceError(
        `Network error contacting custom endpoint: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'custom'
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
        `Custom endpoint error ${response.status}: ${body}`,
        response.status,
        'custom'
      )
    }

    type Body = {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }
    let data: Body
    try {
      data = await parseJsonBody<Body>(response)
    } catch (err) {
      throw new InferenceError(
        `Custom endpoint returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'custom'
      )
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new InferenceError('Custom endpoint returned empty content', undefined, 'custom')
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
