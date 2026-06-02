import { useState, useEffect } from 'react'
import { loadPrefs, savePrefs, DEFAULT_PROJECT_START } from '@/lib/prefs'
import type { SortMode, HeaderStyle, TaskSortKey, TaskSortDir } from '@/lib/prefs'
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
  const [taskSortKey, setTaskSortKey] = useState<TaskSortKey>(
    () => initialPrefs.taskSortKey ?? 'title',
  )
  const [taskSortDir, setTaskSortDir] = useState<TaskSortDir>(
    () => initialPrefs.taskSortDir ?? 'asc',
  )
  const [autoCompleteParentWhenChildrenDone, setAutoCompleteParentWhenChildrenDone] = useState<boolean>(
    () => initialPrefs.autoCompleteParentWhenChildrenDone ?? false,
  )
  const [weekdaysOnly, setWeekdaysOnly] = useState<boolean>(
    () => initialPrefs.weekdaysOnly ?? false,
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

  useEffect(() => {
    savePrefs({ taskSortKey, taskSortDir })
  }, [taskSortKey, taskSortDir])

  useEffect(() => {
    savePrefs({ autoCompleteParentWhenChildrenDone })
  }, [autoCompleteParentWhenChildrenDone])

  useEffect(() => {
    savePrefs({ weekdaysOnly })
  }, [weekdaysOnly])

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
        taskSortKey,
        setTaskSortKey,
        taskSortDir,
        setTaskSortDir,
        autoCompleteParentWhenChildrenDone,
        setAutoCompleteParentWhenChildrenDone,
        weekdaysOnly,
        setWeekdaysOnly,
      }}
    >
      {children}
    </PrefsContext.Provider>
  )
}
