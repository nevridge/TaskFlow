import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/Nav'
import { SettingsDrawer } from '@/components/SettingsDrawer'
import { loadPrefs, savePrefs } from '@/lib/prefs'
import type { SortMode, HeaderStyle } from '@/lib/prefs'

export interface AppContext {
  isDark: boolean
  setIsDark: (v: boolean | ((prev: boolean) => boolean)) => void
  headerStyle: HeaderStyle
  setHeaderStyle: (v: HeaderStyle) => void
  todoSort: SortMode
  setTodoSort: (v: SortMode) => void
  projectStart: string
  setProjectStart: (v: string) => void
}

function loadDark(): boolean {
  const saved = loadPrefs().dark
  return typeof saved === 'boolean' ? saved : true
}

export function Layout() {
  const [isDark, setIsDark] = useState<boolean>(loadDark)
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(() => loadPrefs().headerStyle ?? 'stat')
  const [todoSort, setTodoSort] = useState<SortMode>(() => loadPrefs().todoSort ?? 'manual')
  const [projectStart, setProjectStart] = useState<string>(() => loadPrefs().projectStart ?? '2026-05-09')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('is-dark', isDark)
    savePrefs({ dark: isDark })
  }, [isDark])

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
        headerStyle={headerStyle}
        todoSort={todoSort}
        projectStart={projectStart}
        onDark={v => setIsDark(v)}
        onHeaderStyle={setHeaderStyle}
        onTodoSort={setTodoSort}
        onProjectStart={setProjectStart}
      />
      <Outlet context={{
        isDark, setIsDark,
        headerStyle, setHeaderStyle,
        todoSort, setTodoSort,
        projectStart, setProjectStart,
      } satisfies AppContext} />
    </>
  )
}
