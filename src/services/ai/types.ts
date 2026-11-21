/**
 * Core types for the AI inference abstraction layer.
 *
 * These types form the contract between the inference clients
 * (OpenRouter, custom endpoints) and the rest of the application.
 */

/** The available inference provider backends. */
export type InferenceProvider = 'openrouter' | 'custom'

/** A single message in a chat conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Request payload sent to an inference client. */
export interface InferenceRequest {
  messages: ChatMessage[]
  /** Model identifier — overrides the client's default model when provided. */
  model?: string
  /** Maximum number of tokens to generate. Defaults to 1024. */
  maxTokens?: number
  /** Sampling temperature (0–2). Defaults to 0.7. */
  temperature?: number
}

/** Successful response from an inference client. */
export interface InferenceResponse {
  /** The generated text content. */
  content: string
  /**
   * Why generation stopped, as reported by the provider (e.g. "stop",
   * "length"). "length" means the answer was cut off by max_tokens.
   */
  finishReason?: string
  /** Token usage statistics, if reported by the provider. */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** Configuration required to construct an inference client. */
export interface InferenceClientConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * Machine-readable cause of an InferenceError, for callers that react to
 * specific failures. "max_tokens": the model used the whole token budget
 * (typically on reasoning) before writing any answer.
 */
export type InferenceErrorReason = 'max_tokens'

/**
 * Error thrown by inference clients when a request fails.
 * Carries an optional HTTP status code and provider name for diagnostics.
 */
export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly provider?: InferenceProvider,
    public readonly reason?: InferenceErrorReason
  ) {
    super(message)
    this.name = 'InferenceError'
    // Restore prototype chain (needed when transpiling to ES5)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
