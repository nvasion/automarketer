import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenRouterClient, OPENROUTER_BASE_URL, DEFAULT_OPENROUTER_MODEL } from '../../../src/services/ai/OpenRouterClient'
import { InferenceError } from '../../../src/services/ai/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(content: string, usage = true) {
  const body = {
    choices: [{ message: { content } }],
    ...(usage
      ? { usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 } }
      : {}),
  }
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  }
}

function makeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpenRouterClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Construction ────────────────────────────────────────────────────────────

  it('sets provider to "openrouter"', () => {
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    expect(client.provider).toBe('openrouter')
  })

  it('uses default model when none is specified in config', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('hello'))
    const client = new OpenRouterClient({ apiKey: 'key', model: '', baseUrl: OPENROUTER_BASE_URL })
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model).toBe(DEFAULT_OPENROUTER_MODEL)
  })

  it('uses default base URL when none is specified in config', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('hello'))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: '' })
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`)
  })

  // ── HTTP request shape ───────────────────────────────────────────────────────

  it('sends a POST to /chat/completions with the correct URL', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new OpenRouterClient({ apiKey: 'mykey', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    await client.complete({ messages: [{ role: 'user', content: 'hello' }] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`)
    expect(init.method).toBe('POST')
  })

  it('includes Authorization header with Bearer token', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new OpenRouterClient({ apiKey: 'sk-test', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test')
  })

  it('includes Content-Type and X-Title headers', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Title']).toBe('AutoMarketer')
  })

  it('sends messages, max_tokens, and temperature in the body', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    await client.complete({
      messages: [{ role: 'system', content: 'You are helpful' }, { role: 'user', content: 'hello' }],
      maxTokens: 512,
      temperature: 0.5,
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.messages).toHaveLength(2)
    expect(body.max_tokens).toBe(512)
    expect(body.temperature).toBe(0.5)
  })

  it('overrides the default model when request.model is set', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    await client.complete({ messages: [], model: 'anthropic/claude-3-opus' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model).toBe('anthropic/claude-3-opus')
  })

  // ── Response parsing ─────────────────────────────────────────────────────────

  it('returns the generated content string', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('Hello world'))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    const result = await client.complete({ messages: [] })

    expect(result.content).toBe('Hello world')
  })

  it('parses usage statistics when present', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('Hello', true))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    const result = await client.complete({ messages: [] })

    expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 100, totalTokens: 150 })
  })

  it('returns undefined usage when provider does not report it', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('Hello', false))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })
    const result = await client.complete({ messages: [] })

    expect(result.usage).toBeUndefined()
  })

  // ── Error handling ───────────────────────────────────────────────────────────

  it('throws InferenceError on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })

    await expect(client.complete({ messages: [] })).rejects.toThrow(InferenceError)
    await expect(client.complete({ messages: [] })).rejects.toThrow('Network error contacting OpenRouter')
  })

  it('includes provider in the network error', async () => {
    fetchMock.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })

    try {
      await client.complete({ messages: [] })
    } catch (err) {
      expect(err).toBeInstanceOf(InferenceError)
      expect((err as InferenceError).provider).toBe('openrouter')
    }
  })

  it('throws InferenceError with status code on non-ok response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'))
    const client = new OpenRouterClient({ apiKey: 'bad-key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })

    try {
      await client.complete({ messages: [] })
    } catch (err) {
      expect(err).toBeInstanceOf(InferenceError)
      expect((err as InferenceError).statusCode).toBe(401)
      expect((err as InferenceError).message).toContain('401')
    }
  })

  it('throws InferenceError when response has no content', async () => {
    const body = { choices: [{ message: { content: '' } }] }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    })
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })

    await expect(client.complete({ messages: [] })).rejects.toThrow('OpenRouter returned empty content')
  })

  it('throws InferenceError when choices array is missing', async () => {
    const body = {}
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    })
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })

    await expect(client.complete({ messages: [] })).rejects.toThrow(InferenceError)
  })

  it('throws InferenceError when response body is empty', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') })
    const client = new OpenRouterClient({ apiKey: 'key', model: 'gpt-4o', baseUrl: OPENROUTER_BASE_URL })

    await expect(client.complete({ messages: [] })).rejects.toThrow(InferenceError)
    await expect(client.complete({ messages: [] })).rejects.toThrow('non-JSON response')
  })
})
