import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { COLLAPSED_GROUPS_KEY, useCollapsedGroups } from './useCollapsedGroups'
import { SECTION_DEFS, SECTION_ORDER } from '@/lib/task-sections'

const OLD_KEY = 'taskflow_tasks_collapsed_groups_v1'

describe('useCollapsedGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('uses a new storage key', () => {
    expect(COLLAPSED_GROUPS_KEY).toBe('taskflow_tasks_section_collapse_v2')
  })

  it('takes defaults from SECTION_DEFS and does not write on mount', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useCollapsedGroups())
    for (const key of SECTION_ORDER) {
      expect(result.current.isCollapsed(key)).toBe(SECTION_DEFS[key].defaultCollapsed)
    }
    expect(result.current.isCollapsed('blocked')).toBe(true)
    expect(result.current.isCollapsed('completed')).toBe(true)
    expect(result.current.isCollapsed('high')).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('toggles from the default and persists the overrides shape', () => {
    const { result } = renderHook(() => useCollapsedGroups())
    act(() => result.current.toggle('medium'))
    expect(result.current.isCollapsed('medium')).toBe(true)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? 'null')).toEqual({ medium: true })
    act(() => result.current.toggle('completed'))
    expect(result.current.isCollapsed('completed')).toBe(false)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? 'null')).toEqual({ medium: true, completed: false })
  })

  it('persists the choice across a remount', () => {
    const first = renderHook(() => useCollapsedGroups())
    act(() => first.result.current.toggle('completed'))
    first.unmount()
    const second = renderHook(() => useCollapsedGroups())
    expect(second.result.current.isCollapsed('completed')).toBe(false)
  })

  it('ignores the old storage key', () => {
    localStorage.setItem(OLD_KEY, JSON.stringify(['high', 'draft']))
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.isCollapsed('high')).toBe(false)
    expect(result.current.isCollapsed('draft')).toBe(false)
    act(() => result.current.toggle('low'))
    expect(localStorage.getItem(OLD_KEY)).toBe(JSON.stringify(['high', 'draft']))
  })

  it.each([
    ['non-JSON text', 'not json {'],
    ['a JSON array', '["high"]'],
    ['a JSON string', '"high"'],
    ['null', 'null'],
  ])('falls back to defaults for %s without throwing', (_label, raw) => {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, raw)
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.isCollapsed('high')).toBe(false)
    expect(result.current.isCollapsed('completed')).toBe(true)
  })

  it('ignores non-boolean and unknown entries', () => {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify({ low: 'yes', high: true, bogus: true, blocked: false }))
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.isCollapsed('low')).toBe(false)
    expect(result.current.isCollapsed('high')).toBe(true)
    expect(result.current.isCollapsed('blocked')).toBe(false)
  })

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.isCollapsed('high')).toBe(false)
    act(() => result.current.toggle('high'))
    expect(result.current.isCollapsed('high')).toBe(true)
  })
})
