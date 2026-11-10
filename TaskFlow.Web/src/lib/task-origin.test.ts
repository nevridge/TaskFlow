import { describe, it, expect } from 'vitest'
import {
  journalOriginPath,
  readJournalOrigin,
  readFocusTaskId,
  stateWithoutFocusTaskId,
  isEditRequested,
  withEditParam,
  withoutEditParam,
  taskEditPath,
  readTasksOrigin,
  readBackOrigin,
  tasksOriginPath,
} from './task-origin'

describe('task-origin', () => {
  it('builds the journal path from the ISO date, not the clock', () => {
    expect(journalOriginPath('2026-11-07')).toBe('/journal/11-07-2026')
  })

  it('accepts a journal path', () => {
    expect(readJournalOrigin({ from: '/journal/11-07-2026' })).toBe('/journal/11-07-2026')
  })

  it.each([
    '/tasks', 'https://evil.example', '//evil', '/journal//x', '/journal/\\x', '/journal/a:b', '', 42, null, undefined,
  ])('rejects from=%s', from => {
    expect(readJournalOrigin({ from })).toBeNull()
  })

  it.each([null, undefined, 'x', 5])('rejects non-object state %s', state => {
    expect(readJournalOrigin(state)).toBeNull()
    expect(readFocusTaskId(state)).toBeNull()
    expect(stateWithoutFocusTaskId(state)).toBeNull()
  })

  it('reads only a positive integer focus id', () => {
    expect(readFocusTaskId({ focusTaskId: 12 })).toBe(12)
    for (const v of [0, -1, 1.5, '12', null, undefined]) expect(readFocusTaskId({ focusTaskId: v })).toBeNull()
  })

  it('drops only the focus key and returns null when nothing is left', () => {
    expect(stateWithoutFocusTaskId({ focusTaskId: 1, weekendRedirect: true })).toEqual({ weekendRedirect: true })
    expect(stateWithoutFocusTaskId({ focusTaskId: 1 })).toBeNull()
  })
})

describe('edit param helpers', () => {
  it.each([
    ['?edit=1', true],
    ['?x=2&edit=1', true],
    ['', false],
    ['?edit=0', false],
    ['?edit=true', false],
    ['?edit=', false],
    ['?edit', false],
    ['?edit=1&edit=2', false],
    ['?edit=1&edit=1', false],
    ['?Edit=1', false],
  ])('isEditRequested(%s) is %s', (search, expected) => {
    expect(isEditRequested(new URLSearchParams(search))).toBe(expected)
  })

  it('withEditParam sets edit=1, keeps other params and does not mutate the input', () => {
    const input = new URLSearchParams('x=2&edit=0')
    expect(withEditParam(input).toString()).toBe('x=2&edit=1')
    expect(input.toString()).toBe('x=2&edit=0')
  })

  it('withoutEditParam removes every edit, keeps other params and does not mutate the input', () => {
    const input = new URLSearchParams('x=2&edit=1&edit=2')
    expect(withoutEditParam(input).toString()).toBe('x=2')
    expect(input.getAll('edit')).toEqual(['1', '2'])
  })

  it('taskEditPath builds the detail path in edit mode', () => {
    expect(taskEditPath(7)).toBe('/tasks/7?edit=1')
    expect(taskEditPath('7')).toBe('/tasks/7?edit=1')
  })

  it('readJournalOrigin ignores the edit param: the origin comes from state only', () => {
    expect(readJournalOrigin({ from: '/journal/11-07-2026' })).toBe('/journal/11-07-2026')
    expect(readJournalOrigin(null)).toBeNull()
  })

  describe('Tasks origin (#469)', () => {
    it.each(['/tasks', '/tasks?q=a%23b', '/tasks?status=todo&status=draft', '/tasks?project=none'])(
      'accepts from=%s',
      from => expect(readTasksOrigin({ from })).toBe(from),
    )

    it.each([
      '/tasksX', '/tasks/5', '/tasks#x', '/tasks?q=a#b', '//evil', '/tasks?x=//y', String.raw`/tasks\x`, '/tasks?u=http:x',
      '/journal/11-07-2026', 'https://evil.example', '', 42, null, undefined,
    ])('rejects from=%s', from => {
      expect(readTasksOrigin({ from })).toBeNull()
    })

    it('builds the origin path from the query string', () => {
      expect(tasksOriginPath('')).toBe('/tasks')
      expect(tasksOriginPath('?q=foo')).toBe('/tasks?q=foo')
    })

    it('readBackOrigin takes a Tasks origin, else a journal origin, else null; the journal rule is unchanged', () => {
      expect(readBackOrigin({ from: '/tasks?q=a' })).toBe('/tasks?q=a')
      expect(readBackOrigin({ from: '/journal/11-07-2026' })).toBe('/journal/11-07-2026')
      expect(readBackOrigin({ from: '/tasksX' })).toBeNull()
      expect(readJournalOrigin({ from: '/tasks?q=a' })).toBeNull()
    })
  })
})
