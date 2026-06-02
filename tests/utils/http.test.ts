import { describe, it, expect } from 'vitest'
import { parseJsonBody } from '../../src/utils/http'

function makeResponse(body: string, status = 200): Response {
  return {
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response
}

describe('parseJsonBody()', () => {
  // ── Happy path ───────────────────────────────────────────────────────────────

  it('parses a valid JSON object', async () => {
    const result = await parseJsonBody<{ id: number }>(makeResponse('{"id":42}'))
    expect(result).toEqual({ id: 42 })
  })

  it('parses a valid JSON array', async () => {
    const result = await parseJsonBody<number[]>(makeResponse('[1,2,3]'))
    expect(result).toEqual([1, 2, 3])
  })

  it('parses a JSON string literal', async () => {
    const result = await parseJsonBody<string>(makeResponse('"hello"'))
    expect(result).toBe('hello')
  })

  it('parses a JSON boolean', async () => {
    const result = await parseJsonBody<boolean>(makeResponse('true'))
    expect(result).toBe(true)
  })

  it('parses a JSON number', async () => {
    const result = await parseJsonBody<number>(makeResponse('0'))
    expect(result).toBe(0)
  })

  // ── Empty body ───────────────────────────────────────────────────────────────

  it('throws on an empty string body', async () => {
    await expect(parseJsonBody(makeResponse(''))).rejects.toThrow(
      'Expected JSON response but received an empty body'
    )
  })

  it('throws on a whitespace-only body', async () => {
    await expect(parseJsonBody(makeResponse('   \n\t  '))).rejects.toThrow(
      'Expected JSON response but received an empty body'
    )
  })

  it('includes the HTTP status in the empty-body error message', async () => {
    await expect(parseJsonBody(makeResponse('', 204))).rejects.toThrow('HTTP 204')
  })

  // ── Malformed JSON ───────────────────────────────────────────────────────────

  it('throws a descriptive error on malformed JSON', async () => {
    await expect(parseJsonBody(makeResponse('{bad json'))).rejects.toThrow(
      'Failed to parse JSON response'
    )
  })

  it('includes the HTTP status in the malformed-JSON error message', async () => {
    await expect(parseJsonBody(makeResponse('{bad json', 200))).rejects.toThrow('HTTP 200')
  })

  it('throws a descriptive error for truncated JSON', async () => {
    await expect(parseJsonBody(makeResponse('{"key": '))).rejects.toThrow(
      'Failed to parse JSON response'
    )
  })

  // ── text() failure ───────────────────────────────────────────────────────────

  it('throws a descriptive error when text() rejects', async () => {
    const response = {
      status: 200,
      text: () => Promise.reject(new Error('stream aborted')),
    } as unknown as Response

    await expect(parseJsonBody(response)).rejects.toThrow('Failed to read response body')
    await expect(parseJsonBody(response)).rejects.toThrow('stream aborted')
  })
})
