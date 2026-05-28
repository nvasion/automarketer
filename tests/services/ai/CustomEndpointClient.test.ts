import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CustomEndpointClient } from '../../../src/services/ai/CustomEndpointClient'
import { InferenceError } from '../../../src/services/ai/types'

function makeOkResponse(content: string) {
  return {
    ok: true,
    text: () => Promise.resolve(''),
    json: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
  }
}

function makeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  }
}

describe('CustomEndpointClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Construction ────────────────────────────────────────────────────────────

  it('sets provider to "custom"', () => {
    const client = new CustomEndpointClient({ apiKey: '', model: 'llama3', baseUrl: 'http://localhost:11434/v1' })
    expect(client.provider).toBe('custom')
  })

  it('throws InferenceError when baseUrl is empty', () => {
    expect(() => new CustomEndpointClient({ apiKey: '', model: 'llama3', baseUrl: '' })).toThrow(
      InferenceError
    )
  })

  it('throws InferenceError when baseUrl is not provided', () => {
    expect(
      () => new CustomEndpointClient({ apiKey: '', model: 'model', baseUrl: '' })
    ).toThrow('CustomEndpointClient requires a baseUrl')
  })

  it('strips trailing slash from baseUrl', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('hi'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1/',
    })
    await client.complete({ messages: [] })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
  })

  // ── HTTP request shape ───────────────────────────────────────────────────────

  it('POSTs to /chat/completions at the configured base URL', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    await client.complete({ messages: [] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(init.method).toBe('POST')
  })

  it('includes Authorization header when apiKey is provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new CustomEndpointClient({
      apiKey: 'secret',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    await client.complete({ messages: [] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer secret')
  })

  it('omits Authorization header when apiKey is empty', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    await client.complete({ messages: [] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('sends model from request when provided', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'default-model',
      baseUrl: 'http://localhost:11434/v1',
    })
    await client.complete({ messages: [], model: 'override-model' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model).toBe('override-model')
  })

  it('falls back to config model when request.model is not set', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('content'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'config-model',
      baseUrl: 'http://localhost:11434/v1',
    })
    await client.complete({ messages: [] })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model).toBe('config-model')
  })

  // ── Response parsing ─────────────────────────────────────────────────────────

  it('returns generated content', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('Generated text here'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    const result = await client.complete({ messages: [] })
    expect(result.content).toBe('Generated text here')
  })

  it('parses usage when present', async () => {
    fetchMock.mockResolvedValue(makeOkResponse('hello'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    const result = await client.complete({ messages: [] })
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 })
  })

  // ── Error handling ───────────────────────────────────────────────────────────

  it('throws InferenceError on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    await expect(client.complete({ messages: [] })).rejects.toThrow(InferenceError)
    await expect(client.complete({ messages: [] })).rejects.toThrow('Network error contacting custom endpoint')
  })

  it('carries "custom" as provider in error', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    try {
      await client.complete({ messages: [] })
    } catch (err) {
      expect((err as InferenceError).provider).toBe('custom')
    }
  })

  it('throws InferenceError on non-ok HTTP response', async () => {
    fetchMock.mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'))
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    try {
      await client.complete({ messages: [] })
    } catch (err) {
      expect(err).toBeInstanceOf(InferenceError)
      expect((err as InferenceError).statusCode).toBe(500)
    }
  })

  it('throws InferenceError when content is empty', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: null } }] }),
    })
    const client = new CustomEndpointClient({
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    await expect(client.complete({ messages: [] })).rejects.toThrow('Custom endpoint returned empty content')
  })
})
