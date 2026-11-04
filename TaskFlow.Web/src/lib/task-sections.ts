import { normalizeStatus } from '@/lib/task-status'

export type SectionKey = 'inProgress' | 'high' | 'medium' | 'low' | 'blocked' | 'draft' | 'completed'

interface SectionDef {
  key: SectionKey
  label: string
  cssModifier: string
  defaultCollapsed: boolean
}

/** Section order on the Tasks page (inProgress, high, medium, low, blocked, draft, completed). */
export const SECTION_ORDER: readonly SectionKey[] = [
  'inProgress',
  'high',
  'medium',
  'low',
  'blocked',
  'draft',
  'completed',
]

export const SECTION_DEFS: Record<SectionKey, SectionDef> = {
  inProgress: { key: 'inProgress', label: 'In Progress', cssModifier: 'inprogress', defaultCollapsed: false },
  high: { key: 'high', label: 'High Priority', cssModifier: 'high', defaultCollapsed: false },
  medium: { key: 'medium', label: 'Medium Priority', cssModifier: 'medium', defaultCollapsed: false },
  low: { key: 'low', label: 'Low Priority', cssModifier: 'low', defaultCollapsed: false },
  blocked: { key: 'blocked', label: 'Blocked', cssModifier: 'blocked', defaultCollapsed: true },
  draft: { key: 'draft', label: 'Draft', cssModifier: 'draft', defaultCollapsed: false },
  completed: { key: 'completed', label: 'Completed', cssModifier: 'completed', defaultCollapsed: true },
}

export interface SectionTaskLike {
  id?: number | string | null
  title: string
  status?: string | null
  priority?: string | null
  parentTaskItemId?: number | string | null
}

export interface HeaderPathSegment {
  id: number
  title: string
}

export interface SectionBlock<T extends SectionTaskLike> {
  header: { parentId: number; path: HeaderPathSegment[] } | null
  rows: T[]
}

export interface TaskSection<T extends SectionTaskLike> {
  key: SectionKey
  label: string
  cssModifier: string
  workRowCount: number
  blocks: SectionBlock<T>[]
}

function toId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n !== 0 ? n : null
}

function parentIdOf(task: Pick<SectionTaskLike, 'parentTaskItemId'>): number | null {
  return toId(task.parentTaskItemId)
}

/** Priority section for a Todo or unrecognized-status task. Missing or unrecognized priority is High. */
function prioritySection(priority: string | null | undefined): SectionKey {
  const p = (priority ?? '').toLowerCase()
  if (p === 'medium') return 'medium'
  if (p === 'low') return 'low'
  return 'high'
}

function sectionFor(task: SectionTaskLike, status: string | null | undefined): SectionKey {
  switch (normalizeStatus(status)) {
    case 'InProgress': return 'inProgress'
    case 'Blocked': return 'blocked'
    case 'Draft': return 'draft'
    case 'Completed': return 'completed'
    default: return prioritySection(task.priority)
  }
}

/** Titles from the top-level goal down to the nearest parent. Cycle-safe. */
function headerPath<T extends SectionTaskLike>(parentId: number, byId: Map<number, T>): HeaderPathSegment[] {
  const path: HeaderPathSegment[] = []
  const visited = new Set<number>()
  let current: number | null = parentId
  while (current !== null && !visited.has(current)) {
    visited.add(current)
    const task = byId.get(current)
    if (!task) break
    path.unshift({ id: current, title: task.title })
    current = parentIdOf(task)
  }
  return path
}

export function indexTasksById<T extends SectionTaskLike>(tasks: readonly T[]): Map<number, T> {
  const byId = new Map<number, T>()
  tasks.forEach(t => {
    const id = toId(t.id)
    if (id !== null) byId.set(id, t)
  })
  return byId
}

