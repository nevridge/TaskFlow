import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, act, screen } from '@testing-library/react'
import { ToastProvider } from '@/context/ToastContext'
import { CHORD_WINDOW_MS } from '@/lib/keyboard-utils'
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
    onTodoNext: vi.fn(),
    onTodoPrev: vi.fn(),
    onTodoOpen: vi.fn(),
    onTodoToggle: vi.fn(),
  }
}

function fireKey(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  ;(document.activeElement ?? document.body).dispatchEvent(event)
  return event
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

  it('maps j, k, e and c to the todo handlers', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('j')
    fireKey('k')
    fireKey('e')
    fireKey('c')
    expect(handlers.onTodoNext).toHaveBeenCalledOnce()
    expect(handlers.onTodoPrev).toHaveBeenCalledOnce()
    expect(handlers.onTodoOpen).toHaveBeenCalledOnce()
    expect(handlers.onTodoToggle).toHaveBeenCalledOnce()
  })

  it('allows j and k to repeat but ignores a held e or c', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    fireKey('j', { repeat: true })
    fireKey('k', { repeat: true })
    fireKey('e', { repeat: true })
    fireKey('c', { repeat: true })
    expect(handlers.onTodoNext).toHaveBeenCalledOnce()
    expect(handlers.onTodoPrev).toHaveBeenCalledOnce()
    expect(handlers.onTodoOpen).not.toHaveBeenCalled()
    expect(handlers.onTodoToggle).not.toHaveBeenCalled()
  })

  it('only prevents the default when the handler acted', () => {
    vi.mocked(handlers.onTodoNext).mockReturnValue(false)
    vi.mocked(handlers.onTodoOpen).mockReturnValue(true)
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    expect(fireKey('j').defaultPrevented).toBe(false)
    expect(fireKey('e').defaultPrevented).toBe(true)
    expect(fireKey('t').defaultPrevented).toBe(true)
  })

  it('never binds Space or Enter', () => {
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    expect(fireKey(' ').defaultPrevented).toBe(false)
    expect(fireKey('Enter').defaultPrevented).toBe(false)
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
    fireKey('k')
    fireKey('e')
    fireKey('c')

    expect(handlers.onNewTodo).not.toHaveBeenCalled()
    expect(handlers.onNewLog).not.toHaveBeenCalled()
    expect(handlers.onNewNote).not.toHaveBeenCalled()
    expect(handlers.onPrevDay).not.toHaveBeenCalled()
    expect(handlers.onNextDay).not.toHaveBeenCalled()
    expect(handlers.onTodoNext).not.toHaveBeenCalled()
    expect(handlers.onTodoPrev).not.toHaveBeenCalled()
    expect(handlers.onTodoOpen).not.toHaveBeenCalled()
    expect(handlers.onTodoToggle).not.toHaveBeenCalled()
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
    fireKey('c', { ctrlKey: true })
    expect(handlers.onNewTodo).not.toHaveBeenCalled()
    expect(handlers.onTodoNext).not.toHaveBeenCalled()
    expect(handlers.onTodoToggle).not.toHaveBeenCalled()
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

  it.each(['t', 'l', 'n', '[', ']', 'j', 'k', 'e', 'c'])('is silent for %s inside a dialog or with a modal open', key => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inside = document.createElement('button')
    dialog.appendChild(inside)
    document.body.appendChild(dialog)
    inside.focus()
    renderHook(() => useJournalKeyboardShortcuts(handlers))

    expect(fireKey(key).defaultPrevented).toBe(false)
    dialog.setAttribute('aria-modal', 'true')
    document.body.focus()
    expect(fireKey(key).defaultPrevented).toBe(false)
    dialog.remove()
    const drawer = document.createElement('div')
    drawer.className = 'settings-drawer is-open'
    document.body.appendChild(drawer)
    expect(fireKey(key).defaultPrevented).toBe(false)
    drawer.remove()
    // Works again once closed.
    expect(fireKey(key).defaultPrevented).toBe(true)
  })

  it('is silent when contentEditable or a select has focus', () => {
    const editable = document.createElement('div')
    editable.tabIndex = 0
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    const select = document.createElement('select')
    document.body.append(editable, select)
    renderHook(() => useJournalKeyboardShortcuts(handlers))
    editable.focus()
    fireKey('j')
    select.focus()
    fireKey('c')
    expect(handlers.onTodoNext).not.toHaveBeenCalled()
    expect(handlers.onTodoToggle).not.toHaveBeenCalled()
  })

  describe('g chord', () => {
    beforeEach(() => {
      renderHook(() => useJournalKeyboardShortcuts(handlers))
    })

    it.each(['t', 'l', 'n', '[', ']', 'j', 'k', 'e', 'c'])('the key %s right after g does nothing', key => {
      fireKey('g')
      fireKey(key)
      for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
    })

    it('a later key works once the chord is consumed', () => {
      fireKey('g')
      fireKey('t')
      fireKey('t')
      expect(handlers.onNewTodo).toHaveBeenCalledOnce()
    })

    it('works again after the chord window passes', () => {
      fireKey('g')
      vi.advanceTimersByTime(CHORD_WINDOW_MS + 1)
      fireKey('j')
      expect(handlers.onTodoNext).toHaveBeenCalledOnce()
    })

    it('still belongs to the chord at the end of the window', () => {
      fireKey('g')
      vi.advanceTimersByTime(CHORD_WINDOW_MS)
      fireKey('j')
      expect(handlers.onTodoNext).not.toHaveBeenCalled()
    })

    it('an unrelated key after g cancels it, so the next key acts', () => {
      fireKey('g')
      fireKey('x')
      fireKey('t')
      expect(handlers.onNewTodo).toHaveBeenCalledOnce()
    })

    it('g typed in an input does not arm the chord', () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      fireKey('g')
      input.blur()
      fireKey('t')
      expect(handlers.onNewTodo).toHaveBeenCalledOnce()
    })

    it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])('g with %o does not arm the chord', mods => {
      fireKey('g', mods)
      fireKey('t')
      expect(handlers.onNewTodo).toHaveBeenCalledOnce()
    })
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
      expect(handlers.onTodoNext).toHaveBeenCalledOnce()
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
      expect(handlers.onTodoNext).not.toHaveBeenCalled()
      expect(handlers.onPrevDay).not.toHaveBeenCalled()
      expect(handlers.onNextDay).not.toHaveBeenCalled()
      // Shortcuts keep working afterwards.
      fireKey('t')
      expect(handlers.onNewTodo).toHaveBeenCalledOnce()
    })
  })
})
