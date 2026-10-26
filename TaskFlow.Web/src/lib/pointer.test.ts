import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isCoarsePointer, __resetCoarsePointerCache } from './pointer'

function mockMatchMedia(matches: boolean) {
  const fn = vi.fn().mockReturnValue({ matches })
  Object.defineProperty(window, 'matchMedia', { value: fn, configurable: true, writable: true })
  return fn
}

describe('isCoarsePointer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('is false and does not throw when matchMedia is missing', () => {
    Reflect.deleteProperty(window, 'matchMedia')
    expect(typeof window.matchMedia).not.toBe('function')
    expect(isCoarsePointer()).toBe(false)
  })

  it('is true when the touch query matches', () => {
    const mm = mockMatchMedia(true)
    expect(isCoarsePointer()).toBe(true)
    expect(mm).toHaveBeenCalledWith('(hover: none), (pointer: coarse)')
  })

  it('evaluates once and ignores later changes', () => {
    const mm = mockMatchMedia(false)
    expect(isCoarsePointer()).toBe(false)
    expect(isCoarsePointer()).toBe(false)
    mockMatchMedia(true)
    expect(isCoarsePointer()).toBe(false)
    expect(mm).toHaveBeenCalledTimes(1)
  })

  it('re-evaluates after the test reset', () => {
    mockMatchMedia(false)
    expect(isCoarsePointer()).toBe(false)
    mockMatchMedia(true)
    __resetCoarsePointerCache()
    expect(isCoarsePointer()).toBe(true)
  })
})
