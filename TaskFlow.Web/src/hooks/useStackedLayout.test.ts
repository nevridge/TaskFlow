import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStackedLayout, STACKED_QUERY } from './useStackedLayout'

function mockMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  const matchMedia = vi.fn((query: string) => ({
    media: query,
    get matches() { return query === STACKED_QUERY && matches },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }))
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true })
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      matches = next
      act(() => listeners.forEach(l => l()))
    },
  }
}

describe('useStackedLayout', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('is false when matchMedia is unavailable', () => {
    Reflect.deleteProperty(window, 'matchMedia')
    const { result } = renderHook(() => useStackedLayout())
    expect(result.current).toBe(false)
  })

  it('asks for exactly the shared STACKED_QUERY and follows change events', () => {
    const media = mockMedia(false)
    const { result, unmount } = renderHook(() => useStackedLayout())
    expect(media.matchMedia).toHaveBeenCalledWith(STACKED_QUERY)
    expect(result.current).toBe(false)
    media.set(true)
    expect(result.current).toBe(true)
    media.set(false)
    expect(result.current).toBe(false)
    unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('tolerates a matchMedia stub without addEventListener', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: true }),
      configurable: true,
      writable: true,
    })
    const { result } = renderHook(() => useStackedLayout())
    expect(result.current).toBe(true)
  })
})
