import { isoToUrlDate } from '@/lib/journal-utils'

/**
 * Router location state carried on links to `/tasks/:id`. The origin comes from state only (never the URL);
 * edit mode comes from the `edit` search param (see `isEditRequested`).
 */
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

/** `/tasks` plus the Tasks page query string (`search` is '' or starts with '?'). */
export function tasksOriginPath(search: string): string {
  return `/tasks${search}`
}

/** The origin when it is the Tasks list itself (`/tasks` or `/tasks?...`), else null. Separate rule from the journal one. */
export function readTasksOrigin(state: unknown): string | null {
  const from = asRecord(state)?.from
  if (typeof from !== 'string') return null
  if (from !== '/tasks' && !from.startsWith('/tasks?')) return null
  if (from.includes('//') || from.includes('\\') || from.includes(':') || from.includes('#')) return null
  return from
}

/** Back target for the detail page: a validated Tasks origin, else a validated journal origin, else null. */
export function readBackOrigin(state: unknown): string | null {
  return readTasksOrigin(state) ?? readJournalOrigin(state)
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

/** Edit mode is on only when the `edit` param appears exactly once with the value `1`. */
export function isEditRequested(params: URLSearchParams): boolean {
  const values = params.getAll('edit')
  return values.length === 1 && values[0] === '1'
}

/** A copy of the params with `edit=1` set. */
export function withEditParam(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.set('edit', '1')
  return next
}

/** A copy of the params with every `edit` removed. */
export function withoutEditParam(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('edit')
  return next
}

/** Detail page path that opens the task in edit mode. */
export function taskEditPath(id: number | string): string {
  return `/tasks/${id}?edit=1`
}
