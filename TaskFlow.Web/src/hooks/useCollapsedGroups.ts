import { useCallback, useState } from 'react'

export const COLLAPSED_GROUPS_KEY = 'taskflow_tasks_collapsed_groups_v1'

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

/**
 * Collapsed priority groups on the Tasks page, persisted separately from the journal prefs.
 * Read lazily on mount; written ONLY from the toggle handler (never on mount or in an effect).
 */
export function useCollapsedGroups(): { collapsed: Set<string>; toggle: (key: string) => void } {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed)

  const toggle = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(Array.from(next)))
      } catch {
        // Storage unavailable: the in-memory state still works for this session.
      }
      return next
    })
  }, [])

  return { collapsed, toggle }
}
