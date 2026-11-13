import { describe, it, expect } from 'vitest'
import {
  buildTaskSections,
  findSectionOfTask,
  findSectionShowingTask,
  getOpenParentIds,
  indexTasksById,
  matchesSearchWithAncestors,
  SECTION_DEFS,
  type SectionTaskLike,
} from './task-sections'

interface T extends SectionTaskLike {
  id: number
}

const t = (id: number, title: string, status: string, priority: string | null | undefined, parent: number | null = null): T => ({
  id,
  title,
  status,
  priority,
  parentTaskItemId: parent,
})

const byTitle = (a: T, b: T) => a.title.localeCompare(b.title)

function build(all: T[], visible: T[] = all, compare = byTitle) {
  return buildTaskSections({ allTasks: all, visibleTasks: visible, compare })
}

const rowTitles = (sections: ReturnType<typeof build>, key: string) =>
  sections.find(s => s.key === key)?.blocks.flatMap(b => b.rows.map(r => r.title)) ?? []

describe('buildTaskSections', () => {
  it('orders sections inProgress, high, medium, low, blocked, draft, completed and omits empty ones', () => {
    const all = [
      t(1, 'a', 'Completed', 'Low'),
      t(2, 'b', 'Draft', 'Low'),
      t(3, 'c', 'Blocked', 'High'),
      t(4, 'd', 'Todo', 'Low'),
      t(5, 'e', 'Todo', 'Medium'),
      t(6, 'f', 'Todo', 'High'),
      t(7, 'g', 'InProgress', 'Low'),
    ]
    expect(build(all).map(s => s.key)).toEqual(['inProgress', 'high', 'medium', 'low', 'blocked', 'draft', 'completed'])
    expect(build([t(1, 'a', 'Todo', 'Low'), t(2, 'b', 'Completed', 'Low')]).map(s => s.key)).toEqual(['low', 'completed'])
    expect(build([])).toEqual([])
  })

  it('places each task once, by its own status and priority, so siblings can differ', () => {
    const all = [
      t(1, 'Goal', 'Todo', 'High'),
      t(2, 'Sibling high', 'Todo', 'High', 1),
      t(3, 'Sibling low', 'Todo', 'Low', 1),
      t(4, 'Sibling doing', 'InProgress', 'Low', 1),
    ]
    const sections = build(all)
    expect(rowTitles(sections, 'high')).toEqual(['Sibling high'])
    expect(rowTitles(sections, 'low')).toEqual(['Sibling low'])
    expect(rowTitles(sections, 'inProgress')).toEqual(['Sibling doing'])
    const placed = sections.flatMap(s => s.blocks.flatMap(b => b.rows.map(r => r.id)))
    expect(placed.sort()).toEqual([2, 3, 4])
  })

  it('maps lowercase statuses and priorities too', () => {
    const sections = build([t(1, 'a', 'todo', 'medium'), t(2, 'b', 'inprogress', 'low')])
    expect(rowTitles(sections, 'medium')).toEqual(['a'])
    expect(rowTitles(sections, 'inProgress')).toEqual(['b'])
  })

  it.each([
    ['null', null],
    ['missing', undefined],
    ['unrecognized', 'Urgent'],
  ])('puts a Todo task with a %s priority in High', (_label, priority) => {
    expect(rowTitles(build([t(1, 'a', 'Todo', priority)]), 'high')).toEqual(['a'])
  })

  it('puts an unrecognized-status task in its priority section, High when the priority is missing', () => {
    const sections = build([t(1, 'odd', 'Mystery', 'Medium'), t(2, 'odder', 'Mystery', undefined)])
    expect(rowTitles(sections, 'medium')).toEqual(['odd'])
    expect(rowTitles(sections, 'high')).toEqual(['odder'])
  })

  it.each(['Todo', 'InProgress', 'Blocked'])('a parent with a %s subtask is not a work row but heads that subtask', status => {
    const sections = build([t(1, 'Parent', 'Todo', 'High'), t(2, 'Kid', status, 'High', 1)])
    const all = sections.flatMap(s => s.blocks.flatMap(b => b.rows.map(r => r.title)))
    expect(all).toEqual(['Kid'])
    const block = sections.flatMap(s => s.blocks)[0]
    expect(block.header?.parentId).toBe(1)
    expect(block.header?.path).toEqual([{ id: 1, title: 'Parent' }])
  })

  it('gives a parent a header in each section holding one of its subtasks, listing only that section\'s subtasks', () => {
    const all = [
      t(1, 'Parent', 'Todo', 'High'),
      t(2, 'K high', 'Todo', 'High', 1),
      t(3, 'K low', 'Todo', 'Low', 1),
      t(4, 'K low two', 'Todo', 'Low', 1),
    ]
    const sections = build(all)
    const high = sections.find(s => s.key === 'high')!
    const low = sections.find(s => s.key === 'low')!
    expect(high.blocks).toHaveLength(1)
    expect(high.blocks[0].rows.map(r => r.title)).toEqual(['K high'])
    expect(low.blocks).toHaveLength(1)
    expect(low.blocks[0].header?.parentId).toBe(1)
    expect(low.blocks[0].rows.map(r => r.title)).toEqual(['K low', 'K low two'])
  })

  it('a parent with no open subtasks is a normal row; its completed subtasks sit under a Completed header', () => {
    const all = [
      t(1, 'Parent', 'Todo', 'Medium'),
      t(2, 'Done kid', 'Completed', 'Medium', 1),
    ]
    const sections = build(all)
    expect(rowTitles(sections, 'medium')).toEqual(['Parent'])
    expect(sections.find(s => s.key === 'medium')!.blocks[0].header).toBeNull()
    const completed = sections.find(s => s.key === 'completed')!
    expect(completed.blocks[0].header?.parentId).toBe(1)
    expect(completed.blocks[0].rows.map(r => r.title)).toEqual(['Done kid'])
  })

  it('an open parent also gets a Completed header above its completed subtask, and is never a work row', () => {
    const all = [
      t(1, 'Parent', 'Todo', 'High'),
      t(2, 'Open kid', 'Todo', 'High', 1),
      t(3, 'Done kid', 'Completed', 'High', 1),
    ]
    const sections = build(all)
    expect(sections.map(s => s.key)).toEqual(['high', 'completed'])
    expect(sections.every(s => s.blocks.every(b => b.header?.parentId === 1))).toBe(true)
    expect(sections.flatMap(s => s.blocks.flatMap(b => b.rows.map(r => r.id))).sort()).toEqual([2, 3])
  })

  it('a Completed parent with Completed subtasks keeps its row and its header (no special case)', () => {
    const all = [t(1, 'Parent', 'Completed', 'Low'), t(2, 'Kid', 'Completed', 'Low', 1)]
    const completed = build(all).find(s => s.key === 'completed')!
    expect(completed.workRowCount).toBe(2)
    expect(completed.blocks.map(b => b.header?.parentId ?? null).sort()).toEqual([1, null])
  })

  it('builds the header path from the top-level goal to the nearest parent at any depth', () => {
    const two = build([t(1, 'Goal', 'Todo', 'High'), t(2, 'Kid', 'Todo', 'High', 1)])
    expect(two[0].blocks[0].header?.path).toEqual([{ id: 1, title: 'Goal' }])

    const three = build([
      t(1, 'Goal', 'Todo', 'High'),
      t(2, 'Middle', 'Todo', 'High', 1),
      t(3, 'Leaf', 'Todo', 'High', 2),
    ])
    const leafBlock = three[0].blocks.find(b => b.rows.some(r => r.title === 'Leaf'))!
    expect(leafBlock.header?.path).toEqual([
      { id: 1, title: 'Goal' },
      { id: 2, title: 'Middle' },
    ])
  })

  it('keeps a parent as a work row when filters hide all its open subtasks', () => {
    const parent = t(1, 'Parent', 'Todo', 'High')
    const openKid = t(2, 'Open kid', 'Todo', 'High', 1)
    const doneKid = t(3, 'Done kid', 'Completed', 'High', 1)
    const sections = build([parent, openKid, doneKid], [parent, doneKid])
    expect(rowTitles(sections, 'high')).toEqual(['Parent'])
    expect(rowTitles(sections, 'completed')).toEqual(['Done kid'])
  })

  it('still shows a header when the parent is outside the visible set (another project)', () => {
    const parent = t(1, 'Other project parent', 'Todo', 'High')
    const kid = t(2, 'Kid', 'Todo', 'High', 1)
    const sections = build([parent, kid], [kid])
    expect(sections[0].blocks[0].header?.path).toEqual([{ id: 1, title: 'Other project parent' }])
  })

  it('counts work rows only', () => {
    const all = [
      t(1, 'Parent', 'Todo', 'High'),
      t(2, 'K1', 'Todo', 'High', 1),
      t(3, 'K2', 'Todo', 'High', 1),
      t(4, 'Solo', 'Todo', 'High'),
    ]
    expect(build(all)[0].workRowCount).toBe(3)
  })

  it('treats a subtask whose parent is missing from the list as a standalone row', () => {
    const sections = build([t(2, 'Orphan', 'Todo', 'High', 99)])
    expect(sections[0].blocks).toEqual([{ header: null, rows: [expect.objectContaining({ id: 2 })] }])
  })

  it('does not loop on a cyclic parent chain', () => {
    const all = [t(1, 'A', 'Todo', 'High', 2), t(2, 'B', 'Todo', 'High', 1)]
    expect(() => build(all)).not.toThrow()
    const a = t(1, 'A', 'Todo', 'High', 2)
    const b = t(2, 'B', 'Completed', 'High', 1)
    const sections = build([a, b])
    expect(sections.flatMap(s => s.blocks).every(blk => (blk.header?.path.length ?? 0) <= 2)).toBe(true)
  })

  it('orders blocks by the comparator, keyed on the parent for header blocks, and breaks ties by id', () => {
    const all = [
      t(10, 'Zed parent', 'Todo', 'High'),
      t(11, 'child of zed', 'Todo', 'High', 10),
      t(20, 'Alpha parent', 'Todo', 'High'),
      t(21, 'zzz child of alpha', 'Todo', 'High', 20),
      t(30, 'Middle solo', 'Todo', 'High'),
    ]
    const high = build(all).find(s => s.key === 'high')!
    expect(high.blocks.map(b => b.header?.parentId ?? b.rows[0].id)).toEqual([20, 30, 10])

    const ties = [t(7, 'Same', 'Todo', 'High'), t(5, 'Same', 'Todo', 'High'), t(6, 'Same', 'Todo', 'High')]
    expect(build(ties)[0].blocks.map(b => b.rows[0].id)).toEqual([5, 6, 7])
  })

  it('sorts rows inside a block with the comparator', () => {
    const all = [
      t(1, 'Parent', 'Todo', 'High'),
      t(2, 'b kid', 'Todo', 'High', 1),
      t(3, 'a kid', 'Todo', 'High', 1),
    ]
    expect(build(all)[0].blocks[0].rows.map(r => r.title)).toEqual(['a kid', 'b kid'])
  })

  it('exposes labels and collapse defaults', () => {
    expect(SECTION_DEFS.blocked.defaultCollapsed).toBe(true)
    expect(SECTION_DEFS.completed.defaultCollapsed).toBe(true)
    expect(SECTION_DEFS.high.defaultCollapsed).toBe(false)
    expect(SECTION_DEFS.inProgress.label).toBe('In Progress')
  })
})

