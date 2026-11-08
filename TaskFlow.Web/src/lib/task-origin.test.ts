import { describe, it, expect } from 'vitest'
import { journalOriginPath, readJournalOrigin, readFocusTaskId, stateWithoutFocusTaskId } from './task-origin'

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
