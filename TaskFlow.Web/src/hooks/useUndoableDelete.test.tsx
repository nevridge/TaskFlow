import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/context/ToastContext'
import { useUndoableDelete } from './useUndoableDelete'

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
})
