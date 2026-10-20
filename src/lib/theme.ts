// Theme: AutoMarketer (default), TynHub dark, TynHub light, the same choice
// Routini offers. Stored per browser and applied as data-theme on <html>,
// which switches every token in tokens.css. The provider and the switch live
// in components/Theme.tsx.

import { createContext, useContext } from 'react'

export const THEMES = [
  { id: 'automarketer', label: 'AutoMarketer' },
  { id: 'tynhub-dark', label: 'TynHub dark' },
  { id: 'tynhub-light', label: 'TynHub light' },
] as const
export type ThemeId = (typeof THEMES)[number]['id']

export const THEME_KEY = 'automarketer.theme'
export const DEFAULT_THEME: ThemeId = 'automarketer'

export function readStoredTheme(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (THEMES.some((t) => t.id === v)) return v as ThemeId
  } catch {
    // storage unavailable
  }
  return DEFAULT_THEME
}

export const ThemeContext = createContext<{ theme: ThemeId; setTheme: (t: ThemeId) => void }>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
})

export const useTheme = () => useContext(ThemeContext)
