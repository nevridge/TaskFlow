import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { client } from './client/client.gen'
import { deleteApiV1TaskItemsById } from './client/sdk.gen'
import { useDeleteTaskMutation } from '@/hooks/useTasks'
import { useDeleteNoteMutation } from '@/hooks/useNotes'

// Uses the REAL generated client with a mocked fetch: the mutations must reject on HTTP errors end to end.
describe('task and note delete (real client, mocked fetch)', () => {
  const fetchMock = vi.fn()

  function wrapper() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  it.each([
    ['422 with a JSON code', () => new Response(JSON.stringify({ code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' }), { status: 422, headers: { 'Content-Type': 'application/json' } })],
    ['500', () => new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } })],
    ['404 with an empty body', () => new Response(null, { status: 404 })],
  ])('useDeleteTaskMutation rejects on %s', async (_label, makeResponse) => {
    fetchMock.mockImplementation(() => Promise.resolve(makeResponse()))
    const { result } = renderHook(() => useDeleteTaskMutation(), { wrapper: wrapper() })
    result.current.mutate(5)
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('useDeleteTaskMutation keeps the 422 body code on the rejection', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' }), { status: 422, headers: { 'Content-Type': 'application/json' } })),
    )
    const { result } = renderHook(() => useDeleteTaskMutation(), { wrapper: wrapper() })
    result.current.mutate(5)
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toEqual({ code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' })
  })

  it('useDeleteTaskMutation resolves on 200', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })))
    const { result } = renderHook(() => useDeleteTaskMutation(), { wrapper: wrapper() })
    result.current.mutate(5)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it.each([
    ['500', () => new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } })],
    ['404 with an empty body', () => new Response(null, { status: 404 })],
  ])('useDeleteNoteMutation rejects on %s', async (_label, makeResponse) => {
    fetchMock.mockImplementation(() => Promise.resolve(makeResponse()))
    const { result } = renderHook(() => useDeleteNoteMutation(3), { wrapper: wrapper() })
    result.current.mutate(7)
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('the toast commit path (throwOnError: false) exposes the status so a 404 can count as success', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 404 })))
    const result = await deleteApiV1TaskItemsById({ path: { id: 5 }, throwOnError: false })
    expect(result.response?.status).toBe(404)
    expect(result.response?.ok).toBe(false)
  })

  it('the toast commit path keeps the 422 JSON body code', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' }), { status: 422, headers: { 'Content-Type': 'application/json' } })),
    )
    const result = await deleteApiV1TaskItemsById({ path: { id: 5 }, throwOnError: false })
    expect(result.response?.status).toBe(422)
    expect(result.error).toEqual({ code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' })
  })
})
