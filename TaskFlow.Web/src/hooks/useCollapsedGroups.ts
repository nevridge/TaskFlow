import { useCallback, useRef, useState } from 'react'
import { SECTION_DEFS, SECTION_ORDER, type SectionKey } from '@/lib/task-sections'

export const COLLAPSED_GROUPS_KEY = 'taskflow_tasks_section_collapse_v2'

type Overrides = Partial<Record<SectionKey, boolean>>

function readOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Overrides = {}
    for (const key of SECTION_ORDER) {
      const value = (parsed as Record<string, unknown>)[key]
      if (typeof value === 'boolean') result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Collapse state of the Tasks page sections, persisted separately from the journal prefs.
 * Only explicit user choices are stored (true means collapsed); everything else uses the section default.
 * Read lazily on mount; written ONLY from the toggle handler (never on mount or in an effect).
 * The old v1 key is neither read nor written.
 */
export function useCollapsedGroups(): { isCollapsed: (key: SectionKey) => boolean; toggle: (key: SectionKey) => void } {
  const [overrides, setOverrides] = useState<Overrides>(readOverrides)

  const isCollapsed = useCallback(
    (key: SectionKey) => overrides[key] ?? SECTION_DEFS[key].defaultCollapsed,
    [overrides],
  )

  const overridesRef = useRef(overrides)

  const toggle = useCallback((key: SectionKey) => {
    const prev = overridesRef.current
    const current = prev[key] ?? SECTION_DEFS[key].defaultCollapsed
    const next: Overrides = { ...prev, [key]: !current }
    overridesRef.current = next
    setOverrides(next)
    try {
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: the in-memory state still works for this session.
    }
  }, [])

  return { isCollapsed, toggle }
}
