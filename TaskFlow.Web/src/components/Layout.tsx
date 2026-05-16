import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/Nav'
import { SettingsDrawer } from '@/components/SettingsDrawer'
import { usePrefs } from '@/context/PrefsContext'
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
  const prefs = usePrefs()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <Nav onMenuClick={() => setDrawerOpen(true)} />
      <SettingsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <Outlet context={prefs satisfies AppContext} />
    </>
  )
}
