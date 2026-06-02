import { createContext } from 'react'
import type { SortMode, HeaderStyle, TaskSortKey, TaskSortDir } from '@/lib/prefs'

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
  taskSortKey: TaskSortKey
  setTaskSortKey: (v: TaskSortKey) => void
  taskSortDir: TaskSortDir
  setTaskSortDir: (v: TaskSortDir) => void
  autoCompleteParentWhenChildrenDone: boolean
  setAutoCompleteParentWhenChildrenDone: (v: boolean | ((prev: boolean) => boolean)) => void
  weekdaysOnly: boolean
  setWeekdaysOnly: (v: boolean | ((prev: boolean) => boolean)) => void
}

export const PrefsContext = createContext<PrefsContextValue | null>(null)
