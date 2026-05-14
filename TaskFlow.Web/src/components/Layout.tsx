import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/Nav'

export interface AppContext {
  isDark: boolean
  setIsDark: (v: boolean | ((prev: boolean) => boolean)) => void
}

const PREFS_KEY = 'taskflow_journal_prefs_v1'

function loadDark(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').dark
    return saved != null ? saved : true
  } catch {
    return true
  }
}

export function Layout() {
  const [isDark, setIsDark] = useState<boolean>(loadDark)

  useEffect(() => {
    document.documentElement.classList.toggle('is-dark', isDark)
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, dark: isDark }))
    } catch {}
  }, [isDark])

  return (
    <>
      <Nav />
      <Outlet context={{ isDark, setIsDark } satisfies AppContext} />
    </>
  )
}