describe('findSectionOfTask', () => {
  it('finds the section holding a work row, or undefined', () => {
    const sections = build([t(1, 'a', 'Todo', 'Low'), t(2, 'b', 'Completed', 'Low')])
    expect(findSectionOfTask(sections, 2)?.key).toBe('completed')
    expect(findSectionOfTask(sections, 99)).toBeUndefined()
  })
})

describe('indexTasksById', () => {
  it('skips tasks without a usable id', () => {
    const map = indexTasksById([{ title: 'x' }, { id: 3, title: 'y' }, { id: '4', title: 'z' }] as SectionTaskLike[])
    expect([...map.keys()]).toEqual([3, 4])
  })
})

describe('matchesSearchWithAncestors', () => {
  const all = [
    t(1, 'Plan the trip', 'Todo', 'High'),
    t(2, 'Book flights', 'Todo', 'High', 1),
    t(3, 'Pick seats', 'Todo', 'High', 2),
    t(4, 'Unrelated', 'Todo', 'High'),
  ]
  const byId = indexTasksById(all)

  it('matches on the task\'s own title, case-insensitively', () => {
    expect(matchesSearchWithAncestors(all[1], byId, 'FLIGHTS')).toBe(true)
    expect(matchesSearchWithAncestors(all[3], byId, 'flights')).toBe(false)
  })

  it('matches when any ancestor title matches', () => {
    expect(matchesSearchWithAncestors(all[1], byId, 'trip')).toBe(true)
    expect(matchesSearchWithAncestors(all[2], byId, 'trip')).toBe(true)
    expect(matchesSearchWithAncestors(all[3], byId, 'trip')).toBe(false)
  })

  it('treats an empty term as a match and survives a cycle', () => {
    expect(matchesSearchWithAncestors(all[0], byId, '')).toBe(true)
    const loop = [t(1, 'A', 'Todo', 'High', 2), t(2, 'B', 'Todo', 'High', 1)]
    expect(matchesSearchWithAncestors(loop[0], indexTasksById(loop), 'zzz')).toBe(false)
  })

  it('stops at a parent missing from the map', () => {
    expect(matchesSearchWithAncestors(t(9, 'Orphan', 'Todo', 'High', 77), byId, 'trip')).toBe(false)
  })
})

