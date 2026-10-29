import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/context/ToastContext'
import { useUndoableDelete, pendingKey, filterPending, usePendingDeleteIds, useFilterPending } from './useUndoableDelete'

const commit = vi.fn(() => Promise.resolve({}))
const invalidate = vi.fn()
const restoreFocus = vi.fn()

function Harness() {
  const { requestDelete, isHidden } = useUndoableDelete()
  return (
    <div>
      <button
        onClick={() =>
          requestDelete({
            key: 'todo:1:5',
            hideKeys: ['todo:1:6', 'todo:1:7'],
            message: 'Removed',
            errorMessage: 'Failed',
            commit,
            invalidate,
            restoreFocus,
          })
        }
      >
        Delete parent
      </button>
      <ul>
        {['todo:1:5', 'todo:1:6', 'todo:1:7', 'todo:1:8'].map(k => (
          <li key={k}>{isHidden(k) ? `${k} hidden` : `${k} visible`}</li>
        ))}
      </ul>
    </div>
  )
}

describe('useUndoableDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides the key and its cascade keys, leaving siblings visible', () => {
    render(<ToastProvider><Harness /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete parent' }))
    expect(screen.getByText('todo:1:5 hidden')).toBeInTheDocument()
    expect(screen.getByText('todo:1:6 hidden')).toBeInTheDocument()
    expect(screen.getByText('todo:1:7 hidden')).toBeInTheDocument()
    expect(screen.getByText('todo:1:8 visible')).toBeInTheDocument()
  })

  it('Undo restores every hidden key and never commits', () => {
    render(<ToastProvider><Harness /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete parent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('todo:1:5 visible')).toBeInTheDocument()
    expect(screen.getByText('todo:1:6 visible')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(10000) })
    expect(commit).not.toHaveBeenCalled()
    expect(restoreFocus).toHaveBeenCalledTimes(1)
  })

  it('commits after the undo window, then invalidates and releases the keys', async () => {
    render(<ToastProvider><Harness /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete parent' }))
    act(() => { vi.advanceTimersByTime(6000) })
    expect(commit).toHaveBeenCalledTimes(1)
    await act(async () => { await Promise.resolve() })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('todo:1:5 visible')).toBeInTheDocument()
  })

  it('durationMs 10000 sends nothing at 6s and commits at 10s; no durationMs commits at 6s (AC1)', () => {
    function Timed() {
      const { requestDelete } = useUndoableDelete()
      return (
        <>
          <button onClick={() => requestDelete({ key: 'task:1', message: 'T', errorMessage: 'F', durationMs: 10000, commit, invalidate })}>long</button>
          <button onClick={() => requestDelete({ key: 'tasknote:1', message: 'N', errorMessage: 'F', commit, invalidate })}>default</button>
        </>
      )
    }
    render(<ToastProvider><Timed /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'long' }))
    act(() => { vi.advanceTimersByTime(6000) })
    expect(commit).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(commit).toHaveBeenCalledTimes(1)

    commit.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'default' }))
    act(() => { vi.advanceTimersByTime(6000) })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('stores task, task-note and journal keys separately and filters per kind (AC2, AC3)', () => {
    const items = [{ id: 5, label: 'five' }, { id: 6, label: 'six' }]
    function Filtered() {
      const { requestDelete } = useUndoableDelete()
      const ids = usePendingDeleteIds()
      const tasks = useFilterPending('task', items)
      const notes = useFilterPending('tasknote', items)
      return (
        <div>
          <button onClick={() => requestDelete({ key: pendingKey('task', 5), message: 'T', errorMessage: 'F', commit, invalidate })}>del task 5</button>
          <button onClick={() => requestDelete({ key: 'note:6', message: 'J', errorMessage: 'F', commit, invalidate })}>del journal note 6</button>
          <button onClick={() => requestDelete({ key: pendingKey('tasknote', 5), message: 'N', errorMessage: 'F', commit, invalidate })}>del task note 5</button>
          <span data-testid="tasks">{tasks.map(i => i.id).join(',')}</span>
          <span data-testid="notes">{notes.map(i => i.id).join(',')}</span>
          <span data-testid="pending">{ids.isPending('task', 5) ? 'task5' : ''}{ids.isPending('tasknote', 6) ? 'note6' : ''}</span>
        </div>
      )
    }
    render(<ToastProvider><Filtered /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'del task 5' }))
    expect(screen.getByTestId('tasks')).toHaveTextContent('6')
    expect(screen.getByTestId('notes')).toHaveTextContent('5,6')

    // A journal note:6 does not hide task note 6 (and task:5 does not hide task note 5).
    fireEvent.click(screen.getByRole('button', { name: 'del journal note 6' }))
    expect(screen.getByTestId('notes')).toHaveTextContent('5,6')
    expect(screen.getByTestId('pending')).toHaveTextContent('task5')

    fireEvent.click(screen.getByRole('button', { name: 'del task note 5' }))
    expect(screen.getByTestId('notes')).toHaveTextContent('6')
    expect(screen.getByTestId('tasks')).toHaveTextContent('6')
  })
})

describe('filterPending', () => {
  it('removes only items of the matching kind and tolerates a missing id', () => {
    const keys = new Set(['task:1', 'tasknote:2', 'note:3'])
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: undefined }]
    expect(filterPending('task', items, keys)).toEqual([{ id: 2 }, { id: 3 }, { id: undefined }])
    expect(filterPending('tasknote', items, keys)).toEqual([{ id: 1 }, { id: 3 }, { id: undefined }])
  })

  it('returns the same array when nothing is pending', () => {
    const items = [{ id: 1 }]
    expect(filterPending('task', items, new Set())).toBe(items)
  })
})
