import { useEffect, useState, type ReactNode } from 'react'
import { THEMES, THEME_KEY, ThemeContext, readStoredTheme, useTheme, type ThemeId } from '../lib/theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  const setTheme = (t: ThemeId) => {
    setThemeState(t)
    try {
      localStorage.setItem(THEME_KEY, t)
    } catch {
      // storage unavailable: the theme still applies for this session
    }
  }
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

/** Light / Dark switch, as in Routini's footer and top bar. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="segmented" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
