/**
 * Single source of truth for task statuses on the frontend.
 *
 * The API serializes the C# enum as PascalCase in responses and accepts lowercase in
 * request bodies (the generated `Status` type). `normalizeStatus` is tolerant of either
 * casing for display code; the journal still compares the PascalCase response value
 * strictly (see CLAUDE.md "Enum comparisons").
 *
 * Internal UI key is the lowercased status (`inprogress`); the wire value for requests is
 * `inProgress` (see REQUEST_STATUS), the only camelCase value. This file is the single
 * casing-conversion point.
 */

export type TaskStatus = 'Draft' | 'Todo' | 'InProgress' | 'Blocked' | 'Completed'
export type RequestStatus = 'draft' | 'todo' | 'inProgress' | 'blocked' | 'completed'

/** Display / sort order. Draft sorts first, Completed last. */
export const STATUS_ORDER: readonly TaskStatus[] = ['Draft', 'Todo', 'InProgress', 'Blocked', 'Completed']

export const STATUS_LABELS: Record<TaskStatus, string> = {
  Draft: 'Draft',
  Todo: 'To-do',
  InProgress: 'In Progress',
  Blocked: 'Blocked',
  Completed: 'Completed',
}

const REQUEST_STATUS: Record<TaskStatus, RequestStatus> = {
  Draft: 'draft',
  Todo: 'todo',
  InProgress: 'inProgress',
  Blocked: 'blocked',
  Completed: 'completed',
}

/** Statuses a Blocked task returns to when unblocked. */
const RESTORABLE_STATUSES: readonly TaskStatus[] = ['Todo', 'InProgress']

/** Display label for any casing of a status; unknown values fall back to the raw text. */
export function getStatusLabel(raw: string | null | undefined): string {
  const status = normalizeStatus(raw)
  return status ? STATUS_LABELS[status] : (raw ?? '')
}

/** Case-insensitive. Unknown values return undefined so callers can render the raw value. */
export function normalizeStatus(raw: string | null | undefined): TaskStatus | undefined {
  if (!raw) return undefined
  const lower = raw.toLowerCase()
  return STATUS_ORDER.find(s => s.toLowerCase() === lower)
}

/** Lowercase value for request bodies. */
export function toRequestStatus(status: TaskStatus): RequestStatus {
  return REQUEST_STATUS[status]
}

export function isBlocked(raw: string | null | undefined): boolean {
  return normalizeStatus(raw) === 'Blocked'
}

export function isCompleted(raw: string | null | undefined): boolean {
  return normalizeStatus(raw) === 'Completed'
}

/** Position in STATUS_ORDER; unknown statuses sort last. */
export function statusRank(raw: string | null | undefined): number {
  const status = normalizeStatus(raw)
  return status ? STATUS_ORDER.indexOf(status) : STATUS_ORDER.length
}

/** Only a Todo or In Progress task can be blocked. */
export function canBlock(raw: string | null | undefined): boolean {
  const status = normalizeStatus(raw)
  return status === 'Todo' || status === 'InProgress'
}

/** Status-badge cycle on the tasks page. Blocked is not in the cycle. */
export function nextCycleStatus(raw: string | null | undefined): RequestStatus | undefined {
  switch (normalizeStatus(raw)) {
    case 'Draft': return 'todo'
    case 'Todo': return 'inProgress'
    case 'InProgress': return 'completed'
    case 'Completed': return 'draft'
    default: return undefined
  }
}

/** Journal sort tiers: open (0), blocked (1), completed (2). Compares the PascalCase response value strictly. */
export function journalSortTier(status: string | null | undefined): number {
  if (status === 'Completed') return 2
  if (status === 'Blocked') return 1
  return 0
}

/** "N/M done" plus ", K blocked" only when K > 0. */
export function formatSubtaskProgress(done: number, total: number, blocked: number): string {
  return `${done}/${total} done${blocked > 0 ? `, ${blocked} blocked` : ''}`
}

/** User-facing message for the 422 codes the block flow can return, or null for other codes. */
export function getBlockErrorMessage(code: string | null): string | null {
  switch (code) {
    case 'TASK_BLOCK_DRAFT_NOT_ALLOWED':
    case 'TASK_BLOCK_COMPLETED_NOT_ALLOWED':
    case 'TASK_CREATE_BLOCKED_NOT_ALLOWED':
      return 'Only Todo or In Progress tasks can be blocked.'
    case 'TASK_START_NOT_ALLOWED':
      return 'Only Todo tasks can be moved to In Progress. Set it to Todo first.'
    case 'TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS':
      return 'A blocked reason can only be set on a blocked task.'
    default:
      return null
  }
}

// ─── Optimistic-update transforms ────────────────────────────────────────────

export interface BlockableFields {
  status?: string
  blockedReason?: string | null
  blockedAt?: string | null
  previousStatus?: string | null
  completedAt?: string | null
}

export function withBlocked<T extends BlockableFields>(task: T, reason: string | null): T {
  return {
    ...task,
    previousStatus: task.status ?? 'Todo',
    status: 'Blocked',
    blockedReason: reason,
    blockedAt: new Date().toISOString(),
  }
}

function clearBlocked<T extends BlockableFields>(task: T): T {
  return { ...task, blockedReason: null, blockedAt: null, previousStatus: null }
}

/** Mirrors the server: restore the previous status when restorable, otherwise Todo. */
export function withUnblocked<T extends BlockableFields>(task: T): T {
  const previous = normalizeStatus(task.previousStatus)
  const restored: TaskStatus = previous && RESTORABLE_STATUSES.includes(previous) ? previous : 'Todo'
  return { ...clearBlocked(task), status: restored }
}

/** Completing a Blocked task clears the three blocked fields. */
export function withBlockedCompleted<T extends BlockableFields>(task: T): T {
  return { ...clearBlocked(task), status: 'Completed' }
}

export function withBlockedReason<T extends BlockableFields>(task: T, reason: string | null): T {
  return { ...task, blockedReason: reason }
}

/**
 * Applies `fn` to the task with `id` inside cached query data. Handles list data
 * (array, children included) and single-task data; anything else is returned as is.
 */
export function mapCachedTask(
  data: unknown,
  id: number,
  fn: (task: BlockableFields & { id?: number | string }) => BlockableFields,
): unknown {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') {
      const row = value as BlockableFields & { id?: number | string; children?: unknown }
      const matched = row.id !== undefined && Number(row.id) === id ? (fn(row) as typeof row) : row
      if (Array.isArray(matched.children)) return { ...matched, children: matched.children.map(visit) }
      return matched
    }
    return value
  }
  if (data && typeof data === 'object' && 'data' in data) {
    const wrapper = data as { data?: unknown }
    return { ...wrapper, data: visit(wrapper.data) }
  }
  return data
}