describe('buildTaskSections with a derived status', () => {
  it('places a parent whose open subtasks are filtered out by its derived status', () => {
    const parent = t(1, 'Parent', 'Todo', 'Low')
    const child = t(2, 'Child', 'InProgress', 'Low', 1)
    const statusOf = (task: T) => (task.id === 1 ? 'InProgress' : task.status)
    const sections = buildTaskSections({ allTasks: [parent, child], visibleTasks: [parent], compare: byTitle, statusOf })
    expect(sections.map(s => s.key)).toEqual(['inProgress'])
    expect(rowTitles(sections, 'inProgress')).toEqual(['Parent'])
  })

  it('falls back to the stored status without statusOf', () => {
    const sections = buildTaskSections({ allTasks: [t(1, 'P', 'Draft', 'Low')], visibleTasks: [t(1, 'P', 'Draft', 'Low')], compare: byTitle })
    expect(sections.map(s => s.key)).toEqual(['draft'])
  })
})

describe('getOpenParentIds', () => {
  const task = (id: number, status: string, parentTaskItemId: number | null = null) => ({ id, title: `T${id}`, status, parentTaskItemId })

  it('collects parents that have at least one visible subtask that is not Completed (Blocked counts as open)', () => {
    const ids = getOpenParentIds([task(1, 'Todo'), task(2, 'Todo', 1), task(3, 'Completed'), task(4, 'Completed', 3), task(5, 'Todo'), task(6, 'Blocked', 5)])
    expect([...ids].sort()).toEqual([1, 5])
  })

  it('ignores rows without a parent and returns an empty set for nothing visible', () => {
    expect(getOpenParentIds([task(1, 'Todo')]).size).toBe(0)
    expect(getOpenParentIds([]).size).toBe(0)
  })
})

describe('findSectionShowingTask', () => {
  it('finds a work row, a header-only parent, the first of several sections, and nothing for an absent id', () => {
    const all = [
      t(1, 'Parent', 'Todo', 'High'),
      t(2, 'Low child', 'Todo', 'Low', 1),
      t(3, 'High child', 'Todo', 'High', 1),
      t(4, 'Solo', 'Completed', 'High'),
    ]
    const sections = build(all)
    expect(findSectionShowingTask(sections, 4)?.key).toBe('completed')
    expect(findSectionShowingTask(sections, 2)?.key).toBe('low')
    // The parent has no row; it heads blocks in both high and low, and high comes first.
    expect(findSectionShowingTask(sections, 1)?.key).toBe('high')
    expect(findSectionShowingTask(sections, 99)).toBeUndefined()
  })
})
