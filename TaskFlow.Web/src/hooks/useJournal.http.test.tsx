import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { client } from '@/api/client/client.gen'
import {
  useCreateTodoMutation,
  useCreateJournalNoteMutation,
  useAddLogEntryMutation,
  useEditTodoMutation,
  useRemoveTodoMutation,
  useUpdateJournalNoteMutation,
} from './useJournal'
import { useCreateNoteMutation } from './useNotes'

// Real client + mocked fetch: a 5xx must run onError, never onSuccess (so typed text is not cleared).
describe('journal and note mutations on HTTP 500 (#232)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } })),
    )
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  function wrapper() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

  it.each([
    ['useCreateTodoMutation', () => useCreateTodoMutation(1, '2026-06-10'), 'todo'],
    ['useCreateJournalNoteMutation', () => useCreateJournalNoteMutation(1), 'note'],
    ['useCreateNoteMutation', () => useCreateNoteMutation(1), { content: 'note' }],
    ['useEditTodoMutation', () => useEditTodoMutation(1), { id: 2, title: 'edited' }],
    ['useRemoveTodoMutation', () => useRemoveTodoMutation(1), 2],
    ['useUpdateJournalNoteMutation', () => useUpdateJournalNoteMutation(1), { id: 3, content: 'edited' }],
  ] as const)('%s calls onError and not onSuccess', async (_name, useHook, vars) => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useHook() as { mutate: (v: never, o: object) => void; isError: boolean }, { wrapper: wrapper() })
    result.current.mutate(vars as never, { onSuccess, onError })
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('useAddLogEntryMutation calls onError and not onSuccess', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useAddLogEntryMutation(1), { wrapper: wrapper() })
    result.current.mutate({ content: 'log' }, { onSuccess, onError })
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
