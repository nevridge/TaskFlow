import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useUpdateTaskMutation, taskKeys } from './useTasks'
import { deriveTaskStatuses } from '@/lib/task-derived-status'
import { getTaskMutationErrorMessage } from '@/lib/task-errors'

vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  getTaskV1: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'

interface Row { id: number; status: string; parentTaskItemId: number | null }

const seed = {
  data: [
    { id: 1, title: 'Parent', status: 'Todo', parentTaskItemId: null },
    { id: 2, title: 'Child', status: 'Todo', parentTaskItemId: 1 },
  ],
}

const parentStatus = (qc: QueryClient) =>
  deriveTaskStatuses((qc.getQueryData<{ data: Row[] }>(taskKeys.all)?.data) ?? []).get(1)?.displayStatus

describe('optimistic child status change and the derived parent status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates the parent immediately, then rolls back and invalidates on a TASK_PARENT_STATUS_DERIVED 422', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(taskKeys.all, seed)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    let reject: (e: unknown) => void = () => {}
    vi.mocked(sdk.putApiV1TaskItemsById).mockReturnValue(new Promise((_, r) => { reject = r }) as never)

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useUpdateTaskMutation(), { wrapper })
    expect(parentStatus(qc)).toBe('Todo')

    result.current.mutate({ id: 2, data: { title: 'Child', status: 'inProgress' } })
    await waitFor(() => expect(parentStatus(qc)).toBe('InProgress'))

    const error = { code: 'TASK_PARENT_STATUS_DERIVED', message: 'raw server text' }
    reject(error)
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(parentStatus(qc)).toBe('Todo')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all })
    const message = getTaskMutationErrorMessage(error)
    expect(message).toBe("This task's status follows its open subtasks. Complete or remove them to change it.")
    expect(message).not.toContain('TASK_PARENT_STATUS_DERIVED')
  })
})
