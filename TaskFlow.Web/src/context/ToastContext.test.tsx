import { StrictMode, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from './ToastContext'
import { useToast } from './useToast'
import { __resetCoarsePointerCache } from '@/lib/pointer'
import type { PendingDeleteInput } from './ToastContextDef'

function makeDelete(id: string, overrides: Partial<PendingDeleteInput> = {}): PendingDeleteInput {
  return {
    id,
    keys: [id],
    message: `Deleted ${id}`,
    errorMessage: `Couldn't delete ${id}`,
    commit: vi.fn(() => Promise.resolve({})),
    onSettled: vi.fn(),
    onRestore: vi.fn(),
    ...overrides,
  }
}

let api: ReturnType<typeof useToast>

function Probe() {
  const toast = useToast()
  useEffect(() => {
    api = toast
  })
  return <span data-testid="keys">{[...toast.pendingKeys].join(',')}</span>
}

function renderProvider(extra?: React.ReactNode, strict = false) {
  const tree = (
    <ToastProvider>
      <Probe />
      {extra}
    </ToastProvider>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

const region = () => screen.getByRole('region', { name: 'Notifications' })
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const flush = () => act(async () => { await Promise.resolve() })

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    document.body.innerHTML = ''
  })

  describe('region and toast markup', () => {
    it('renders the Notifications region before any toast exists, and it is last in the DOM', () => {
      const { container } = renderProvider(<button>Page control</button>)
      expect(region()).toBeInTheDocument()
      expect(within(region()).queryByRole('status')).not.toBeInTheDocument()
      expect(container.lastElementChild).toBe(region())
    })

    it('shows a role=status toast with the message and an Undo button', () => {
      renderProvider()
      act(() => api.schedule(makeDelete('a', { message: 'Note deleted' })))
      const toast = within(region()).getByRole('status')
      expect(toast).toHaveTextContent('Note deleted')
      expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    })

    it('Undo is a real button with the tap-target class when the device is touch', () => {
      Object.defineProperty(window, 'matchMedia', {
        value: vi.fn().mockReturnValue({ matches: true }),
        configurable: true,
        writable: true,
      })
      __resetCoarsePointerCache()
      renderProvider()
      act(() => api.schedule(makeDelete('a')))
      const undo = screen.getByRole('button', { name: 'Undo' })
      expect(undo.tagName).toBe('BUTTON')
      expect(undo).toHaveClass('tap-target')
    })

    it('never moves focus into the toast', () => {
      renderProvider(<button>Page control</button>)
      const control = screen.getByRole('button', { name: 'Page control' })
      control.focus()
      act(() => api.schedule(makeDelete('a')))
      expect(control).toHaveFocus()
    })
  })

  describe('timers', () => {
    it('commits exactly once after 6s, then runs onSettled', async () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      advance(5999)
      expect(pd.commit).not.toHaveBeenCalled()
      advance(1)
      expect(pd.commit).toHaveBeenCalledTimes(1)
      await flush()
      expect(pd.onSettled).toHaveBeenCalledTimes(1)
      advance(20000)
      expect(pd.commit).toHaveBeenCalledTimes(1)
    })

    it('hides keys while pending, and keeps them hidden until the refetch resolves', async () => {
      renderProvider()
      let resolveInvalidate: () => void = () => undefined
      const pd = makeDelete('todo:1:5', {
        onSettled: () => new Promise<void>(res => { resolveInvalidate = res }),
      })
      act(() => api.schedule(pd))
      expect(api.isPending('todo:1:5')).toBe(true)
      advance(6000)
      await flush()
      expect(api.isPending('todo:1:5')).toBe(true)
      expect(within(region()).queryByRole('status')).not.toBeInTheDocument()
      resolveInvalidate()
      await flush()
      expect(api.isPending('todo:1:5')).toBe(false)
    })

    it('Undo before 6s removes the toast and never commits', () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(api.isPending('a')).toBe(false)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      advance(20000)
      expect(pd.commit).not.toHaveBeenCalled()
    })

    it('runs two deletes on independent timers', () => {
      renderProvider()
      const first = makeDelete('a')
      const second = makeDelete('b')
      act(() => api.schedule(first))
      advance(3000)
      act(() => api.schedule(second))
      advance(3000)
      expect(first.commit).toHaveBeenCalledTimes(1)
      expect(second.commit).not.toHaveBeenCalled()
      advance(3000)
      expect(second.commit).toHaveBeenCalledTimes(1)
    })

    it('ignores a second schedule with an id that is already pending, and frees the id after undo', () => {
      renderProvider()
      const first = makeDelete('a')
      const dupe = makeDelete('a')
      act(() => api.schedule(first))
      act(() => api.schedule(dupe))
      expect(screen.getAllByRole('status')).toHaveLength(1)
      advance(6000)
      expect(first.commit).toHaveBeenCalledTimes(1)
      expect(dupe.commit).not.toHaveBeenCalled()

      const again = makeDelete('b')
      act(() => api.schedule(again))
      act(() => api.undo('b'))
      const reScheduled = makeDelete('b')
      act(() => api.schedule(reScheduled))
      expect(screen.getAllByRole('status')).toHaveLength(1)
    })

    it('clears timers without committing when the provider unmounts', () => {
      const { unmount } = renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      unmount()
      advance(20000)
      expect(pd.commit).not.toHaveBeenCalled()
    })

    it('commits once under StrictMode', async () => {
      renderProvider(null, true)
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      advance(6000)
      await flush()
      advance(20000)
      expect(pd.commit).toHaveBeenCalledTimes(1)
      expect(pd.onSettled).toHaveBeenCalledTimes(1)
    })
  })

  describe('more than three pending deletes', () => {
    it('shows the newest three, oldest first, and the hidden one still commits on its own timer', () => {
      renderProvider()
      const all = ['a', 'b', 'c', 'd'].map(id => makeDelete(id))
      all.forEach(pd => act(() => api.schedule(pd)))
      const toasts = screen.getAllByRole('status')
      expect(toasts.map(t => t.textContent)).toEqual(['Deleted bUndo', 'Deleted cUndo', 'Deleted dUndo'])
      advance(6000)
      all.forEach(pd => expect(pd.commit).toHaveBeenCalledTimes(1))
    })

    it('reveals the hidden toast without the enter animation when a visible one is undone, commit time unchanged', () => {
      renderProvider()
      const all = ['a', 'b', 'c', 'd'].map(id => makeDelete(id))
      act(() => api.schedule(all[0]))
      advance(2000)
      act(() => api.schedule(all[1]))
      act(() => api.schedule(all[2]))
      act(() => api.schedule(all[3]))
      expect(screen.queryByText('Deleted a')).not.toBeInTheDocument()

      fireEvent.keyDown(document.body, { key: 'u' })
      const revealed = screen.getByText('Deleted a').closest('.toast')
      expect(revealed).not.toBeNull()
      expect(revealed).not.toHaveClass('toast-enter')
      // The hidden toast kept its original deadline: 6s after it was scheduled, not 6s after reveal.
      advance(3999)
      expect(all[0].commit).not.toHaveBeenCalled()
      advance(1)
      expect(all[0].commit).toHaveBeenCalledTimes(1)
    })
  })

  describe('pausing', () => {
    it('pauses while the pointer hovers and resumes with at least 2s left', () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      const toast = screen.getByRole('status')
      advance(1000)
      fireEvent.pointerEnter(toast)
      advance(60000)
      expect(pd.commit).not.toHaveBeenCalled()
      fireEvent.pointerLeave(toast)
      // 5s remained, so it resumes with 5s.
      advance(4999)
      expect(pd.commit).not.toHaveBeenCalled()
      advance(1)
      expect(pd.commit).toHaveBeenCalledTimes(1)
    })

    it('resumes with a 2s floor when less than 2s remained', () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      const toast = screen.getByRole('status')
      advance(5500)
      fireEvent.pointerEnter(toast)
      fireEvent.pointerLeave(toast)
      advance(1999)
      expect(pd.commit).not.toHaveBeenCalled()
      advance(1)
      expect(pd.commit).toHaveBeenCalledTimes(1)
    })

    it('pauses while focus is inside the toast and while the pointer is down', () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      const toast = screen.getByRole('status')
      const button = within(toast).getByRole('button', { name: 'Undo' })
      advance(1000)
      act(() => button.focus())
      advance(30000)
      expect(pd.commit).not.toHaveBeenCalled()
      fireEvent.pointerDown(toast)
      act(() => button.blur())
      advance(30000)
      expect(pd.commit).not.toHaveBeenCalled()
      fireEvent.pointerUp(toast)
      advance(5000)
      expect(pd.commit).toHaveBeenCalledTimes(1)
    })

    it('resumes when a press is dragged out of the toast and released elsewhere', () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      const toast = screen.getByRole('status')
      advance(1000)
      fireEvent.pointerDown(toast)
      fireEvent.pointerLeave(toast)
      advance(4999)
      expect(pd.commit).not.toHaveBeenCalled()
      advance(1)
      expect(pd.commit).toHaveBeenCalledTimes(1)
    })

    it('resumes on a document-level pointerup when the release never reaches the toast', () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      fireEvent.pointerDown(screen.getByRole('status'))
      advance(30000)
      expect(pd.commit).not.toHaveBeenCalled()
      fireEvent.pointerUp(document.body)
      advance(6000)
      expect(pd.commit).toHaveBeenCalledTimes(1)
    })

    it('resumes on pointercancel', () => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      fireEvent.pointerDown(screen.getByRole('status'))
      advance(30000)
      expect(pd.commit).not.toHaveBeenCalled()
      fireEvent.pointerCancel(document.body)
      advance(6000)
      expect(pd.commit).toHaveBeenCalledTimes(1)
    })

    it('still commits a hovered toast that is later pushed out of the newest three', () => {
      renderProvider()
      const all = ['a', 'b', 'c', 'd'].map(id => makeDelete(id))
      act(() => api.schedule(all[0]))
      act(() => api.schedule(all[1]))
      act(() => api.schedule(all[2]))
      advance(1000)
      fireEvent.pointerEnter(screen.getByText('Deleted a').closest('.toast') as HTMLElement)
      act(() => api.schedule(all[3]))
      expect(screen.queryByText('Deleted a')).not.toBeInTheDocument()
      advance(6000)
      expect(all[0].commit).toHaveBeenCalledTimes(1)
    })

    it('does not pause the hidden older toasts', () => {
      renderProvider()
      const all = ['a', 'b', 'c', 'd'].map(id => makeDelete(id))
      all.forEach(pd => act(() => api.schedule(pd)))
      fireEvent.pointerEnter(screen.getAllByRole('status')[0])
      advance(6000)
      expect(all[0].commit).toHaveBeenCalledTimes(1)
      expect(all[1].commit).not.toHaveBeenCalled()
    })
  })

  describe('failure', () => {
    it('restores the item and shows a persistent role=alert toast that Dismiss closes', async () => {
      renderProvider()
      const pd = makeDelete('a', { commit: vi.fn(() => Promise.reject(new Error('404'))) })
      act(() => api.schedule(pd))
      advance(6000)
      await flush()
      expect(api.isPending('a')).toBe(false)
      expect(pd.onSettled).toHaveBeenCalledTimes(1)
      const alert = within(region()).getByRole('alert')
      expect(alert).toHaveTextContent("Couldn't delete a")
      advance(10000)
      expect(within(region()).getByRole('alert')).toBeInTheDocument()
      fireEvent.click(within(alert).getByRole('button', { name: /dismiss/i }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows the error toast for a rejected 404-shaped response', async () => {
      renderProvider()
      const pd = makeDelete('a', { commit: vi.fn(() => Promise.reject({ status: 404 })) })
      act(() => api.schedule(pd))
      advance(6000)
      await flush()
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('Escape closes the error toast only when it holds focus', async () => {
      renderProvider()
      act(() => api.schedule(makeDelete('a', { commit: vi.fn(() => Promise.reject(new Error('x'))) })))
      advance(6000)
      await flush()
      const alert = screen.getByRole('alert')
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.getByRole('alert')).toBeInTheDocument()
      act(() => alert.focus())
      fireEvent.keyDown(alert, { key: 'Escape' })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps at most three error toasts, dropping the oldest', async () => {
      renderProvider()
      for (const id of ['a', 'b', 'c', 'd']) {
        act(() => api.schedule(makeDelete(id, { commit: vi.fn(() => Promise.reject(new Error('x'))) })))
        advance(6000)
        await flush()
      }
      const alerts = screen.getAllByRole('alert')
      expect(alerts).toHaveLength(3)
      expect(alerts[0]).toHaveTextContent("Couldn't delete b")
    })
  })

  describe('keyboard', () => {
    function press(init: KeyboardEventInit, target: Element = document.body) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      target.dispatchEvent(event)
      return event
    }

    it.each([
      ['Ctrl+Z', { key: 'z', ctrlKey: true }],
      ['Cmd+Z', { key: 'z', metaKey: true }],
      ['u', { key: 'u' }],
    ])('%s undoes the most recent delete and prevents default', (_name, init) => {
      renderProvider()
      const older = makeDelete('a')
      const newest = makeDelete('b')
      act(() => api.schedule(older))
      act(() => api.schedule(newest))
      let event!: KeyboardEvent
      act(() => { event = press(init) })
      expect(event.defaultPrevented).toBe(true)
      expect(api.isPending('b')).toBe(false)
      expect(api.isPending('a')).toBe(true)
      advance(10000)
      expect(newest.commit).not.toHaveBeenCalled()
      expect(older.commit).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['input', () => document.createElement('input')],
      ['textarea', () => document.createElement('textarea')],
      ['select', () => document.createElement('select')],
      ['contenteditable', () => {
        const el = document.createElement('div')
        el.contentEditable = 'true'
        // jsdom does not implement isContentEditable
        Object.defineProperty(el, 'isContentEditable', { value: true })
        return el
      }],
    ])('ignores the shortcut while a %s is the target', (_name, make) => {
      renderProvider()
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      const el = make()
      document.body.appendChild(el)
      let event!: KeyboardEvent
      act(() => { event = press({ key: 'u' }, el) })
      expect(event.defaultPrevented).toBe(false)
      act(() => { event = press({ key: 'z', ctrlKey: true }, el) })
      expect(event.defaultPrevented).toBe(false)
      expect(api.isPending('a')).toBe(true)
    })

    it('does nothing and does not prevent default when nothing is pending', () => {
      renderProvider()
      let event!: KeyboardEvent
      act(() => { event = press({ key: 'u' }) })
      expect(event.defaultPrevented).toBe(false)
      act(() => { event = press({ key: 'z', ctrlKey: true }) })
      expect(event.defaultPrevented).toBe(false)
    })

    it('ignores Escape, modified or shifted u, repeats, composition and already-handled events', () => {
      renderProvider()
      act(() => api.schedule(makeDelete('a')))
      act(() => { press({ key: 'Escape' }) })
      act(() => { press({ key: 'u', ctrlKey: true }) })
      act(() => { press({ key: 'z', ctrlKey: true, shiftKey: true }) })
      act(() => { press({ key: 'u', repeat: true }) })
      act(() => { press({ key: 'u', isComposing: true }) })
      const handled = new KeyboardEvent('keydown', { key: 'u', bubbles: true, cancelable: true })
      handled.preventDefault()
      act(() => { document.body.dispatchEvent(handled) })
      expect(api.isPending('a')).toBe(true)
    })

    it('ignores the shortcut while a modal dialog is open or the target is inside a dialog', () => {
      renderProvider(<div role="dialog" aria-modal="true"><button>Close</button></div>)
      act(() => api.schedule(makeDelete('a')))
      act(() => { press({ key: 'u' }) })
      expect(api.isPending('a')).toBe(true)
    })

    it('ignores the shortcut while the settings drawer is open', () => {
      renderProvider(<div className="settings-drawer is-open" />)
      act(() => api.schedule(makeDelete('a')))
      act(() => { press({ key: 'u' }) })
      expect(api.isPending('a')).toBe(true)
    })
  })

  describe('focus restore', () => {
    it('restores focus when Undo is clicked, even though focus was elsewhere', () => {
      renderProvider(<button>Elsewhere</button>)
      const pd = makeDelete('a')
      act(() => api.schedule(pd))
      screen.getByRole('button', { name: 'Elsewhere' }).focus()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      advance(50)
      expect(pd.onRestore).toHaveBeenCalledTimes(1)
    })

    it('restores focus after a keyboard undo only when nothing else holds focus', () => {
      renderProvider(<button>Elsewhere</button>)
      const first = makeDelete('a')
      const second = makeDelete('b')
      act(() => api.schedule(first))
      act(() => api.schedule(second))
      act(() => { fireEvent.keyDown(document.body, { key: 'u' }) })
      advance(50)
      expect(second.onRestore).toHaveBeenCalledTimes(1)

      screen.getByRole('button', { name: 'Elsewhere' }).focus()
      act(() => { fireEvent.keyDown(document.activeElement!, { key: 'u' }) })
      advance(50)
      expect(first.onRestore).not.toHaveBeenCalled()
    })
  })
})

describe('useToast without a provider', () => {
  it('schedule runs the commit and onSettled immediately and hides nothing', async () => {
    function Bare() {
      const toast = useToast()
      useEffect(() => {
        api = toast
      })
      return null
    }
    render(<Bare />)
    const pd = makeDelete('a')
    api.schedule(pd)
    await vi.waitFor(() => expect(pd.onSettled).toHaveBeenCalledTimes(1))
    expect(pd.commit).toHaveBeenCalledTimes(1)
    expect(api.isPending('a')).toBe(false)
    expect(api.pendingKeys.size).toBe(0)
  })
})
