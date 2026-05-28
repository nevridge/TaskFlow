import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGlobalKeyboardShortcuts } from './useGlobalKeyboardShortcuts'
import type { GlobalShortcutHandlers } from './useGlobalKeyboardShortcuts'

function makeHandlers(): GlobalShortcutHandlers {
  return {
    onGoHome: vi.fn(),
    onGoTasks: vi.fn(),
    onShowHelp: vi.fn(),
  }
}

function fireKey(key: string, options: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }))
}

describe('useGlobalKeyboardShortcuts', () => {
  let handlers: GlobalShortcutHandlers

  beforeEach(() => {
    handlers = makeHandlers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('fires onShowHelp when ? is pressed with no input focused', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('?')
    expect(handlers.onShowHelp).toHaveBeenCalledOnce()
  })

  it('does not fire onShowHelp when an input is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('?')
    expect(handlers.onShowHelp).not.toHaveBeenCalled()
  })

  it('does not fire onShowHelp when a textarea is focused', () => {
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()

    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('?')
    expect(handlers.onShowHelp).not.toHaveBeenCalled()
  })

  it('does not fire shortcuts when modifier keys are held (Ctrl, Alt, Meta)', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('?', { ctrlKey: true })
    fireKey('?', { altKey: true })
    fireKey('?', { metaKey: true })
    expect(handlers.onShowHelp).not.toHaveBeenCalled()
  })

  it('g then h within 1.5s triggers onGoHome', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    vi.advanceTimersByTime(500)
    fireKey('h')
    expect(handlers.onGoHome).toHaveBeenCalledOnce()
    expect(handlers.onGoTasks).not.toHaveBeenCalled()
  })

  it('g then t within 1.5s triggers onGoTasks', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    vi.advanceTimersByTime(500)
    fireKey('t')
    expect(handlers.onGoTasks).toHaveBeenCalledOnce()
    expect(handlers.onGoHome).not.toHaveBeenCalled()
  })

  it('g then h does not also trigger onGoTasks', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    fireKey('h')
    expect(handlers.onGoTasks).not.toHaveBeenCalled()
  })

  it('g then t does not also trigger onGoHome', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    fireKey('t')
    expect(handlers.onGoHome).not.toHaveBeenCalled()
  })

  it('chord times out after 1.5s and subsequent h does not trigger onGoHome', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    vi.advanceTimersByTime(1500)
    fireKey('h')
    expect(handlers.onGoHome).not.toHaveBeenCalled()
  })

  it('g then unknown key silently cancels the chord', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    fireKey('x')
    expect(handlers.onGoHome).not.toHaveBeenCalled()
    expect(handlers.onGoTasks).not.toHaveBeenCalled()
  })

  it('subsequent single-key shortcuts work after a cancelled chord', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    fireKey('x') // cancels chord
    fireKey('?')
    expect(handlers.onShowHelp).toHaveBeenCalledOnce()
  })

  it('chord fires even while an input is focused (second key)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('g')
    input.focus()
    fireKey('h')
    expect(handlers.onGoHome).toHaveBeenCalledOnce()
  })

  it('removes the keydown listener on unmount', () => {
    const { unmount } = renderHook(() => useGlobalKeyboardShortcuts(handlers))
    unmount()
    fireKey('?')
    expect(handlers.onShowHelp).not.toHaveBeenCalled()
  })

  it('does not fire any shortcut when disabled is true', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers, { disabled: true }))
    fireKey('?')
    fireKey('g')
    fireKey('h')
    expect(handlers.onShowHelp).not.toHaveBeenCalled()
    expect(handlers.onGoHome).not.toHaveBeenCalled()
    expect(handlers.onGoTasks).not.toHaveBeenCalled()
  })

  it('fires shortcuts normally when disabled is false', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers, { disabled: false }))
    fireKey('?')
    expect(handlers.onShowHelp).toHaveBeenCalledOnce()
  })

  it('fires shortcuts normally when disabled option is omitted', () => {
    renderHook(() => useGlobalKeyboardShortcuts(handlers))
    fireKey('?')
    expect(handlers.onShowHelp).toHaveBeenCalledOnce()
  })

  it('respects disabled toggling without remounting', () => {
    let disabled = false
    const { rerender } = renderHook(() =>
      useGlobalKeyboardShortcuts(handlers, { disabled }),
    )

    // Enabled — shortcut fires
    fireKey('?')
    expect(handlers.onShowHelp).toHaveBeenCalledOnce()

    // Disable and rerender
    disabled = true
    rerender()
    fireKey('?')
    expect(handlers.onShowHelp).toHaveBeenCalledOnce() // still only one call
  })
})
