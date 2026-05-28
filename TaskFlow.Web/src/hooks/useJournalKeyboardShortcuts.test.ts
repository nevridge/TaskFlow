import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useJournalKeyboardShortcuts } from './useJournalKeyboardShortcuts'
import type { JournalShortcutHandlers } from './useJournalKeyboardShortcuts'

function makeHandlers(): JournalShortcutHandlers {
  return {
    onNewTodo: vi.fn(),
    onNewLog: vi.fn(),
    onNewNote: vi.fn(),
    onPrevDay: vi.fn(),
    onNextDay: vi.fn(),
    onGoHome: vi.fn(),
    onGoTasks: vi.fn(),
    onShowHelp: vi.fn(),
  }
}

function fireKey(key: string, options: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }))
}

describe('useJournalKeyboardShortcuts', () => {
  let handlers: JournalShortcutHandlers

  beforeEach(() => {
    handlers = makeHandlers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('fires onNewTodo when t is pressed with no input focused', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('t')
    expect(handlers.onNewTodo).toHaveBeenCalledOnce()
  })

  it('fires onNewLog when l is pressed', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('l')
    expect(handlers.onNewLog).toHaveBeenCalledOnce()
  })

  it('fires onNewNote when n is pressed', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('n')
    expect(handlers.onNewNote).toHaveBeenCalledOnce()
  })

  it('fires onPrevDay when [ is pressed', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('[')
    expect(handlers.onPrevDay).toHaveBeenCalledOnce()
  })

  it('fires onNextDay when ] is pressed', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey(']')
    expect(handlers.onNextDay).toHaveBeenCalledOnce()
  })

  it('fires onShowHelp when ? is pressed', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('?')
    expect(handlers.onShowHelp).toHaveBeenCalledOnce()
  })

  it('does not fire shortcuts when an input is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('t')
    fireKey('l')
    fireKey('n')
    fireKey('[')
    fireKey(']')
    fireKey('?')

    expect(handlers.onNewTodo).not.toHaveBeenCalled()
    expect(handlers.onNewLog).not.toHaveBeenCalled()
    expect(handlers.onNewNote).not.toHaveBeenCalled()
    expect(handlers.onPrevDay).not.toHaveBeenCalled()
    expect(handlers.onNextDay).not.toHaveBeenCalled()
    expect(handlers.onShowHelp).not.toHaveBeenCalled()
  })

  it('does not fire shortcuts when a textarea is focused', () => {
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()

    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('t')
    expect(handlers.onNewTodo).not.toHaveBeenCalled()
  })

  it('does not fire shortcuts when modifier keys are held', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('t', { ctrlKey: true })
    fireKey('t', { altKey: true })
    fireKey('t', { metaKey: true })
    expect(handlers.onNewTodo).not.toHaveBeenCalled()
  })

  it('g then h within 1.5s triggers onGoHome', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('g')
    vi.advanceTimersByTime(500)
    fireKey('h')
    expect(handlers.onGoHome).toHaveBeenCalledOnce()
    expect(handlers.onGoTasks).not.toHaveBeenCalled()
  })

  it('g then t within 1.5s triggers onGoTasks', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('g')
    vi.advanceTimersByTime(500)
    fireKey('t')
    expect(handlers.onGoTasks).toHaveBeenCalledOnce()
    expect(handlers.onGoHome).not.toHaveBeenCalled()
  })

  it('chord times out after 1.5s and subsequent h does not trigger onGoHome', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('g')
    vi.advanceTimersByTime(1500)
    fireKey('h')
    expect(handlers.onGoHome).not.toHaveBeenCalled()
  })

  it('g then unknown key silently cancels the chord', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('g')
    fireKey('x')
    expect(handlers.onGoHome).not.toHaveBeenCalled()
    expect(handlers.onGoTasks).not.toHaveBeenCalled()
    // Subsequent shortcuts should still work
    fireKey('t')
    expect(handlers.onNewTodo).toHaveBeenCalledOnce()
  })

  it('chord fires even while an input is focused (second key)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('g')
    input.focus()
    fireKey('h')
    expect(handlers.onGoHome).toHaveBeenCalledOnce()
  })

  it('removes the keydown listener on unmount', () => {
    const { unmount } = renderHook(() => useJournalKeyboardShortcuts(handlers))
    unmount()
    fireKey('t')
    expect(handlers.onNewTodo).not.toHaveBeenCalled()
  })
})
