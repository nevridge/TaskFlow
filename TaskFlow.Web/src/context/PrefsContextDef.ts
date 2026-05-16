import { createContext } from 'react'
import type { SortMode, HeaderStyle } from '@/lib/prefs'

export interface PrefsContextValue {
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

export const PrefsContext = createContext<PrefsContextValue | null>(null)
