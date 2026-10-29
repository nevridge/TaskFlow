import { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Nav } from '@/components/Nav'
import { SettingsDrawer } from '@/components/SettingsDrawer'
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal'
import { useGlobalKeyboardShortcuts } from '@/hooks/useGlobalKeyboardShortcuts'
import { usePrefs } from '@/context/usePrefs'
import { ToastProvider } from '@/context/ToastContext'
import { todayUrlDate } from '@/lib/journal-utils'
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
  weekdaysOnly: boolean
  setWeekdaysOnly: (v: boolean | ((prev: boolean) => boolean)) => void
}

export function Layout() {
  const prefs = usePrefs()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const navigate = useNavigate()
  const hamburgerRef = useRef<HTMLButtonElement>(null)

  // Scroll lock while the drawer is open; cleanup also covers unmount while open.
  useEffect(() => {
    if (!drawerOpen) return
    document.documentElement.classList.add('drawer-open')
    return () => document.documentElement.classList.remove('drawer-open')
  }, [drawerOpen])

  useGlobalKeyboardShortcuts(
    {
      onGoHome: () => navigate(`/journal/${todayUrlDate()}`),
      onGoTasks: () => navigate('/tasks'),
      onShowHelp: () => setShowShortcuts(true),
    },
    { disabled: drawerOpen || showShortcuts },
  )

  return (
    <ToastProvider>
      <Nav onMenuClick={() => setDrawerOpen(true)} hamburgerRef={hamburgerRef} />
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        returnFocusRef={hamburgerRef}
      />
      <Outlet context={prefs satisfies AppContext} />
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </ToastProvider>
  )
}
