import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { makeProviders } from '@/test/renderWithToast'
import {
  TaskDeleteBlockedError,
  getTaskDeleteErrorMessage,
  useDeleteNoteUndoable,
  useDeleteTaskUndoable,
} from './useDeleteTaskUndoable'
import { useToast } from '@/context/useToast'

vi.mock('@/api/client/sdk.gen', () => ({
  deleteApiV1TaskItemsById: vi.fn(),
  deleteApiV1TaskItemsByTaskIdNotesById: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'

const res = (status: number) => ({ ok: status >= 200 && status < 300, status })

function setup() {
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined)
  const remove = vi.spyOn(qc, 'removeQueries')
  const hook = renderHook(
    () => ({ task: useDeleteTaskUndoable(), note: useDeleteNoteUndoable(3), toast: useToast() }),
    { wrapper: makeProviders(qc) },
  )
  return { ...hook, invalidate, remove }
}

describe('useDeleteTaskUndoable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('hides under task:<id> and commits after 10s with the id', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({ response: res(200) } as never)
    const { result, invalidate, remove } = setup()
    act(() => result.current.task({ id: 5, title: 'T' }))
    expect(result.current.toast.isPending('task:5')).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(9999) })
    expect(sdk.deleteApiV1TaskItemsById).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(2) })
    expect(sdk.deleteApiV1TaskItemsById).toHaveBeenCalledWith({ path: { id: 5 } })
    expect(remove).toHaveBeenCalledWith({ queryKey: ['tasks', 5] })
    expect(invalidate).toHaveBeenCalledTimes(3)
    expect(result.current.toast.isPending('task:5')).toBe(false)
  })

  it('treats a result without a response and without an error as success', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({} as never)
    const { result } = setup()
    act(() => result.current.task({ id: 5, title: 'T' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10100) })
    expect(result.current.toast.pendingKeys.size).toBe(0)
  })

  it('rejects with the raw error when there is no response but an error', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({ error: { message: 'net' } } as never)
    const { result } = setup()
    act(() => result.current.task({ id: 5, title: 'T' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10100) })
    expect(result.current.toast.pendingKeys.size).toBe(0)
  })

  it('a non-422 failure without an error body still rejects', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({ response: res(500) } as never)
    const { result } = setup()
    act(() => result.current.task({ id: 5, title: 'T' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10100) })
    expect(result.current.toast.pendingKeys.size).toBe(0)
  })

  it('note: hides under tasknote:<id>, commits after 6s and invalidates that task notes', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsByTaskIdNotesById).mockResolvedValue({ response: res(204) } as never)
    const { result, invalidate } = setup()
    act(() => result.current.note(9))
    expect(result.current.toast.isPending('tasknote:9')).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(6100) })
    expect(sdk.deleteApiV1TaskItemsByTaskIdNotesById).toHaveBeenCalledWith({ path: { taskId: 3, id: 9 } })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 3, 'notes'] })
  })
})

describe('getTaskDeleteErrorMessage', () => {
  it('uses specific copy only for the subtasks block', () => {
    expect(getTaskDeleteErrorMessage(new TaskDeleteBlockedError())).toBe("Can't delete: this task has subtasks.")
    expect(getTaskDeleteErrorMessage(new Error('x'))).toBe("Couldn't delete the task. Restored.")
    expect(getTaskDeleteErrorMessage({ code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' })).toBe("Couldn't delete the task. Restored.")
  })
})
