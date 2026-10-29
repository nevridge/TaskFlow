import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, act, screen } from '@testing-library/react'
import { ToastProvider } from '@/context/ToastContext'
import { useToast } from '@/context/useToast'
import { useJournalKeyboardShortcuts } from './useJournalKeyboardShortcuts'
import type { JournalShortcutHandlers } from './useJournalKeyboardShortcuts'

function makeHandlers(): JournalShortcutHandlers {
  return {
    onNewTodo: vi.fn(),
    onNewLog: vi.fn(),
    onNewNote: vi.fn(),
    onPrevDay: vi.fn(),
    onNextDay: vi.fn(),
    onJumpToToday: vi.fn(),
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

  it('fires onJumpToToday when j is pressed with no input focused', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('j')
    expect(handlers.onJumpToToday).toHaveBeenCalledOnce()
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
    fireKey('j')

    expect(handlers.onNewTodo).not.toHaveBeenCalled()
    expect(handlers.onNewLog).not.toHaveBeenCalled()
    expect(handlers.onNewNote).not.toHaveBeenCalled()
    expect(handlers.onPrevDay).not.toHaveBeenCalled()
    expect(handlers.onNextDay).not.toHaveBeenCalled()
    expect(handlers.onJumpToToday).not.toHaveBeenCalled()
  })

  it('still fires l and n when a role=button edit trigger or a Save button is focused', () => {
    const trigger = document.createElement('div')
    trigger.setAttribute('role', 'button')
    trigger.tabIndex = 0
    const save = document.createElement('button')
    document.body.append(trigger, save)
    renderHook(() => useJournalKeyboardShortcuts(handlers))

    trigger.focus()
    fireKey('l')
    save.focus()
    fireKey('n')

    expect(handlers.onNewLog).toHaveBeenCalledOnce()
    expect(handlers.onNewNote).toHaveBeenCalledOnce()
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
    fireKey('j', { ctrlKey: true })
    fireKey('j', { altKey: true })
    fireKey('j', { metaKey: true })
    expect(handlers.onNewTodo).not.toHaveBeenCalled()
    expect(handlers.onJumpToToday).not.toHaveBeenCalled()
  })

  it('does not start a chord when g is pressed', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('g')
    fireKey('h')
    expect(handlers.onNewTodo).not.toHaveBeenCalled()
    expect(handlers.onNewLog).not.toHaveBeenCalled()
    expect(handlers.onNewNote).not.toHaveBeenCalled()
    expect(handlers.onPrevDay).not.toHaveBeenCalled()
    expect(handlers.onNextDay).not.toHaveBeenCalled()
  })

  it('removes the keydown listener on unmount', () => {
    const { unmount } = renderHook(() => useJournalKeyboardShortcuts(handlers))
    unmount()
    fireKey('t')
    expect(handlers.onNewTodo).not.toHaveBeenCalled()
  })

  describe('with an undo toast pending', () => {
    function setup() {
      const view = renderHook(
        () => {
          useJournalKeyboardShortcuts(handlers)
          return useToast()
        },
        { wrapper: ({ children }) => createElement(ToastProvider, null, children) },
      )
      act(() =>
        view.result.current.schedule({
          id: 'a',
          keys: ['a'],
          message: 'Deleted a',
          errorMessage: 'failed',
          commit: () => Promise.resolve({}),
        }),
      )
      return view
    }

    it('still fires t, l, n, j, [ and ]', () => {
      setup()
      expect(screen.getByRole('status')).toBeInTheDocument()
      fireKey('t')
      fireKey('l')
      fireKey('n')
      fireKey('j')
      fireKey('[')
      fireKey(']')
      expect(handlers.onNewTodo).toHaveBeenCalledOnce()
      expect(handlers.onNewLog).toHaveBeenCalledOnce()
      expect(handlers.onNewNote).toHaveBeenCalledOnce()
      expect(handlers.onJumpToToday).toHaveBeenCalledOnce()
      expect(handlers.onPrevDay).toHaveBeenCalledOnce()
      expect(handlers.onNextDay).toHaveBeenCalledOnce()
    })

    it('u undoes the toast without triggering any journal shortcut', () => {
      setup()
      act(() => fireKey('u'))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(handlers.onNewTodo).not.toHaveBeenCalled()
      expect(handlers.onNewLog).not.toHaveBeenCalled()
      expect(handlers.onNewNote).not.toHaveBeenCalled()
      expect(handlers.onJumpToToday).not.toHaveBeenCalled()
      expect(handlers.onPrevDay).not.toHaveBeenCalled()
      expect(handlers.onNextDay).not.toHaveBeenCalled()
      // Shortcuts keep working afterwards.
      fireKey('t')
      expect(handlers.onNewTodo).toHaveBeenCalledOnce()
    })
  })
})
