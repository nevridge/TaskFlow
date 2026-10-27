import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MouseEvent } from 'react'
import { useTapToEdit } from './useTapToEdit'
import { __resetCoarsePointerCache } from '@/lib/pointer'

function setTouch(touch: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: touch }),
    configurable: true,
    writable: true,
  })
  __resetCoarsePointerCache()
}

const click = (detail: number) => ({ detail }) as MouseEvent<HTMLElement>

describe('useTapToEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
  })

  it('exposes the edit-trigger class', () => {
    const { result } = renderHook(() => useTapToEdit(vi.fn()))
    expect(result.current.className).toBe('edit-trigger')
  })

  it('touch: a single click edits', () => {
    setTouch(true)
    const onEdit = vi.fn()
    const { result } = renderHook(() => useTapToEdit(onEdit))
    result.current.onClick(click(1))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('desktop: a single click (detail 1) does nothing, a double-click edits', () => {
    setTouch(false)
    const onEdit = vi.fn()
    const { result } = renderHook(() => useTapToEdit(onEdit))
    result.current.onClick(click(1))
    expect(onEdit).not.toHaveBeenCalled()
    result.current.onDoubleClick()
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('desktop: a keyboard-originated click (detail 0) edits', () => {
    setTouch(false)
    const onEdit = vi.fn()
    const { result } = renderHook(() => useTapToEdit(onEdit))
    result.current.onClick(click(0))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('singleClickAlways edits on a desktop single click', () => {
    setTouch(false)
    const onEdit = vi.fn()
    const { result } = renderHook(() => useTapToEdit(onEdit, { singleClickAlways: true }))
    result.current.onClick(click(1))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('behaves as desktop when matchMedia is absent', () => {
    const onEdit = vi.fn()
    const { result } = renderHook(() => useTapToEdit(onEdit))
    expect(() => result.current.onClick(click(1))).not.toThrow()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('reads the pointer type at event time, without remounting', () => {
    setTouch(false)
    const onEdit = vi.fn()
    const { result } = renderHook(() => useTapToEdit(onEdit))
    result.current.onClick(click(1))
    expect(onEdit).not.toHaveBeenCalled()
    setTouch(true)
    result.current.onClick(click(1))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('keeps handler identity stable and calls the latest onEdit', () => {
    setTouch(true)
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ cb }) => useTapToEdit(cb), { initialProps: { cb: first } })
    const handlers = result.current
    rerender({ cb: second })
    expect(result.current.onClick).toBe(handlers.onClick)
    expect(result.current.onDoubleClick).toBe(handlers.onDoubleClick)
    result.current.onClick(click(1))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})
