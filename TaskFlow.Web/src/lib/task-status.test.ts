import { describe, it, expect } from 'vitest'
import {
  STATUS_LABELS,
  STATUS_ORDER,
  canBlock,
  formatSubtaskProgress,
  getBlockErrorMessage,
  getStatusLabel,
  isBlocked,
  isCompleted,
  journalSortTier,
  mapCachedTask,
  nextCycleStatus,
  normalizeStatus,
  statusRank,
  toRequestStatus,
  withBlocked,
  withBlockedCompleted,
  withBlockedReason,
  withUnblocked,
  type BlockableFields,
} from './task-status'

describe('normalizeStatus', () => {
  it.each([
    ['Draft', 'Draft'],
    ['todo', 'Todo'],
    ['BLOCKED', 'Blocked'],
    ['Completed', 'Completed'],
    ['InProgress', 'InProgress'],
    ['inProgress', 'InProgress'],
    ['inprogress', 'InProgress'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected)
  })

  it('treats response and request casing of In Progress as the same status', () => {
    expect(normalizeStatus('InProgress')).toBe(normalizeStatus('inProgress'))
  })

  it('returns undefined for unknown, empty and missing values', () => {
    expect(normalizeStatus('Archived')).toBeUndefined()
    expect(normalizeStatus('')).toBeUndefined()
    expect(normalizeStatus(null)).toBeUndefined()
    expect(normalizeStatus(undefined)).toBeUndefined()
  })
})

describe('ordering, labels and request values', () => {
  it('orders Draft, Todo, InProgress, Blocked, Completed', () => {
    expect(STATUS_ORDER).toEqual(['Draft', 'Todo', 'InProgress', 'Blocked', 'Completed'])
    expect(statusRank('Draft')).toBeLessThan(statusRank('Todo'))
    expect(statusRank('Todo')).toBeLessThan(statusRank('InProgress'))
    expect(statusRank('InProgress')).toBeLessThan(statusRank('Blocked'))
    expect(statusRank('Blocked')).toBeLessThan(statusRank('Completed'))
    expect(statusRank('Mystery')).toBeGreaterThan(statusRank('Completed'))
  })

  it('has a label for every status', () => {
    expect(STATUS_LABELS.Todo).toBe('To-do')
    expect(STATUS_LABELS.Blocked).toBe('Blocked')
    expect(STATUS_LABELS.InProgress).toBe('In Progress')
  })

  it('getStatusLabel accepts any casing and falls back to the raw value', () => {
    expect(getStatusLabel('InProgress')).toBe('In Progress')
    expect(getStatusLabel('inprogress')).toBe('In Progress')
    expect(getStatusLabel('todo')).toBe('To-do')
    expect(getStatusLabel('Mystery')).toBe('Mystery')
    expect(getStatusLabel(undefined)).toBe('')
  })

  it('lowercases for request bodies', () => {
    expect(toRequestStatus('Blocked')).toBe('blocked')
    expect(toRequestStatus('Completed')).toBe('completed')
  })

  it('maps InProgress to the camelCase wire value', () => {
    expect(toRequestStatus('InProgress')).toBe('inProgress')
  })
})

describe('predicates', () => {
  it('treats Blocked as not completed', () => {
    expect(isBlocked('Blocked')).toBe(true)
    expect(isCompleted('Blocked')).toBe(false)
  })

  it('only Todo and InProgress can be blocked', () => {
    expect(canBlock('Todo')).toBe(true)
    expect(canBlock('InProgress')).toBe(true)
    for (const s of ['Draft', 'Completed', 'Blocked', undefined]) expect(canBlock(s)).toBe(false)
  })

  it('cycles Draft, Todo, InProgress, Completed and skips Blocked and unknown', () => {
    expect(nextCycleStatus('Draft')).toBe('todo')
    expect(nextCycleStatus('Todo')).toBe('inProgress')
    expect(nextCycleStatus('InProgress')).toBe('completed')
    expect(nextCycleStatus('Completed')).toBe('draft')
    expect(nextCycleStatus('Blocked')).toBeUndefined()
    expect(nextCycleStatus('Mystery')).toBeUndefined()
  })
})

describe('journalSortTier', () => {
  it('uses open, blocked, completed tiers and compares PascalCase strictly', () => {
    expect(journalSortTier('Todo')).toBe(0)
    expect(journalSortTier('Blocked')).toBe(1)
    expect(journalSortTier('Completed')).toBe(2)
    expect(journalSortTier('completed')).toBe(0)
  })
})

