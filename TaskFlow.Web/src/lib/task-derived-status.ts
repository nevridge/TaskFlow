import { normalizeStatus, type TaskStatus } from '@/lib/task-status'

/**
 * Display-only status for parent tasks (Tasks page and task detail page). A parent with an open subtask
 * (stored status not Completed) shows a status derived from its open subtasks, recursively. The result is
 * computed in render and never written to the query cache; the stored status is untouched.
 */

export interface DerivableTask {
  id?: number | string | null
  status?: string | null
  parentTaskItemId?: number | string | null
}

export interface DerivedInfo {
  /** Derived PascalCase status when `isDerived`, otherwise the stored status as received. */
  displayStatus: string | undefined
  /** True while at least one direct subtask is open; status controls are read-only then. */
  isDerived: boolean
  /** Direct subtasks whose stored status is not Completed. */
  openChildCount: number
  /** Direct subtasks that are Completed. */
  directDone: number
  /** All direct subtasks, Completed included. */
  directTotal: number
  /** Direct subtasks whose display status is In Progress. */
  directInProgress: number
}

function toId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n !== 0 ? n : null
}

function deriveFromOpen(openDisplay: Array<TaskStatus | undefined>): TaskStatus {
  if (openDisplay.some(s => s === 'InProgress')) return 'InProgress'
  if (openDisplay.every(s => s === 'Blocked')) return 'Blocked'
  if (openDisplay.every(s => s === 'Draft')) return 'Draft'
  return 'Todo'
}

/** Derived info for every task with a valid id. Cycle-safe: a task already being resolved keeps its stored status. */
export function deriveTaskStatuses(tasks: readonly DerivableTask[]): Map<number, DerivedInfo> {
  const byId = new Map<number, DerivableTask>()
  const childrenOf = new Map<number, DerivableTask[]>()
  tasks.forEach(t => {
    const id = toId(t.id)
    if (id !== null) byId.set(id, t)
  })
  tasks.forEach(t => {
    const parentId = toId(t.parentTaskItemId)
    if (parentId === null || !byId.has(parentId)) return
    const list = childrenOf.get(parentId) ?? []
    list.push(t)
    childrenOf.set(parentId, list)
  })

  const result = new Map<number, DerivedInfo>()
  const visiting = new Set<number>()

  const resolve = (id: number): DerivedInfo => {
    const cached = result.get(id)
    if (cached) return cached
    const task = byId.get(id) as DerivableTask
    const children = childrenOf.get(id) ?? []
    const stored: DerivedInfo = {
      displayStatus: task.status ?? undefined,
      isDerived: false,
      openChildCount: 0,
      directDone: 0,
      directTotal: children.length,
      directInProgress: 0,
    }
    if (visiting.has(id)) return stored
    visiting.add(id)

    let directDone = 0
    let directInProgress = 0
    const openDisplay: Array<TaskStatus | undefined> = []
    children.forEach(child => {
      const childId = toId(child.id) as number
      const childDisplay = normalizeStatus(visiting.has(childId) ? child.status : resolve(childId).displayStatus)
      if (childDisplay === 'InProgress') directInProgress++
      if (normalizeStatus(child.status) === 'Completed') directDone++
      else openDisplay.push(childDisplay)
    })
    visiting.delete(id)

    const info: DerivedInfo = openDisplay.length === 0
      ? { ...stored, directDone, directInProgress }
      : {
          displayStatus: deriveFromOpen(openDisplay),
          isDerived: true,
          openChildCount: openDisplay.length,
          directDone,
          directTotal: children.length,
          directInProgress,
        }
    // A result computed while an ancestor was mid-resolution on a cycle is still deterministic per start node,
    // so caching it is safe for acyclic data and harmless for cyclic data.
    result.set(id, info)
    return info
  }

  byId.forEach((_task, id) => { resolve(id) })
  return result
}

/** "1 of 4 done" plus " · 1 in progress" only when at least one direct subtask is In Progress. */
export function getParentProgressLabel(info: Pick<DerivedInfo, 'directDone' | 'directTotal' | 'directInProgress'>): string {
  const base = `${info.directDone} of ${info.directTotal} done`
  return info.directInProgress > 0 ? `${base} · ${info.directInProgress} in progress` : base
}

/** Tooltip for a derived (locked) status. */
export function getDerivedStatusTitle(openChildCount: number): string {
  return `Status follows its ${openChildCount} open ${openChildCount === 1 ? 'subtask' : 'subtasks'}. Complete or remove them to change it.`
}
