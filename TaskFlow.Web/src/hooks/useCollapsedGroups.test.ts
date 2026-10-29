import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { COLLAPSED_GROUPS_KEY, useCollapsedGroups } from './useCollapsedGroups'

describe('useCollapsedGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('starts empty and does not write on mount', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.collapsed.size).toBe(0)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('restores the persisted keys on mount', () => {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(['high', 'draft']))
    const { result } = renderHook(() => useCollapsedGroups())
    expect(Array.from(result.current.collapsed).sort()).toEqual(['draft', 'high'])
  })

  it('toggles a key on and off and persists only from the toggle', () => {
    const { result } = renderHook(() => useCollapsedGroups())
    act(() => result.current.toggle('medium'))
    expect(result.current.collapsed.has('medium')).toBe(true)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '[]')).toEqual(['medium'])
    act(() => result.current.toggle('medium'))
    expect(result.current.collapsed.has('medium')).toBe(false)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? 'null')).toEqual([])
  })

  it.each([
    ['non-JSON text', 'not json {'],
    ['a JSON object', '{"high":true}'],
    ['a JSON string', '"high"'],
  ])('falls back to empty for %s without throwing', (_label, raw) => {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, raw)
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.collapsed.size).toBe(0)
  })

  it('ignores non-string entries', () => {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(['low', 3, null]))
    const { result } = renderHook(() => useCollapsedGroups())
    expect(Array.from(result.current.collapsed)).toEqual(['low'])
  })

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.collapsed.size).toBe(0)
    act(() => result.current.toggle('high'))
    expect(result.current.collapsed.has('high')).toBe(true)
  })
})
