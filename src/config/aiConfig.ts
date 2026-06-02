import type { InferenceProvider } from '../services/ai/types'
import { parseJsonBody } from '../utils/http'

// ─── Domain types ─────────────────────────────────────────────────────────────

export type Tone = 'professional' | 'casual' | 'excited' | 'informative'
export type EmojiUsage = 'none' | 'minimal' | 'moderate' | 'heavy'

// ─── Provider config ──────────────────────────────────────────────────────────

/**
 * Connection settings for a single inference provider.
 * All three fields are required so the factory can always build a valid client;
 * `apiKey` legitimately defaults to an empty string for endpoints that don't
 * require authentication (e.g. local Ollama).
 */
export interface ProviderConfig {
  apiKey: string
  /** Model identifier (e.g. "openai/gpt-4o-mini", "llama3"). */
  model: string
  /** Base URL of the OpenAI-compatible endpoint. */
  baseUrl: string
}

// ─── Config shape ─────────────────────────────────────────────────────────────

export interface AIConfig {
  /** Which inference backend to use. */
  provider: InferenceProvider

  /**
   * Per-provider connection settings, keyed by InferenceProvider.
   *
   * Using a Record keeps the root AIConfig interface stable as new providers
   * are added — only a new key in this map is required, not a new top-level
   * field (Open/Closed Principle).
   */
  providers: Record<InferenceProvider, ProviderConfig>

