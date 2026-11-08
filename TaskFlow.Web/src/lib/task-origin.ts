import { isoToUrlDate } from '@/lib/journal-utils'

/** Router location state carried on links to `/tasks/:id` (never read from the URL). */
export interface TaskOriginState {
  from?: string
  focusTaskId?: number
}

/** Journal path for an ISO date, e.g. '2026-11-07' -> '/journal/11-07-2026'. */
export function journalOriginPath(isoDate: string): string {
  return `/journal/${isoToUrlDate(isoDate)}`
}

function asRecord(state: unknown): Record<string, unknown> | null {
  return typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null
}

/** The origin path when it is a safe in-app journal path, else null. */
export function readJournalOrigin(state: unknown): string | null {
  const from = asRecord(state)?.from
  if (typeof from !== 'string') return null
  if (!from.startsWith('/journal/')) return null
  if (from.includes('//') || from.includes('\\') || from.includes(':')) return null
  return from
}

/** The task id to return focus to, when it is a positive integer. */
export function readFocusTaskId(state: unknown): number | null {
  const id = asRecord(state)?.focusTaskId
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

/** The state with `focusTaskId` removed, or null when nothing else remains. */
export function stateWithoutFocusTaskId(state: unknown): Record<string, unknown> | null {
  const record = asRecord(state)
  if (!record) return null
  const rest = { ...record }
  delete rest.focusTaskId
  return Object.keys(rest).length ? rest : null
}
