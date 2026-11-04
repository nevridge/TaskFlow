import { getOpenParentIds } from '@/lib/task-sections'

export interface JournalRowLike {
  id?: number | string | null
  title?: string | null
  status?: string | null
  parentTaskItemId?: number | string | null
  parentTitle?: string | null
}

export interface JournalHeaderData {
  parentId: number
  title: string
  /** Completed subtask rows of this day. */
  done: number
  /** Subtask rows of this day for the parent (visible ones only). */
  total: number
}

/** A context header (when set) followed by its rows, or a single plain row (header null). */
export interface JournalBlock<T extends JournalRowLike> {
  header: JournalHeaderData | null
  rows: T[]
}

function toId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n !== 0 ? n : null
}

/**
 * Turns the day's flat todo rows into display blocks.
 * - A parent with at least one visible open subtask row is not a row: only its header shows.
 * - A parent whose open subtasks are all absent from the day (or whose subtasks are all Completed) stays a row.
 * - Every parent with at least one subtask row of the day gets a header (a Completed parent keeps its own row too).
 * - A subtask whose parent is not a row of the day takes the header title from `parentTitle`.
 * - Headers are never sorted as todos: each sits at the position of its first subtask row, and holds all that
 *   parent's subtask rows in sorted order.
 * Counts are the caller's business: only the rows in the blocks are todos.
 */
export function buildJournalBlocks<T extends JournalRowLike>(
  rows: readonly T[],
  compare: (a: T, b: T) => number,
): JournalBlock<T>[] {
  const sorted = [...rows].sort(compare)
  const rowById = new Map<number, T>()
  rows.forEach(r => {
    const id = toId(r.id)
    if (id !== null) rowById.set(id, r)
  })
  const openParents = getOpenParentIds(rows)

  const blocks: JournalBlock<T>[] = []
  const groups = new Map<number, JournalBlock<T>>()

  sorted.forEach(row => {
    const ownId = toId(row.id)
    if (ownId !== null && openParents.has(ownId)) return
    const parentId = toId(row.parentTaskItemId)
    if (parentId !== null) {
      const existing = groups.get(parentId)
      if (existing) {
        existing.rows.push(row)
        return
      }
      const title = rowById.get(parentId)?.title ?? row.parentTitle
      if (title != null) {
        const block: JournalBlock<T> = { header: { parentId, title, done: 0, total: 0 }, rows: [row] }
        groups.set(parentId, block)
        blocks.push(block)
        return
      }
    }
    blocks.push({ header: null, rows: [row] })
  })

  groups.forEach(block => {
    if (!block.header) return
    block.header.total = block.rows.length
    block.header.done = block.rows.filter(r => r.status === 'Completed').length
  })
  return blocks
}
