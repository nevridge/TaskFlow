export const PREFS_KEY = 'taskflow_journal_prefs_v1'
export const DEFAULT_PROJECT_START = '2026-05-09'

export type SortMode = 'manual' | 'open first' | 'done last'
export type HeaderStyle = 'stat' | 'minimal'

export interface Prefs {
  dark?: boolean
  theme?: string
  headerStyle?: HeaderStyle
  todoSort?: SortMode
  projectStart?: string
}

export function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs
  } catch {
    return {}
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  try {
    const current = loadPrefs()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...patch }))
  } catch { /* localStorage unavailable */ }
}