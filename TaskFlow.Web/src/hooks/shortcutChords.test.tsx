import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { CHORD_WINDOW_MS } from '@/lib/keyboard-utils'
import { useGlobalKeyboardShortcuts } from './useGlobalKeyboardShortcuts'
import type { GlobalShortcutHandlers } from './useGlobalKeyboardShortcuts'
import { useJournalKeyboardShortcuts } from './useJournalKeyboardShortcuts'
import type { JournalShortcutHandlers } from './useJournalKeyboardShortcuts'

// Both hooks listen on document. The key after `g` belongs to the chord only, whichever listener runs first.
function mountBoth() {
  const global: GlobalShortcutHandlers = { onGoHome: vi.fn(), onGoTasks: vi.fn(), onShowHelp: vi.fn() }
  const journal: JournalShortcutHandlers = {
    onNewTodo: vi.fn(), onNewLog: vi.fn(), onNewNote: vi.fn(), onPrevDay: vi.fn(), onNextDay: vi.fn(),
    onTodoNext: vi.fn(), onTodoPrev: vi.fn(), onTodoOpen: vi.fn(), onTodoToggle: vi.fn(),
  }
  return { global, journal }
}

function press(key: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe.each([
  ['journal listener first', true],
  ['global listener first', false],
])('g chord across both hooks (%s)', (_name, journalFirst) => {
  let handlers: ReturnType<typeof mountBoth>

  beforeEach(() => {
    vi.useFakeTimers()
    handlers = mountBoth()
    const mountJournal = () => renderHook(() => useJournalKeyboardShortcuts(handlers.journal))
    const mountGlobal = () => renderHook(() => useGlobalKeyboardShortcuts(handlers.global))
    if (journalFirst) { mountJournal(); mountGlobal() } else { mountGlobal(); mountJournal() }
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  const journalCalls = () => Object.values(handlers.journal).reduce((n, h) => n + vi.mocked(h).mock.calls.length, 0)

  it('g then t goes to Tasks and does not focus the journal draft', () => {
    press('g')
    press('t')
    expect(handlers.global.onGoTasks).toHaveBeenCalledOnce()
    expect(handlers.journal.onNewTodo).not.toHaveBeenCalled()
  })

  it('g then h goes to today with no journal action', () => {
    press('g')
    press('h')
    expect(handlers.global.onGoHome).toHaveBeenCalledOnce()
    expect(journalCalls()).toBe(0)
  })

  it.each(['j', 'k', 'e', 'c', 'l', 'n', '[', ']'])('g then %s runs no journal action', key => {
    press('g')
    press(key)
    expect(journalCalls()).toBe(0)
  })

  it('after a chord is consumed, t and j work normally', () => {
    press('g')
    press('t')
    press('t')
    press('j')
    expect(handlers.journal.onNewTodo).toHaveBeenCalledOnce()
    expect(handlers.journal.onTodoNext).toHaveBeenCalledOnce()
  })

  it('after the chord window, t and j work and g t does not fire', () => {
    press('g')
    vi.advanceTimersByTime(CHORD_WINDOW_MS + 1)
    press('t')
    press('j')
    expect(handlers.global.onGoTasks).not.toHaveBeenCalled()
    expect(handlers.journal.onNewTodo).toHaveBeenCalledOnce()
    expect(handlers.journal.onTodoNext).toHaveBeenCalledOnce()
  })

  it('a lone g followed by an unrelated key then t works as a plain t', () => {
    press('g')
    press('x')
    press('t')
    expect(handlers.global.onGoTasks).not.toHaveBeenCalled()
    expect(handlers.journal.onNewTodo).toHaveBeenCalledOnce()
  })

  it('g in an input or with a modifier does not arm the chord for the journal keys', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    press('g')
    input.blur()
    press('t')
    press('g', { ctrlKey: true })
    press('t')
    expect(handlers.journal.onNewTodo).toHaveBeenCalledTimes(2)
    expect(handlers.global.onGoTasks).not.toHaveBeenCalled()
  })
})
