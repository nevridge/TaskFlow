import { STATUS_ORDER, toRequestStatus, type RequestStatus } from '@/lib/task-status'

export type ViewFilter = 'all' | 'activeToday' | 'scheduledFuture' | 'completedHistory'
export type ProjectFilter = 'all' | 'none' | number

export interface TaskFilters {
  search: string
  statuses: Set<RequestStatus>
  view: ViewFilter
  project: ProjectFilter
}

const ALL_STATUSES: readonly RequestStatus[] = STATUS_ORDER.map(toRequestStatus)
const VIEWS: readonly ViewFilter[] = ['all', 'activeToday', 'scheduledFuture', 'completedHistory']
const STATUS_NONE = 'none'

function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key)
  return values.length === 1 ? values[0] : null
}

function parseStatuses(params: URLSearchParams): Set<RequestStatus> {
  const all = () => new Set<RequestStatus>(ALL_STATUSES)
  const values = params.getAll('status')
  if (values.length === 0) return all()
  if (values.includes(STATUS_NONE)) return values.length === 1 ? new Set() : all()
  const parsed = new Set<RequestStatus>()
  for (const v of values) {
    const match = ALL_STATUSES.find(s => s === v)
    if (!match) return all()
    parsed.add(match)
  }
  return parsed
}

/** Strict parse of the Tasks page filters; every filter falls back to its default independently. */
export function parseTaskFilters(params: URLSearchParams): TaskFilters {
  const view = single(params, 'view')
  const project = single(params, 'project')
  return {
    search: single(params, 'q') ?? '',
    statuses: parseStatuses(params),
    view: VIEWS.find(v => v === view) ?? 'all',
    project: project === 'none' ? 'none' : project !== null && /^[1-9]\d*$/.test(project) ? Number(project) : 'all',
  }
}

/** The query string ('' or starting with '?') for the filters; defaults are omitted. */
export function buildTaskFiltersSearch(f: TaskFilters): string {
  const params = new URLSearchParams()
  if (f.search !== '') params.set('q', f.search)
  if (f.statuses.size === 0) params.set('status', STATUS_NONE)
  else if (f.statuses.size !== ALL_STATUSES.length) {
    ALL_STATUSES.filter(s => f.statuses.has(s)).forEach(s => params.append('status', s))
  }
  if (f.view !== 'all') params.set('view', f.view)
  if (f.project !== 'all') params.set('project', String(f.project))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}