  /** Default content-generation preferences applied to every campaign. */
  defaults: {
    tone: Tone
    emojiUsage: EmojiUsage
    autoHashtags: boolean
    /** Maximum tokens to request per generation call. */
    maxTokens: number
    /** Sampling temperature (0–2). */
    temperature: number
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

const VALID_PROVIDERS: readonly InferenceProvider[] = ['openrouter', 'custom']
const VALID_TONES: readonly Tone[] = ['professional', 'casual', 'excited', 'informative']
const VALID_EMOJI: readonly EmojiUsage[] = ['none', 'minimal', 'moderate', 'heavy']

/**
 * Validate a custom-endpoint URL.
 * Returns `null` when the URL is valid, or a human-readable error string.
 *
 * Accepts only http:// and https:// to prevent non-HTTP schemes from being
 * stored and later forwarded to a backend proxy (SSRF mitigation).
 */
export function validateEndpointUrl(url: string): string | null {
  if (!url.trim()) return 'Endpoint URL is required'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Endpoint URL is not a valid URL'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Endpoint URL must use http:// or https://'
  }
  return null
}

// ─── Available OpenRouter models ──────────────────────────────────────────────

/**
 * Static fallback model list shown in the Settings UI.
 * Call `fetchOpenRouterModels()` to get a live, up-to-date list instead.
 */
export const OPENROUTER_MODELS: { id: string; label: string }[] = [
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini — fast & affordable (recommended)' },
  { id: 'openai/gpt-4o', label: 'GPT-4o — powerful' },
  { id: 'anthropic/claude-3-5-haiku', label: 'Claude 3.5 Haiku — fast' },
  { id: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet — balanced' },
  { id: 'anthropic/claude-3-opus', label: 'Claude 3 Opus — most capable' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B — open source' },
  { id: 'google/gemini-flash-1.5', label: 'Gemini Flash 1.5 — fast' },
]

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * Build a fresh default config.
 *
 * API keys intentionally default to empty strings — they are entered by the
 * user via Settings → AI Settings and are never injected at build time.
 * Baking a key into the Vite bundle via VITE_* would expose it in the compiled
 * JS to anyone who inspects the page source.
 */
export function getDefaultAIConfig(): AIConfig {
  return {
    provider: 'openrouter',
    providers: {
      openrouter: {
        apiKey: '',
        model: 'openai/gpt-4o-mini',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      custom: {
        apiKey: '',
        model: 'gpt-4o-mini',
        baseUrl: '',
      },
    },
    defaults: {
      tone: 'professional',
      emojiUsage: 'moderate',
      autoHashtags: true,
      maxTokens: 1024,
      temperature: 0.7,
    },
  }
}

// ─── Dynamic model list ───────────────────────────────────────────────────────

const MODEL_CACHE_KEY = 'automarketer_or_models'
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface CachedModelList {
  fetchedAt: number
  models: { id: string; label: string }[]
}

/**
 * Fetch the live model list from OpenRouter's `/models` endpoint and cache it
 * in `sessionStorage` for one hour. Falls back to the static `OPENROUTER_MODELS`
 * array on any network or parse error, so the UI always has something to show.
 *
 * @param apiKey - Optional Bearer token (improves rate limits on OpenRouter).
 * @param baseUrl - Override the OpenRouter base URL (default: https://openrouter.ai/api/v1).
 */
export async function fetchOpenRouterModels(
  apiKey = '',
  baseUrl = 'https://openrouter.ai/api/v1'
): Promise<{ id: string; label: string }[]> {
  // Return cached list if still fresh
  try {
    const raw = sessionStorage.getItem(MODEL_CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw) as CachedModelList
      if (Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS && cached.models.length > 0) {
        return cached.models
      }
    }
  } catch {
    // ignore cache read errors
  }

  // Fetch live list
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const res = await fetch(`${baseUrl}/models`, { method: 'GET', headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await parseJsonBody<{ data?: { id: string; name?: string }[] }>(res)
    const models = (data.data ?? []).map((m) => ({ id: m.id, label: m.name ?? m.id }))

    if (models.length > 0) {
      try {
        const entry: CachedModelList = { fetchedAt: Date.now(), models }
        sessionStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(entry))
      } catch {
        // ignore cache write errors (e.g. storage quota)
      }
      return models
    }
  } catch {
    // fall through to static list
  }

  return OPENROUTER_MODELS
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'automarketer_ai_config'

/**
 * Load the AI config from `localStorage`, validating and merging stored values
 * on top of the current defaults. Falls back to defaults on any parse or
 * validation error so the app always has a usable config.
 *
 * **Security note:** `localStorage` is accessible to any same-origin JavaScript.
 * An XSS vulnerability could expose stored API keys. Users should set spending
 * limits on their API keys. A future backend proxy will remove this surface.
 */
export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultAIConfig()
    const parsed: unknown = JSON.parse(raw)
    const validated = sanitizeStoredConfig(parsed)
    return mergeConfig(getDefaultAIConfig(), validated)
  } catch {
    return getDefaultAIConfig()
  }
}

/**
 * Persist an `AIConfig` to `localStorage`.
 *
 * Returns `{ success: true }` on success, or `{ success: false, error }` when
 * `localStorage` is unavailable (e.g. Safari private-browsing mode, exceeded
 * storage quota). Callers should surface the `error` message to the user.
 *
 * **Security note:** API keys are stored as plaintext. A future backend
 * integration should store credentials server-side instead.
 */
export function saveAIConfig(config: AIConfig): { success: boolean; error?: string } {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save settings'
    return { success: false, error: message }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Validate and extract safe fields from a value that came out of
 * `JSON.parse(localStorage.getItem(...))`.
 *
 * Fields with invalid types, unrecognised enum values, or out-of-range numbers
 * are silently dropped so that `mergeConfig()` can fill them from defaults.
 * `Object.keys()` is used throughout to avoid iterating inherited prototype
 * properties (prototype pollution mitigation).
 */
function sanitizeStoredConfig(raw: unknown): Partial<AIConfig> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}

  // Use explicit key access (not for…in) to avoid prototype pollution
  const obj = raw as Record<string, unknown>
  const result: Partial<AIConfig> = {}

  // provider
  if (VALID_PROVIDERS.includes(obj['provider'] as InferenceProvider)) {
    result.provider = obj['provider'] as InferenceProvider
  }

  // providers map — only accept known provider keys with correct field types
  const rawProviders = obj['providers']
  if (typeof rawProviders === 'object' && rawProviders !== null && !Array.isArray(rawProviders)) {
    const providerMap = rawProviders as Record<string, unknown>
    const validated: Partial<Record<InferenceProvider, ProviderConfig>> = {}

    for (const p of VALID_PROVIDERS) {
      const entry = providerMap[p]
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
      const e = entry as Record<string, unknown>

      // Only include fields whose values are of the correct type.
      // Missing fields are left out so mergeConfig() preserves the defaults.
      const pc: Partial<ProviderConfig> = {}
      if (typeof e['apiKey'] === 'string') pc.apiKey = e['apiKey']
      if (typeof e['model'] === 'string') pc.model = e['model']
      if (typeof e['baseUrl'] === 'string') pc.baseUrl = e['baseUrl']

      if (Object.keys(pc).length > 0) {
        validated[p] = pc as ProviderConfig // mergeConfig fills any missing fields
      }
    }

    if (Object.keys(validated).length > 0) {
      result.providers = validated as Record<InferenceProvider, ProviderConfig>
    }
  }

  // defaults — validate each field independently
  const rawDefaults = obj['defaults']
  if (
    typeof rawDefaults === 'object' &&
    rawDefaults !== null &&
    !Array.isArray(rawDefaults)
  ) {
    const d = rawDefaults as Record<string, unknown>
    const vd: Partial<AIConfig['defaults']> = {}

    if (VALID_TONES.includes(d['tone'] as Tone)) vd.tone = d['tone'] as Tone
    if (VALID_EMOJI.includes(d['emojiUsage'] as EmojiUsage)) vd.emojiUsage = d['emojiUsage'] as EmojiUsage
    if (typeof d['autoHashtags'] === 'boolean') vd.autoHashtags = d['autoHashtags']
    if (
      typeof d['maxTokens'] === 'number' &&
      d['maxTokens'] > 0 &&
      d['maxTokens'] <= 32_000
    ) {
      vd.maxTokens = d['maxTokens']
    }
    if (
      typeof d['temperature'] === 'number' &&
      d['temperature'] >= 0 &&
      d['temperature'] <= 2
    ) {
      vd.temperature = d['temperature']
    }

    if (Object.keys(vd).length > 0) {
      result.defaults = vd as AIConfig['defaults']
    }
  }

  return result
}

/**
 * Recursively merge `overrides` on top of `base`.
 *
 * - Plain objects at each level are merged recursively (nested keys are preserved).
 * - Arrays and primitive values from `overrides` replace the base value outright.
 * - `undefined` and `null` override values are skipped (base value is kept).
 * - Iterates only own properties via `Object.keys()` to prevent prototype pollution.
 */
function mergeConfig<T extends object>(
  base: T,
  overrides: Partial<T> | Record<string, unknown>
): T {
  const result = { ...base } as T
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const val = (overrides as Partial<T>)[key]
    if (val === undefined || val === null) continue
    const baseVal = base[key]
    if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = mergeConfig(
        baseVal as object,
        val as Record<string, unknown>
      ) as T[keyof T]
    } else {
      result[key] = val as T[keyof T]
    }
  }
  return result
}
