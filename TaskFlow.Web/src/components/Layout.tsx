import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/Nav'
import { loadPrefs, savePrefs } from '@/lib/prefs'

export interface AppContext {
  isDark: boolean
  setIsDark: (v: boolean | ((prev: boolean) => boolean)) => void
}

function loadDark(): boolean {
  const saved = loadPrefs().dark
  return typeof saved === 'boolean' ? saved : true
}

export function Layout() {
  const [isDark, setIsDark] = useState<boolean>(loadDark)

  useEffect(() => {
    document.documentElement.classList.toggle('is-dark', isDark)
    savePrefs({ dark: isDark })
  }, [isDark])

  return (
    <>
      <Nav />
      <Outlet context={{ isDark, setIsDark } satisfies AppContext} />
    </>
  )
}
