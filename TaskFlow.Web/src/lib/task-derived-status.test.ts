import { describe, it, expect } from 'vitest'
import { deriveTaskStatuses, getDerivedStatusTitle, getParentProgressLabel } from './task-derived-status'

interface T { id: number; status: string; parentTaskItemId?: number | null }

const t = (id: number, status: string, parentTaskItemId: number | null = null): T => ({ id, status, parentTaskItemId })

function display(tasks: T[], id: number) {
  return deriveTaskStatuses(tasks).get(id)?.displayStatus
}

describe('deriveTaskStatuses', () => {
  it('shows In Progress when any open subtask is In Progress', () => {
    expect(display([t(1, 'Draft'), t(2, 'InProgress', 1), t(3, 'Blocked', 1)], 1)).toBe('InProgress')
  })

  it('shows Blocked when all open subtasks are Blocked', () => {
    expect(display([t(1, 'Todo'), t(2, 'Blocked', 1), t(3, 'Blocked', 1)], 1)).toBe('Blocked')
  })

  it('shows Draft when all open subtasks are Draft', () => {
    expect(display([t(1, 'Todo'), t(2, 'Draft', 1), t(3, 'Draft', 1)], 1)).toBe('Draft')
  })

  it('otherwise shows To-do', () => {
    expect(display([t(1, 'Draft'), t(2, 'Draft', 1), t(3, 'Todo', 1)], 1)).toBe('Todo')
    expect(display([t(1, 'Draft'), t(2, 'Blocked', 1), t(3, 'Draft', 1)], 1)).toBe('Todo')
  })

  it('ignores Completed subtasks', () => {
    expect(display([t(1, 'Todo'), t(2, 'Completed', 1), t(3, 'Draft', 1)], 1)).toBe('Draft')
    expect(display([t(1, 'Todo'), t(2, 'Completed', 1), t(3, 'Blocked', 1)], 1)).toBe('Blocked')
  })

  it('keeps the stored status when all subtasks are Completed or there are none', () => {
    const info = deriveTaskStatuses([t(1, 'Blocked'), t(2, 'Completed', 1), t(4, 'Draft')])
    expect(info.get(1)).toMatchObject({ displayStatus: 'Blocked', isDerived: false, openChildCount: 0 })
    expect(info.get(4)).toMatchObject({ displayStatus: 'Draft', isDerived: false, directTotal: 0 })
  })

  it('recurses: an In Progress grandchild makes both ancestors In Progress', () => {
    const info = deriveTaskStatuses([t(1, 'Draft'), t(2, 'Draft', 1), t(3, 'InProgress', 2)])
    expect(info.get(2)?.displayStatus).toBe('InProgress')
    expect(info.get(1)?.displayStatus).toBe('InProgress')
  })

  it('uses the derived status of an inner parent, not its stored one', () => {
    // Inner parent is stored Todo but all its open children are Blocked, so it is Blocked for the root.
    const info = deriveTaskStatuses([t(1, 'Todo'), t(2, 'Todo', 1), t(3, 'Blocked', 2)])
    expect(info.get(2)?.displayStatus).toBe('Blocked')
    expect(info.get(1)?.displayStatus).toBe('Blocked')
  })

  it('does not hang on cycles', () => {
    const info = deriveTaskStatuses([t(1, 'Todo', 2), t(2, 'Draft', 1), t(3, 'Todo', 3)])
    expect(info.size).toBe(3)
  })

  it('accepts case-insensitive statuses and string ids', () => {
    const info = deriveTaskStatuses([
      { id: '1', status: 'todo' },
      { id: '2', status: 'inprogress', parentTaskItemId: '1' },
    ])
    expect(info.get(1)?.displayStatus).toBe('InProgress')
  })

  it('counts direct progress including Completed in the total', () => {
    const info = deriveTaskStatuses([t(1, 'Todo'), t(2, 'Completed', 1), t(3, 'InProgress', 1), t(4, 'Todo', 1), t(5, 'Draft', 1)])
    expect(info.get(1)).toMatchObject({ directDone: 1, directTotal: 4, directInProgress: 1, openChildCount: 3, isDerived: true })
  })
})

describe('getParentProgressLabel', () => {
  it('appends the in-progress count only when above zero', () => {
    expect(getParentProgressLabel({ directDone: 1, directTotal: 4, directInProgress: 1 })).toBe('1 of 4 done · 1 in progress')
    expect(getParentProgressLabel({ directDone: 2, directTotal: 3, directInProgress: 0 })).toBe('2 of 3 done')
  })
})

describe('getDerivedStatusTitle', () => {
  it('pluralises by open subtask count', () => {
    expect(getDerivedStatusTitle(1)).toBe('Status follows its 1 open subtask. Complete or remove them to change it.')
    expect(getDerivedStatusTitle(3)).toBe('Status follows its 3 open subtasks. Complete or remove them to change it.')
  })
})
