import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { client } from '@/api/client/client.gen'
import { useToggleTodoMutation, useUpdateLogEntryMutation, journalKeys } from './useJournal'

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(() => ({ autoCompleteParentWhenChildrenDone: false })),
}))

// Real client + mocked fetch returning a real non-ok 500: the optimistic cache change must be rolled back (#232).
describe('optimistic mutations roll back on HTTP 500', () => {
  const fetchMock = vi.fn()
  let release: (() => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    // The response is held until release() so the optimistic state can be observed first.
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          release = () =>
            resolve(new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
        }),
    )
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    return { qc, wrapper }
  }

  it('useToggleTodoMutation restores a Blocked todo after a 500 on complete', async () => {
    const { qc, wrapper } = setup()
    const blocked = { id: 1, title: 'Blocked task', status: 'Blocked', blockedReason: 'waiting', previousStatus: 'Todo' }
    qc.setQueryData(journalKeys.todos(10), { data: [blocked] })
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper })

    act(() => { result.current.mutate({ id: 1, done: true }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const optimistic = (qc.getQueryData(journalKeys.todos(10)) as { data: typeof blocked[] }).data[0]
    expect(optimistic.status).toBe('Completed')

    await act(async () => { release!() })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect((qc.getQueryData(journalKeys.todos(10)) as { data: unknown[] }).data).toEqual([blocked])
  })

  it('useToggleTodoMutation reports an error (no success) on a 500 for an unchecked todo', async () => {
    const { qc, wrapper } = setup()
    const todo = { id: 2, title: 'Open task', status: 'Todo' }
    qc.setQueryData(journalKeys.todos(10), { data: [todo] })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper })

    act(() => { result.current.mutate({ id: 2, done: true }, { onSuccess }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => { release!() })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(onSuccess).not.toHaveBeenCalled()
    expect((qc.getQueryData(journalKeys.todos(10)) as { data: unknown[] }).data).toEqual([todo])
  })

  it('useUpdateLogEntryMutation restores the original log content after a 500', async () => {
    const { qc, wrapper } = setup()
    const log = { id: 5, content: 'original', journalEntryId: 10, createdAt: '', linkedTaskDeleted: false }
    const entry = { id: 10, title: 't', date: '2026-05-28', createdAt: '', todoTaskItemIds: [], logEntries: [log], movedCount: 0, movedTaskItemIds: [] }
    qc.setQueryData(journalKeys.all, { data: [entry] })
    const { result } = renderHook(() => useUpdateLogEntryMutation(10), { wrapper })

    act(() => { result.current.mutate({ id: 5, content: 'edited', taskItemId: null }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const cached = () => (qc.getQueryData(journalKeys.all) as { data: (typeof entry)[] }).data[0].logEntries[0]
    expect(cached().content).toBe('edited')

    await act(async () => { release!() })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(cached().content).toBe('original')
  })
})
