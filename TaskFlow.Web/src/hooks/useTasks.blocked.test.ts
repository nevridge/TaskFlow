import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  useUpdateTaskMutation,
  useBlockTaskMutation,
  useUnblockTaskMutation,
  useEditBlockedReasonMutation,
  taskKeys,
} from './useTasks'

vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  getTaskV1: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  patchApiV1TaskItemsById: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'

function makeWrapper(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

const todoRow = { id: 1, title: 'T', status: 'Todo', blockedReason: null, blockedAt: null, previousStatus: null }
const blockedRow = {
  id: 1,
  title: 'T',
  status: 'Blocked',
  blockedReason: 'Waiting',
  blockedAt: '2026-05-01T00:00:00Z',
  previousStatus: 'Todo',
}

function seeded(row: object) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(taskKeys.all, { data: [row] })
  qc.setQueryData(taskKeys.detail(1), { data: row })
  return qc
}

const listRow = (qc: QueryClient) =>
  (qc.getQueryData(taskKeys.all) as { data: Array<Record<string, unknown>> }).data[0]

function deferred() {
  let resolve!: (v: unknown) => void
  let reject!: (e: unknown) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('blocked status mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('block PATCHes status blocked with the reason and never PUTs', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const { result } = renderHook(() => useBlockTaskMutation(), { wrapper: makeWrapper(seeded(todoRow)) })
    await act(async () => { await result.current.mutateAsync({ id: 1, reason: 'Waiting on Sam' }) })
    expect(sdk.patchApiV1TaskItemsById).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 1 },
      body: { status: 'blocked', blockedReason: 'Waiting on Sam' },
    }))
    expect(sdk.putApiV1TaskItemsById).not.toHaveBeenCalled()
  })

  it('block omits blockedReason when the reason is empty', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const { result } = renderHook(() => useBlockTaskMutation(), { wrapper: makeWrapper(seeded(todoRow)) })
    await act(async () => { await result.current.mutateAsync({ id: 1, reason: '' }) })
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toEqual({ status: 'blocked' })
  })

  it('block updates the list and detail caches before the server responds', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const qc = seeded(todoRow)
    const { result } = renderHook(() => useBlockTaskMutation(), { wrapper: makeWrapper(qc) })
    act(() => { result.current.mutate({ id: 1, reason: 'Waiting' }) })
    await waitFor(() => expect(listRow(qc).status).toBe('Blocked'))
    expect(listRow(qc)).toMatchObject({ blockedReason: 'Waiting', previousStatus: 'Todo' })
    expect((qc.getQueryData(taskKeys.detail(1)) as { data: { status: string } }).data.status).toBe('Blocked')
    await act(async () => { d.resolve({ data: {} }); await d.promise })
  })

  it('failed block rolls the cache back', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const qc = seeded(todoRow)
    const { result } = renderHook(() => useBlockTaskMutation(), { wrapper: makeWrapper(qc) })
    act(() => { result.current.mutate({ id: 1, reason: 'Waiting' }) })
    await waitFor(() => expect(listRow(qc).status).toBe('Blocked'))
    await act(async () => { d.reject({ code: 'TASK_BLOCK_DRAFT_NOT_ALLOWED' }); await d.promise.catch(() => {}) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(listRow(qc)).toMatchObject({ status: 'Todo', blockedReason: null })
  })

  it('unblock PATCHes status todo and optimistically restores Todo', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const qc = seeded(blockedRow)
    const { result } = renderHook(() => useUnblockTaskMutation(), { wrapper: makeWrapper(qc) })
    act(() => { result.current.mutate({ id: 1 }) })
    await waitFor(() => expect(listRow(qc).status).toBe('Todo'))
    expect(listRow(qc)).toMatchObject({ blockedReason: null, blockedAt: null, previousStatus: null })
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toEqual({ status: 'todo' })
    await act(async () => { d.resolve({ data: {} }); await d.promise })
  })

  it('failed unblock restores the Blocked row with its reason', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockRejectedValue({ message: 'boom' })
    const qc = seeded(blockedRow)
    const { result } = renderHook(() => useUnblockTaskMutation(), { wrapper: makeWrapper(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 1 }).catch(() => {}) })
    expect(listRow(qc)).toMatchObject({ status: 'Blocked', blockedReason: 'Waiting', previousStatus: 'Todo' })
  })

  it('edit reason sends only blockedReason (no status)', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const qc = seeded(blockedRow)
    const { result } = renderHook(() => useEditBlockedReasonMutation(), { wrapper: makeWrapper(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 1, reason: 'New reason' }) })
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toEqual({ blockedReason: 'New reason' })
  })

  it('invalidates the extra keys it was given', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const qc = seeded(todoRow)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useBlockTaskMutation([['journal', 10, 'todos']]), { wrapper: makeWrapper(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 1, reason: '' }) })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['journal', 10, 'todos'] })
  })
})

describe('useUpdateTaskMutation blockedReason', () => {
  beforeEach(() => vi.clearAllMocks())

  it('omits blockedReason unless provided and sends "" to clear it', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const { result } = renderHook(() => useUpdateTaskMutation(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync({ id: 1, data: { title: 'T' } }) })
    expect(vi.mocked(sdk.putApiV1TaskItemsById).mock.calls[0][0]?.body).not.toHaveProperty('blockedReason')
    await act(async () => {
      await result.current.mutateAsync({ id: 1, data: { title: 'T', status: 'blocked', blockedReason: '' } })
    })
    expect(vi.mocked(sdk.putApiV1TaskItemsById).mock.calls[1][0]?.body).toHaveProperty('blockedReason', '')
  })
})
