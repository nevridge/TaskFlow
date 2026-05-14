export const PREFS_KEY = 'taskflow_journal_prefs_v1'

export function loadPrefs(): Record<string, unknown> {
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
