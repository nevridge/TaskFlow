export const PREFS_KEY = 'taskflow_journal_prefs_v1'

export type SortMode = 'manual' | 'open first' | 'done last'
export type HeaderStyle = 'stat' | 'minimal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadPrefs(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function savePrefs(patch: Record<string, unknown>): void {
  try {
    const current = loadPrefs()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...patch }))
  } catch { /* localStorage unavailable */ }
}
