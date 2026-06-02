/**
 * Safely parse the response body as JSON.
 *
 * Calling `response.json()` on an empty body throws:
 *   "JSON.parse: unexpected end of data at line 1 column 1 of the JSON data"
 *
 * This helper reads the body as text first, detects an empty response, and
 * throws a descriptive Error rather than an opaque parse error.
 */
export async function parseJsonBody<T>(response: Response): Promise<T> {
  let text: string
  try {
    text = await response.text()
  } catch (err) {
    throw new Error(
      `Failed to read response body: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!text.trim()) {
    throw new Error(
      `Expected JSON response but received an empty body (HTTP ${response.status})`
    )
  }
  try {
    return JSON.parse(text) as T
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[parseJsonBody] Failed to parse JSON response body:', detail)
    throw new Error(
      `Failed to parse JSON response (HTTP ${response.status}): ${detail}`
    )
  }
}
