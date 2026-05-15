import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/Nav'
import { SettingsDrawer } from '@/components/SettingsDrawer'
import { loadPrefs, savePrefs } from '@/lib/prefs'
import type { SortMode, HeaderStyle } from '@/lib/prefs'

export interface AppContext {
  isDark: boolean
  setIsDark: (v: boolean | ((prev: boolean) => boolean)) => void
  theme: string
  setTheme: (v: string) => void
  headerStyle: HeaderStyle
  setHeaderStyle: (v: HeaderStyle) => void
  todoSort: SortMode
  setTodoSort: (v: SortMode) => void
  projectStart: string
  setProjectStart: (v: string) => void
}

export function Layout() {
  const [initialPrefs] = useState(() => loadPrefs())
  const [isDark, setIsDark] = useState<boolean>(() => typeof initialPrefs.dark === 'boolean' ? initialPrefs.dark : true)
  const [theme, setTheme] = useState<string>(() => initialPrefs.theme ?? 'default')
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(() => initialPrefs.headerStyle ?? 'stat')
  const [todoSort, setTodoSort] = useState<SortMode>(() => initialPrefs.todoSort ?? 'manual')
  const [projectStart, setProjectStart] = useState<string>(() => initialPrefs.projectStart ?? '2026-05-09')
  const [drawerOpen, setDrawerOpen] = useState(false)

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
    <>
      <Nav onMenuClick={() => setDrawerOpen(true)} />
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isDark={isDark}
        theme={theme}
        headerStyle={headerStyle}
        todoSort={todoSort}
        projectStart={projectStart}
        onDark={v => setIsDark(v)}
        onTheme={setTheme}
        onHeaderStyle={setHeaderStyle}
        onTodoSort={setTodoSort}
        onProjectStart={setProjectStart}
      />
      <Outlet context={{
        isDark, setIsDark,
        theme, setTheme,
        headerStyle, setHeaderStyle,
        todoSort, setTodoSort,
        projectStart, setProjectStart,
      } satisfies AppContext} />
    </>
  )
}