/** True when the task's own title or any ancestor's title contains the (case-insensitive) term. */
export function matchesSearchWithAncestors<T extends SectionTaskLike>(
  task: T,
  byId: Map<number, T>,
  term: string,
): boolean {
  const needle = term.toLowerCase()
  if (!needle) return true
  const visited = new Set<number>()
  let current: SectionTaskLike | undefined = task
  while (current) {
    if (current.title.toLowerCase().includes(needle)) return true
    const parentId = parentIdOf(current)
    if (parentId === null || visited.has(parentId)) return false
    visited.add(parentId)
    current = byId.get(parentId)
  }
  return false
}

/** Ids of parents with at least one visible subtask that is not Completed (Blocked counts as open). */
export function getOpenParentIds(
  visibleTasks: readonly Pick<SectionTaskLike, 'parentTaskItemId' | 'status'>[],
): Set<number> {
  const openParentIds = new Set<number>()
  visibleTasks.forEach(t => {
    const parentId = parentIdOf(t)
    if (parentId !== null && normalizeStatus(t.status) !== 'Completed') openParentIds.add(parentId)
  })
  return openParentIds
}

interface BuildArgs<T extends SectionTaskLike> {
  allTasks: readonly T[]
  visibleTasks: readonly T[]
  compare: (a: T, b: T) => number
  /** Status used for placement; defaults to the stored status. The Tasks page passes the derived status. */
  statusOf?: (task: T) => string | null | undefined
}

/**
 * Places every visible task once, as a work row, in the section set by its own status and priority.
 * A parent with a visible open subtask (anything not Completed, so Blocked counts) is not a work row; it
 * only appears as a context header over its subtasks in each section that holds one. A parent whose open
 * subtasks are all filtered out stays a work row, because no header would otherwise show it.
 */
export function buildTaskSections<T extends SectionTaskLike>({
  allTasks,
  visibleTasks,
  compare,
  statusOf = t => t.status,
}: BuildArgs<T>): TaskSection<T>[] {
  const byId = indexTasksById(allTasks)
  const openParentIds = getOpenParentIds(visibleTasks)

  const idOf = (t: T) => toId(t.id) ?? 0
  const stable = (a: T, b: T) => compare(a, b) || idOf(a) - idOf(b)

  const buckets = new Map<SectionKey, T[]>()
  visibleTasks.forEach(t => {
    const id = toId(t.id)
    if (id !== null && openParentIds.has(id)) return
    const key = sectionFor(t, statusOf(t))
    const list = buckets.get(key) ?? []
    list.push(t)
    buckets.set(key, list)
  })

  const sections: TaskSection<T>[] = []
  SECTION_ORDER.forEach(key => {
    const rows = buckets.get(key)
    if (!rows || rows.length === 0) return
    const headerBlocks = new Map<number, T[]>()
    const standalone: T[] = []
    rows.forEach(row => {
      const parentId = parentIdOf(row)
      if (parentId !== null && byId.has(parentId)) {
        const list = headerBlocks.get(parentId) ?? []
        list.push(row)
        headerBlocks.set(parentId, list)
      } else {
        standalone.push(row)
      }
    })

    const keyed: Array<{ sortKey: T; block: SectionBlock<T> }> = []
    headerBlocks.forEach((children, parentId) => {
      keyed.push({
        sortKey: byId.get(parentId) as T,
        block: { header: { parentId, path: headerPath(parentId, byId) }, rows: [...children].sort(stable) },
      })
    })
    standalone.forEach(row => keyed.push({ sortKey: row, block: { header: null, rows: [row] } }))
    keyed.sort((a, b) => stable(a.sortKey, b.sortKey))

    const def = SECTION_DEFS[key]
    sections.push({
      key,
      label: def.label,
      cssModifier: def.cssModifier,
      workRowCount: rows.length,
      blocks: keyed.map(k => k.block),
    })
  })
  return sections
}

/** The section holding the task as a work row, if any. */
export function findSectionOfTask<T extends SectionTaskLike>(
  sections: readonly TaskSection<T>[],
  id: number,
): TaskSection<T> | undefined {
  return sections.find(s => s.blocks.some(b => b.rows.some(r => toId(r.id) === id)))
}
