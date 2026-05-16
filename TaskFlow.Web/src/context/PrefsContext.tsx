import { useState, useEffect } from 'react'
import { loadPrefs, savePrefs, DEFAULT_PROJECT_START } from '@/lib/prefs'
import type { SortMode, HeaderStyle } from '@/lib/prefs'
import { PrefsContext } from './PrefsContextDef'

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [initialPrefs] = useState(() => loadPrefs())
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof initialPrefs.dark === 'boolean' ? initialPrefs.dark : true,
  )
  const [theme, setTheme] = useState<string>(() => initialPrefs.theme ?? 'default')
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(
    () => initialPrefs.headerStyle ?? 'stat',
  )
  const [todoSort, setTodoSort] = useState<SortMode>(() => initialPrefs.todoSort ?? 'manual')
  const [projectStart, setProjectStart] = useState<string>(
    () => initialPrefs.projectStart ?? DEFAULT_PROJECT_START,
  )

  useEffect(() => {
    document.documentElement.classList.toggle('is-dark', isDark)
    savePrefs({ dark: isDark })
  }, [isDark])

  useEffect(() => {
    const el = document.documentElement
    if (theme === 'default') {
      el.removeAttribute('data-theme')
    } else {
      el.setAttribute('data-theme', theme)
    }
    savePrefs({ theme })
  }, [theme])

  useEffect(() => {
    savePrefs({ headerStyle, todoSort, projectStart })
  }, [headerStyle, todoSort, projectStart])

  return (
    <PrefsContext.Provider
      value={{
        isDark,
        setIsDark,
        theme,
        setTheme,
        headerStyle,
        setHeaderStyle,
        todoSort,
        setTodoSort,
        projectStart,
        setProjectStart,
      }}
    >
      {children}
    </PrefsContext.Provider>
  )
}
