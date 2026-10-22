import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useTasksQuery, useTaskQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from './useTasks'
import { projectKeys } from './projectKeys'

vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  getTaskV1: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'

function makeWrapper(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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

describe('task mutation bodies carry completion through status only', () => {
  beforeEach(() => vi.clearAllMocks())

  it('create body has status and no isComplete key', async () => {
    vi.mocked(sdk.postApiV1TaskItems).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    const { result } = renderHook(() => useCreateTaskMutation(), { wrapper: makeWrapper() })
    result.current.mutate({ title: 'T', status: 'completed' })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    const body = vi.mocked(sdk.postApiV1TaskItems).mock.calls[0][0]?.body as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(Object.keys(body)).not.toContain('isComplete')
  })

  it('update body has status and no isComplete key', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 2 }, response: new Response() } as never)
    const { result } = renderHook(() => useUpdateTaskMutation(), { wrapper: makeWrapper() })
    result.current.mutate({ id: 2, data: { title: 'U', status: 'completed' } })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    const body = vi.mocked(sdk.putApiV1TaskItemsById).mock.calls[0][0]?.body as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(Object.keys(body)).not.toContain('isComplete')
  })
})

describe('useUpdateTaskMutation timezone offset', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('sends the current timezoneOffsetMinutes on every call (evaluated per call)', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 2 }, response: new Response() } as never)
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset')
    const { result } = renderHook(() => useUpdateTaskMutation(), { wrapper: makeWrapper() })

    spy.mockReturnValue(300) // US Central CDT => -300
    await act(async () => { await result.current.mutateAsync({ id: 2, data: { title: 'U' } }) })
    spy.mockReturnValue(480) // UTC-8 => -480
    await act(async () => { await result.current.mutateAsync({ id: 2, data: { title: 'U' } }) })

    const calls = vi.mocked(sdk.putApiV1TaskItemsById).mock.calls
    expect(calls[0][0]?.body).toEqual(expect.objectContaining({ timezoneOffsetMinutes: -300 }))
    expect(calls[1][0]?.body).toEqual(expect.objectContaining({ timezoneOffsetMinutes: -480 }))
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

describe('project handling in task mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  function setup<T>(useHook: () => T) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(useHook, { wrapper: makeWrapper(qc) })
    const keys = () => invalidate.mock.calls.map(c => c[0]?.queryKey)
    return { result, keys }
  }

  it('create forwards projectId in the POST body', async () => {
    vi.mocked(sdk.postApiV1TaskItems).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    const { result } = setup(useCreateTaskMutation)
    result.current.mutate({ title: 'T', projectId: 4 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(sdk.postApiV1TaskItems).mock.calls[0][0]?.body).toEqual(expect.objectContaining({ projectId: 4 }))
  })

  it('create sends projectId null when none is chosen and does not invalidate project keys', async () => {
    vi.mocked(sdk.postApiV1TaskItems).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    const { result, keys } = setup(useCreateTaskMutation)
    result.current.mutate({ title: 'T' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(sdk.postApiV1TaskItems).mock.calls[0][0]?.body).toEqual(expect.objectContaining({ projectId: null }))
    expect(keys()).not.toContainEqual(projectKeys.all)
  })

  it('create with a project invalidates tasks and project keys', async () => {
    vi.mocked(sdk.postApiV1TaskItems).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    const { result, keys } = setup(useCreateTaskMutation)
    result.current.mutate({ title: 'T', projectId: 4 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys()).toContainEqual(['tasks'])
    expect(keys()).toContainEqual(projectKeys.all)
  })

  it('update body never contains projectId, even if the caller passes one', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 2 }, response: new Response() } as never)
    const { result } = setup(useUpdateTaskMutation)
    result.current.mutate({ id: 2, data: { title: 'U', projectId: 9 } as never })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(sdk.putApiV1TaskItemsById).mock.calls[0][0]?.body).not.toHaveProperty('projectId')
  })

  it('update invalidates tasks, the task detail and project keys', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 2 }, response: new Response() } as never)
    const { result, keys } = setup(useUpdateTaskMutation)
    result.current.mutate({ id: 2, data: { title: 'U' } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys()).toContainEqual(['tasks'])
    expect(keys()).toContainEqual(['tasks', 2])
    expect(keys()).toContainEqual(projectKeys.all)
  })

  it('delete invalidates project keys', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({ response: new Response() } as never)
    const { result, keys } = setup(useDeleteTaskMutation)
    result.current.mutate(5)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys()).toContainEqual(projectKeys.all)
  })

  it('does not invalidate project keys when the update fails', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockRejectedValue({ code: 'X' })
    const { result, keys } = setup(useUpdateTaskMutation)
    result.current.mutate({ id: 2, data: { title: 'U' } })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys()).toEqual([])
  })
})
