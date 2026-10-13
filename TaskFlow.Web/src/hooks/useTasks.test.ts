import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { taskKeys, useTasksQuery, useTaskCountQuery, useTaskQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from './useTasks'

vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  getApiV1TaskItemsCount: vi.fn(),
  getTaskV1: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useTasksQuery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls getApiV1TaskItems', async () => {
    vi.mocked(sdk.getApiV1TaskItems).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useTasksQuery(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.getApiV1TaskItems).toHaveBeenCalledOnce()
  })
})

describe('useTaskCountQuery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the count from the generated client on success', async () => {
    vi.mocked(sdk.getApiV1TaskItemsCount).mockResolvedValue({ data: { count: 5 }, response: new Response() } as never)
    const { result } = renderHook(() => useTaskCountQuery(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sdk.getApiV1TaskItemsCount).toHaveBeenCalledOnce()
    expect(result.current.data?.data?.count).toBe(5)
  })

  it('leaves data undefined when the request fails', async () => {
    vi.mocked(sdk.getApiV1TaskItemsCount).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTaskCountQuery(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('refetches when the tasks keys are invalidated', async () => {
    vi.mocked(sdk.getApiV1TaskItemsCount)
      .mockResolvedValueOnce({ data: { count: 2 }, response: new Response() } as never)
      .mockResolvedValueOnce({ data: { count: 3 }, response: new Response() } as never)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useTaskCountQuery(), { wrapper })
    await waitFor(() => expect(result.current.data?.data?.count).toBe(2))
    await queryClient.invalidateQueries({ queryKey: taskKeys.all })
    await waitFor(() => expect(result.current.data?.data?.count).toBe(3))
    expect(sdk.getApiV1TaskItemsCount).toHaveBeenCalledTimes(2)
  })
})

describe('useTaskQuery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls getTaskV1 with the task id', async () => {
    vi.mocked(sdk.getTaskV1).mockResolvedValue({ data: { id: 1, title: 'T' }, response: new Response() } as never)
    const { result } = renderHook(() => useTaskQuery(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.getTaskV1).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 1 } }))
  })
})

describe('useCreateTaskMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls postApiV1TaskItems', async () => {
    vi.mocked(sdk.postApiV1TaskItems).mockResolvedValue({ data: { id: 1, title: 'T' }, response: new Response() } as never)
    const { result } = renderHook(() => useCreateTaskMutation(), { wrapper: makeWrapper() })
    result.current.mutate({ title: 'T' })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.postApiV1TaskItems).toHaveBeenCalledOnce()
  })
})

describe('useUpdateTaskMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls putApiV1TaskItemsById with id and body', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 2, title: 'U' }, response: new Response() } as never)
    const { result } = renderHook(() => useUpdateTaskMutation(), { wrapper: makeWrapper() })
    result.current.mutate({ id: 2, data: { title: 'U' } })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.putApiV1TaskItemsById).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 2 },
      body: expect.objectContaining({ title: 'U' }),
    }))
  })
})

describe('useDeleteTaskMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls deleteApiV1TaskItemsById with the task id', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({ response: new Response() } as never)
    const { result } = renderHook(() => useDeleteTaskMutation(), { wrapper: makeWrapper() })
    result.current.mutate(5)
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.deleteApiV1TaskItemsById).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 5 } }))
  })
})
