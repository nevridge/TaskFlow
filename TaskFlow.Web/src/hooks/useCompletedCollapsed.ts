import { useCallback, useState } from 'react'

export const JOURNAL_COMPLETED_COLLAPSED_KEY = 'taskflow_journal_completed_collapsed_v1'

function read(): boolean {
  try {
    const raw = localStorage.getItem(JOURNAL_COMPLETED_COLLAPSED_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

/**
 * Whether the journal's "Completed" group is collapsed. Collapsed by default; only an explicit user choice is
 * stored, and only from the toggle handler (never on mount).
 */
export function useCompletedCollapsed(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState<boolean>(read)

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem(JOURNAL_COMPLETED_COLLAPSED_KEY, String(next))
      } catch {
        // Storage unavailable: the in-memory state still works for this session.
      }
      return next
    })
  }, [])

  return { collapsed, toggle }
}
