import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadAIConfig,
  saveAIConfig,
  getDefaultAIConfig,
  validateEndpointUrl,
} from '../../src/config/aiConfig'
import type { AIConfig } from '../../src/config/aiConfig'

const STORAGE_KEY = 'automarketer_ai_config'

describe('aiConfig', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  // ── getDefaultAIConfig ───────────────────────────────────────────────────────

  describe('getDefaultAIConfig()', () => {
    it('returns openrouter as the default provider', () => {
      expect(getDefaultAIConfig().provider).toBe('openrouter')
    })

    it('returns providers keyed by InferenceProvider', () => {
      const cfg = getDefaultAIConfig()
      expect(cfg.providers).toHaveProperty('openrouter')
      expect(cfg.providers).toHaveProperty('custom')
    })

    it('returns the default OpenRouter base URL', () => {
      expect(getDefaultAIConfig().providers.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
    })

    it('returns the default model', () => {
      expect(getDefaultAIConfig().providers.openrouter.model).toBe('openai/gpt-4o-mini')
    })

    it('returns an empty apiKey by default (no build-time injection)', () => {
      expect(getDefaultAIConfig().providers.openrouter.apiKey).toBe('')
    })

    it('returns professional as the default tone', () => {
      expect(getDefaultAIConfig().defaults.tone).toBe('professional')
    })

    it('returns moderate as the default emoji usage', () => {
      expect(getDefaultAIConfig().defaults.emojiUsage).toBe('moderate')
    })

    it('enables autoHashtags by default', () => {
      expect(getDefaultAIConfig().defaults.autoHashtags).toBe(true)
    })

    it('sets maxTokens to 1024 by default', () => {
      expect(getDefaultAIConfig().defaults.maxTokens).toBe(1024)
    })

    it('sets temperature to 0.7 by default', () => {
      expect(getDefaultAIConfig().defaults.temperature).toBe(0.7)
    })
  })

  // ── loadAIConfig ─────────────────────────────────────────────────────────────

  describe('loadAIConfig()', () => {
    it('returns defaults when localStorage is empty', () => {
      const config = loadAIConfig()
      const defaults = getDefaultAIConfig()
      expect(config.provider).toBe(defaults.provider)
      expect(config.providers.openrouter.model).toBe(defaults.providers.openrouter.model)
      expect(config.defaults.tone).toBe(defaults.defaults.tone)
    })

    it('loads a previously saved config', () => {
      const stored: Partial<AIConfig> = {
        provider: 'custom',
        providers: {
          openrouter: getDefaultAIConfig().providers.openrouter,
          custom: { apiKey: '', model: 'llama3', baseUrl: 'http://localhost:11434/v1' },
        },
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

      const config = loadAIConfig()
      expect(config.provider).toBe('custom')
      expect(config.providers.custom.model).toBe('llama3')
      expect(config.providers.custom.baseUrl).toBe('http://localhost:11434/v1')
    })

    it('merges saved partial defaults — stored values win, others kept from defaults', () => {
      const partial = { defaults: { tone: 'casual', emojiUsage: 'heavy' } }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(partial))

      const config = loadAIConfig()
      expect(config.defaults.tone).toBe('casual')
      expect(config.defaults.emojiUsage).toBe('heavy')
      // Default values retained
      expect(config.defaults.autoHashtags).toBe(true)
      expect(config.defaults.maxTokens).toBe(1024)
    })

    it('merges OpenRouter provider settings without losing defaults', () => {
      const partial = { providers: { openrouter: { apiKey: 'sk-test' } } }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(partial))

      const config = loadAIConfig()
      expect(config.providers.openrouter.apiKey).toBe('sk-test')
      // Default model and baseUrl are preserved
      expect(config.providers.openrouter.model).toBe('openai/gpt-4o-mini')
      expect(config.providers.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
    })

    it('falls back to defaults when stored JSON is malformed', () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')
      const config = loadAIConfig()
      expect(config.provider).toBe('openrouter')
    })

    it('falls back to defaults when stored value is null', () => {
      localStorage.removeItem(STORAGE_KEY)
      const config = loadAIConfig()
      expect(config.provider).toBe('openrouter')
    })

    it('falls back to defaults for an invalid provider value', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'totally-unknown' }))
      const config = loadAIConfig()
      expect(config.provider).toBe('openrouter') // default
    })

    it('falls back to defaults for an invalid tone value', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaults: { tone: 'robotic' } }))
      const config = loadAIConfig()
      expect(config.defaults.tone).toBe('professional') // default
    })

    it('falls back to defaults for an invalid emojiUsage value', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaults: { emojiUsage: 'insane' } }))
      const config = loadAIConfig()
      expect(config.defaults.emojiUsage).toBe('moderate') // default
    })

    it('clamps out-of-range temperature to default', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaults: { temperature: 99 } }))
      const config = loadAIConfig()
      expect(config.defaults.temperature).toBe(0.7) // default retained
    })

    it('clamps out-of-range maxTokens to default', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ defaults: { maxTokens: -1 } }))
      const config = loadAIConfig()
      expect(config.defaults.maxTokens).toBe(1024) // default retained
    })

    it('ignores prototype-polluting keys in stored object', () => {
      // If prototype pollution were possible, this would modify Object.prototype
      const malicious = '{"__proto__":{"polluted":true},"provider":"openrouter"}'
      localStorage.setItem(STORAGE_KEY, malicious)
      loadAIConfig()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((Object.prototype as any)['polluted']).toBeUndefined()
    })

    it('ignores non-string apiKey values in stored providers', () => {
      const bad = { providers: { openrouter: { apiKey: 12345, model: 'gpt-4o', baseUrl: 'https://openrouter.ai/api/v1' } } }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bad))
      const config = loadAIConfig()
      // Non-string apiKey is dropped; default (empty string) is used
      expect(config.providers.openrouter.apiKey).toBe('')
    })
  })

  // ── saveAIConfig ─────────────────────────────────────────────────────────────

  describe('saveAIConfig()', () => {
    it('returns { success: true } when storage succeeds', () => {
      const result = saveAIConfig(getDefaultAIConfig())
      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('persists the config to localStorage', () => {
      const config = getDefaultAIConfig()
      config.providers.openrouter.apiKey = 'my-api-key'
      saveAIConfig(config)

      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!) as AIConfig
      expect(parsed.providers.openrouter.apiKey).toBe('my-api-key')
    })

    it('round-trips: save then load produces identical config', () => {
      const original = getDefaultAIConfig()
      original.provider = 'custom'
      original.providers.custom.baseUrl = 'http://my-server.local/v1'
      original.providers.custom.model = 'mistral'
      original.defaults.tone = 'excited'

      saveAIConfig(original)
      const loaded = loadAIConfig()

      expect(loaded.provider).toBe('custom')
      expect(loaded.providers.custom.baseUrl).toBe('http://my-server.local/v1')
      expect(loaded.providers.custom.model).toBe('mistral')
      expect(loaded.defaults.tone).toBe('excited')
    })

    it('overwrites a previously saved config', () => {
      const first = getDefaultAIConfig()
      first.providers.openrouter.apiKey = 'first-key'
      saveAIConfig(first)

      const second = getDefaultAIConfig()
      second.providers.openrouter.apiKey = 'second-key'
      saveAIConfig(second)

      const loaded = loadAIConfig()
      expect(loaded.providers.openrouter.apiKey).toBe('second-key')
    })

    it('returns { success: false, error } when localStorage throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError: The storage is full')
      })

      const result = saveAIConfig(getDefaultAIConfig())

      expect(result.success).toBe(false)
      expect(result.error).toContain('QuotaExceededError')
      spy.mockRestore()
    })
  })

  // ── validateEndpointUrl ───────────────────────────────────────────────────────

  describe('validateEndpointUrl()', () => {
    it('returns null for a valid http URL', () => {
      expect(validateEndpointUrl('http://localhost:11434/v1')).toBeNull()
    })

    it('returns null for a valid https URL', () => {
      expect(validateEndpointUrl('https://my-server.example.com/v1')).toBeNull()
    })

    it('returns an error for an empty string', () => {
      expect(validateEndpointUrl('')).not.toBeNull()
    })

    it('returns an error for a whitespace-only string', () => {
      expect(validateEndpointUrl('   ')).not.toBeNull()
    })

    it('returns an error for a non-URL string', () => {
      expect(validateEndpointUrl('not a url')).not.toBeNull()
    })

    it('returns an error for a ftp:// URL', () => {
      expect(validateEndpointUrl('ftp://example.com/files')).not.toBeNull()
    })

    it('returns an error for a file:// URL', () => {
      expect(validateEndpointUrl('file:///etc/passwd')).not.toBeNull()
    })

    it('returns an error for a javascript: URL', () => {
      expect(validateEndpointUrl('javascript:alert(1)')).not.toBeNull()
    })

    it('error message mentions http/https requirement', () => {
      const err = validateEndpointUrl('ftp://example.com')
      expect(err).toMatch(/https?/)
    })
  })
})
