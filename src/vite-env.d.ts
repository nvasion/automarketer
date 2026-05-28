/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OpenRouter API key — set in .env as VITE_OPENROUTER_API_KEY for zero-config AI generation. */
  readonly VITE_OPENROUTER_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
