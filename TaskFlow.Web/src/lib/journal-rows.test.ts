import { describe, it, expect } from 'vitest'
import { buildJournalBlocks } from './journal-rows'
import type { JournalRowLike } from './journal-rows'

const row = (id: number, extra: Partial<JournalRowLike> = {}): JournalRowLike => ({
  id,
  title: `T${id}`,
  status: 'Todo',
  parentTaskItemId: null,
  ...extra,
})
const manual = () => 0
const shape = (blocks: ReturnType<typeof buildJournalBlocks>) =>
  blocks.map(b => `${b.header ? `H${b.header.parentId}:` : ''}${b.rows.map(r => r.id).join(',')}`)

describe('buildJournalBlocks', () => {
  it('returns plain rows as single-row blocks without headers', () => {
    const blocks = buildJournalBlocks([row(1), row(2)], manual)
    expect(blocks.every(b => b.header === null)).toBe(true)
    expect(shape(blocks)).toEqual(['1', '2'])
  })

  it('suppresses a parent with a visible open subtask and puts a header at the first subtask row', () => {
    const rows = [row(1), row(2, { parentTaskItemId: 1 }), row(3)]
    const blocks = buildJournalBlocks(rows, manual)
    expect(shape(blocks)).toEqual(['H1:2', '3'])
    expect(blocks[0].header).toEqual({ parentId: 1, title: 'T1', done: 0, total: 1 })
  })

  it('counts only the day subtask rows, and done counts Completed ones', () => {
    const rows = [
      row(1),
      row(2, { parentTaskItemId: 1 }),
      row(3, { parentTaskItemId: 1, status: 'Completed' }),
      row(4, { parentTaskItemId: 1, status: 'Blocked' }),
    ]
    const [block] = buildJournalBlocks(rows, manual)
    expect(block.header).toEqual({ parentId: 1, title: 'T1', done: 1, total: 3 })
    expect(block.rows.map(r => r.id)).toEqual([2, 3, 4])
  })

  it('keeps a parent as a normal row when its open subtasks are not rows of the day', () => {
    expect(shape(buildJournalBlocks([row(1)], manual))).toEqual(['1'])
  })

  it('keeps a stale-linked parent as a row when all its same-day subtasks are Completed, and still adds a header', () => {
    const rows = [row(1), row(2, { parentTaskItemId: 1, status: 'Completed' })]
    expect(shape(buildJournalBlocks(rows, manual))).toEqual(['1', 'H1:2'])
  })

  it('shows a Completed parent row and a header repeating its title, in sorted order', () => {
    const rows = [row(1, { status: 'Completed' }), row(2, { parentTaskItemId: 1, status: 'Completed' })]
    const blocks = buildJournalBlocks(rows, manual)
    expect(shape(blocks)).toEqual(['1', 'H1:2'])
    expect(blocks[1].header).toMatchObject({ title: 'T1', done: 1, total: 1 })
  })

  it('takes the header title from parentTitle when the parent is not a row of the day', () => {
    const rows = [row(5, { parentTaskItemId: 99, parentTitle: 'Off-day parent' })]
    const [block] = buildJournalBlocks(rows, manual)
    expect(block.header).toEqual({ parentId: 99, title: 'Off-day parent', done: 0, total: 1 })
  })

  it('shows a lone subtask without a title source as a plain row', () => {
    expect(shape(buildJournalBlocks([row(5, { parentTaskItemId: 99 })], manual))).toEqual(['5'])
  })

  it('places each header at its first row in sorted order, never sorted as a todo', () => {
    // open (0), then completed (1)
    const tier = (a: JournalRowLike, b: JournalRowLike) =>
      Number(a.status === 'Completed') - Number(b.status === 'Completed')
    const rows = [
      row(1, { status: 'Completed' }),
      row(2),
      row(3, { parentTaskItemId: 2, status: 'Completed' }),
      row(4, { parentTaskItemId: 2 }),
    ]
    // Sorted: 2? No: 2 is a suppressed parent. Open rows first (4), then completed (1, 3).
    const blocks = buildJournalBlocks(rows, tier)
    expect(shape(blocks)).toEqual(['H2:4,3', '1'])
  })

  it('treats a Blocked open subtask as open for suppression (getOpenParentIds)', () => {
    const rows = [row(1), row(2, { parentTaskItemId: 1, status: 'Blocked' })]
    expect(shape(buildJournalBlocks(rows, manual))).toEqual(['H1:2'])
  })

  it('never lets the input array be reordered', () => {
    const rows = [row(2), row(1)]
    buildJournalBlocks(rows, (a, b) => Number(a.id) - Number(b.id))
    expect(rows.map(r => r.id)).toEqual([2, 1])
  })
})