describe('formatSubtaskProgress', () => {
  it('omits the blocked part when none are blocked', () => {
    expect(formatSubtaskProgress(2, 5, 0)).toBe('2/5 done')
  })
  it('appends the blocked count when greater than zero', () => {
    expect(formatSubtaskProgress(2, 5, 1)).toBe('2/5 done, 1 blocked')
  })
})

describe('getBlockErrorMessage', () => {
  it('maps the block 422 codes', () => {
    expect(getBlockErrorMessage('TASK_BLOCK_DRAFT_NOT_ALLOWED')).toBe('Only Todo or In Progress tasks can be blocked.')
    expect(getBlockErrorMessage('TASK_BLOCK_COMPLETED_NOT_ALLOWED')).toBe('Only Todo or In Progress tasks can be blocked.')
    expect(getBlockErrorMessage('TASK_START_NOT_ALLOWED')).toBe('Only Todo tasks can be moved to In Progress. Set it to Todo first.')
    expect(getBlockErrorMessage('TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS')).toMatch(/blocked task/)
  })
  it('returns null for other codes', () => {
    expect(getBlockErrorMessage('OTHER')).toBeNull()
    expect(getBlockErrorMessage(null)).toBeNull()
  })
})

describe('optimistic transforms', () => {
  it('withBlocked records the previous status, reason and a timestamp', () => {
    const next = withBlocked<BlockableFields>({ status: 'Todo' }, 'Waiting on Sam')
    expect(next).toMatchObject({ status: 'Blocked', previousStatus: 'Todo', blockedReason: 'Waiting on Sam' })
    expect(next.blockedAt).toMatch(/Z$/)
  })

  it('withUnblocked restores Todo and clears the blocked fields, even when previousStatus is Draft or null', () => {
    for (const previousStatus of ['Todo', 'Draft', null]) {
      const next = withUnblocked({ status: 'Blocked', previousStatus, blockedReason: 'x', blockedAt: 'then' })
      expect(next).toEqual({ status: 'Todo', previousStatus: null, blockedReason: null, blockedAt: null })
    }
  })

  it('withBlocked and withUnblocked leave startedAt alone and restore InProgress', () => {
    const started = { status: 'InProgress', startedAt: '2026-01-01T00:00:00Z' } as BlockableFields & { startedAt: string }
    const blocked = withBlocked(started, null)
    expect(blocked).toMatchObject({ status: 'Blocked', previousStatus: 'InProgress', startedAt: started.startedAt })
    const restored = withUnblocked(blocked)
    expect(restored).toMatchObject({ status: 'InProgress', startedAt: started.startedAt, previousStatus: null })
  })

  it('withBlockedCompleted completes and clears the blocked fields', () => {
    expect(withBlockedCompleted({ status: 'Blocked', previousStatus: 'Todo', blockedReason: 'x', blockedAt: 'then' }))
      .toEqual({ status: 'Completed', previousStatus: null, blockedReason: null, blockedAt: null })
  })

  it('withBlockedReason only changes the reason', () => {
    expect(withBlockedReason({ status: 'Blocked', blockedReason: 'a' }, 'b')).toEqual({ status: 'Blocked', blockedReason: 'b' })
  })
})

describe('mapCachedTask', () => {
  const fn = (t: { status?: string }) => ({ ...t, status: 'Changed' })

  it('updates the matching row in a list, including nested children', () => {
    const data = { data: [{ id: 1, status: 'Todo', children: [{ id: 2, status: 'Todo' }] }, { id: 3, status: 'Todo' }] }
    const out = mapCachedTask(data, 2, fn) as typeof data
    expect(out.data[0].children?.[0].status).toBe('Changed')
    expect(out.data[0].status).toBe('Todo')
    expect(out.data[1].status).toBe('Todo')
  })

  it('updates single-task data', () => {
    expect(mapCachedTask({ data: { id: 5, status: 'Todo' } }, 5, fn)).toEqual({ data: { id: 5, status: 'Changed' } })
  })

  it('leaves unrelated data untouched', () => {
    expect(mapCachedTask(undefined, 1, fn)).toBeUndefined()
    expect(mapCachedTask({ data: [{ id: 9, status: 'Todo' }] }, 1, fn)).toEqual({ data: [{ id: 9, status: 'Todo' }] })
  })
})
