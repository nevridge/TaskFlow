import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  useJournalEntries,
  useJournalTodos,
  useEnsureJournalEntry,
  useJournalNotes,
  useCreateJournalNoteMutation,
  useUpdateJournalNoteMutation,
  useDeleteJournalNoteMutation,
  useCreateTodoMutation,
  useToggleTodoMutation,
  useEditTodoMutation,
  useRemoveTodoMutation,
  useAddLogEntryMutation,
  useDeleteLogEntryMutation,
  useUpdateLogEntryMutation,
  openTodoCount,
  yesterdayOf,
  journalKeys,
} from './useJournal'
import { taskKeys } from './useTasks'

vi.mock('@/api/journal', () => ({
  getJournalEntries: vi.fn(),
  createJournalEntry: vi.fn(),
  carryForwardJournalEntry: vi.fn(),
  getJournalTodos: vi.fn(),
  removeJournalTodo: vi.fn(),
  createLogEntry: vi.fn(),
  deleteLogEntry: vi.fn(),
  updateLogEntry: vi.fn(),
  getJournalNotes: vi.fn(),
  createJournalNote: vi.fn(),
  updateJournalNote: vi.fn(),
  deleteJournalNote: vi.fn(),
}))

vi.mock('@/api/client/sdk.gen', () => ({
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
}))

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(() => ({ autoCompleteParentWhenChildrenDone: false })),
}))

import * as journalApi from '@/api/journal'
import * as sdk from '@/api/client/sdk.gen'

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useJournalEntries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls getJournalEntries', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useJournalEntries(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.getJournalEntries).toHaveBeenCalledOnce()
  })
})

describe('useJournalTodos', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls getJournalTodos with entryId when provided', async () => {
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useJournalTodos(42), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.getJournalTodos).toHaveBeenCalledWith(42)
  })

  it('does not call getJournalTodos when entryId is undefined', async () => {
    renderHook(() => useJournalTodos(undefined), { wrapper: makeWrapper() })
    // Give it a moment to potentially fire
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(journalApi.getJournalTodos).not.toHaveBeenCalled()
  })
})

describe('useEnsureJournalEntry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns entry when it exists in cache without creating', async () => {
    const entry = { id: 1, date: '2026-05-28', title: 'May 28, 2026', todoTaskItemIds: [], logEntries: [], createdAt: '', summary: null, updatedAt: null }
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [entry], response: new Response() } as never)
    const { result } = renderHook(() => useEnsureJournalEntry('2026-05-28'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.entry).toEqual(entry)
    expect(journalApi.createJournalEntry).not.toHaveBeenCalled()
  })

  it('calls createJournalEntry when no matching entry exists', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue({ data: { id: 2, date: '2026-05-28', title: 'May 28, 2026', todoTaskItemIds: [], logEntries: [], createdAt: '' }, response: new Response() } as never)
    renderHook(() => useEnsureJournalEntry('2026-05-28'), { wrapper: makeWrapper() })
    await waitFor(() => expect(journalApi.createJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-05-28' })
    ))
    // Non-today date never sends an offset
    const body = vi.mocked(journalApi.createJournalEntry).mock.calls[0][0]
    expect(body).not.toHaveProperty('timezoneOffsetMinutes')
  })

  it('calls createJournalEntry at most once (ref guard)', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue({ data: { id: 3, date: '2026-05-28', title: 'May 28, 2026', todoTaskItemIds: [], logEntries: [], createdAt: '' }, response: new Response() } as never)
    const { rerender } = renderHook(() => useEnsureJournalEntry('2026-05-28'), { wrapper: makeWrapper() })
    await waitFor(() => expect(journalApi.createJournalEntry).toHaveBeenCalledTimes(1))
    rerender()
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(journalApi.createJournalEntry).toHaveBeenCalledTimes(1)
  })
})

describe('useEnsureJournalEntry carry-forward', () => {
  const TODAY = '2026-06-10'
  const TOMORROW = '2026-06-11'
  const mkEntry = (id: number, date: string) =>
    ({ id, date, title: date, todoTaskItemIds: [], logEntries: [], createdAt: '', summary: null, updatedAt: null })
  const ok = (data: unknown) => ({ data, response: new Response() }) as never

  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    return { queryClient, wrapper }
  }
  const settle = () => act(async () => { await new Promise(r => setTimeout(r, 50)) })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0))
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300)
    vi.mocked(journalApi.carryForwardJournalEntry).mockResolvedValue(ok({ movedCount: 0 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('creates today with the offset (AC9: 300 -> -300) and does not call carry-forward', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(ok(mkEntry(1, TODAY)))
    const { wrapper } = setup()
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(journalApi.createJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ date: TODAY, timezoneOffsetMinutes: -300 })
    ))
    await settle()
    expect(journalApi.carryForwardJournalEntry).not.toHaveBeenCalled()
  })

  it('does not send an offset or carry for a non-today missing entry', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(ok(mkEntry(2, TOMORROW)))
    const { wrapper } = setup()
    renderHook(() => useEnsureJournalEntry(TOMORROW), { wrapper })
    await waitFor(() => expect(journalApi.createJournalEntry).toHaveBeenCalledTimes(1))
    expect(vi.mocked(journalApi.createJournalEntry).mock.calls[0][0]).not.toHaveProperty('timezoneOffsetMinutes')
    await settle()
    expect(journalApi.carryForwardJournalEntry).not.toHaveBeenCalled()
  })

  it('carries forward exactly once for an existing today entry, despite rerenders and refetches', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([mkEntry(7, TODAY)]))
    const { wrapper } = setup()
    const { result, rerender } = renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledWith(7, -300))
    await settle()
    rerender()
    await settle()
    expect(result.current.entry?.id).toBe(7)
    expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(1)
    expect(journalApi.createJournalEntry).not.toHaveBeenCalled()
  })

  it('never carries for an existing non-today entry', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([mkEntry(8, TOMORROW)]))
    const { wrapper } = setup()
    const { result } = renderHook(() => useEnsureJournalEntry(TOMORROW), { wrapper })
    await waitFor(() => expect(result.current.entry?.id).toBe(8))
    await settle()
    expect(journalApi.carryForwardJournalEntry).not.toHaveBeenCalled()
  })

  it('counts navigating away and back to today as a new load', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([mkEntry(7, TODAY), mkEntry(8, TOMORROW)]))
    const { wrapper } = setup()
    const { rerender } = renderHook(({ d }) => useEnsureJournalEntry(d), { wrapper, initialProps: { d: TODAY } })
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(1))
    rerender({ d: TOMORROW })
    await settle()
    expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(1)
    rerender({ d: TODAY })
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(2))
    expect(journalApi.carryForwardJournalEntry).toHaveBeenLastCalledWith(7, -300)
  })

  it('invalidates journal and task keys when movedCount > 0', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([mkEntry(7, TODAY)]))
    vi.mocked(journalApi.carryForwardJournalEntry).mockResolvedValue(ok({ movedCount: 3 }))
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all }))
    expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all })
  })

  it('does not invalidate task keys when movedCount is 0', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([mkEntry(7, TODAY)]))
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    expect(spy).not.toHaveBeenCalledWith({ queryKey: taskKeys.all })
  })

  it('does not retry when the carry-forward call fails', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([mkEntry(7, TODAY)]))
    vi.mocked(journalApi.carryForwardJournalEntry).mockRejectedValue(new Error('boom'))
    const { wrapper } = setup()
    const { result, rerender } = renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(1))
    await settle()
    rerender()
    await settle()
    expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(1)
    // Failure is silent: no error surfaced, no loading state from the carry call
    expect(result.current.error).toBeFalsy()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.entry?.id).toBe(7)
  })

  it('on a 409 create for today, refetches entries and then carries once', async () => {
    vi.mocked(journalApi.getJournalEntries)
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([mkEntry(9, TODAY)]))
    vi.mocked(journalApi.createJournalEntry).mockRejectedValue({ type: 'about:blank', title: 'Conflict', status: 409 })
    const { wrapper } = setup()
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledWith(9, -300))
    await settle()
    expect(journalApi.createJournalEntry).toHaveBeenCalledTimes(1)
    expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(1)
  })

  it('decides "today" at create call time, so a midnight rollover while loading sends the offset', async () => {
    let resolveEntries: (v: never) => void = () => {}
    vi.mocked(journalApi.getJournalEntries).mockReturnValue(new Promise(r => { resolveEntries = r as never }) as never)
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(ok(mkEntry(3, TOMORROW)))
    const { wrapper } = setup()
    renderHook(() => useEnsureJournalEntry(TOMORROW), { wrapper })

    // Midnight passes while the entries request is still in flight.
    vi.setSystemTime(new Date(2026, 5, 11, 0, 5, 0))
    await act(async () => { resolveEntries(ok([])) })

    await waitFor(() => expect(journalApi.createJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ date: TOMORROW, timezoneOffsetMinutes: -300 })
    ))
  })

  it('invalidates task keys after creating today when the entry came back with carried tasks', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(ok({ ...mkEntry(11, TODAY), todoTaskItemIds: [4, 5] }))
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all }))
    expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all })
  })

  it('does not invalidate task keys after creating today when the entry came back empty', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(ok(mkEntry(12, TODAY)))
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    expect(spy).not.toHaveBeenCalledWith({ queryKey: taskKeys.all })
  })

  it('does not carry after creating today (server carried inline)', async () => {
    vi.mocked(journalApi.getJournalEntries)
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([mkEntry(10, TODAY)]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(ok(mkEntry(10, TODAY)))
    const { wrapper } = setup()
    const { result } = renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(result.current.entry?.id).toBe(10))
    await settle()
    expect(journalApi.createJournalEntry).toHaveBeenCalledTimes(1)
    expect(journalApi.carryForwardJournalEntry).not.toHaveBeenCalled()
  })
})

describe('useJournalNotes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls getJournalNotes with entryId and selects inner data array', async () => {
    const notes = [{ id: 1, content: 'hello', journalEntryId: 5, createdAt: '' }]
    vi.mocked(journalApi.getJournalNotes).mockResolvedValue({ data: notes, response: new Response() } as never)
    const { result } = renderHook(() => useJournalNotes(5), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(journalApi.getJournalNotes).toHaveBeenCalledWith(5)
    expect(result.current.data).toEqual(notes)
  })
})

describe('useCreateJournalNoteMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createJournalNote with entryId and content', async () => {
    vi.mocked(journalApi.createJournalNote).mockResolvedValue({ data: { id: 1, content: 'note', journalEntryId: 5, createdAt: '' }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalNotes).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useCreateJournalNoteMutation(5), { wrapper: makeWrapper() })
    act(() => { result.current.mutate('note text') })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.createJournalNote).toHaveBeenCalledWith(5, 'note text')
  })
})

describe('useUpdateJournalNoteMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls updateJournalNote with entryId, id, and content', async () => {
    vi.mocked(journalApi.updateJournalNote).mockResolvedValue({ data: { id: 3, content: 'updated', journalEntryId: 5, createdAt: '' }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalNotes).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useUpdateJournalNoteMutation(5), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 3, content: 'updated' }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.updateJournalNote).toHaveBeenCalledWith(5, 3, 'updated')
  })
})

describe('useDeleteJournalNoteMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls deleteJournalNote with entryId and noteId', async () => {
    vi.mocked(journalApi.deleteJournalNote).mockResolvedValue({ data: undefined, response: new Response() } as never)
    vi.mocked(journalApi.getJournalNotes).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useDeleteJournalNoteMutation(5), { wrapper: makeWrapper() })
    act(() => { result.current.mutate(7) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.deleteJournalNote).toHaveBeenCalledWith(5, 7)
  })
})

describe('useCreateTodoMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls postApiV1TaskItems with title and journalDate', async () => {
    vi.mocked(sdk.postApiV1TaskItems).mockResolvedValue({ data: { id: 1, title: 'Buy milk' }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useCreateTodoMutation(10, '2026-05-28'), { wrapper: makeWrapper() })
    act(() => { result.current.mutate('Buy milk') })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.postApiV1TaskItems).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ title: 'Buy milk', journalDate: '2026-05-28' }) })
    )
  })

  it('never sends projectId in the create body', async () => {
    vi.mocked(sdk.postApiV1TaskItems).mockResolvedValue({ data: { id: 1, title: 'Buy milk' }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useCreateTodoMutation(10, '2026-05-28'), { wrapper: makeWrapper() })
    act(() => { result.current.mutate('Buy milk') })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(vi.mocked(sdk.postApiV1TaskItems).mock.calls[0][0]?.body).not.toHaveProperty('projectId')
  })
})

describe('useToggleTodoMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls putApiV1TaskItemsById with done=true (status completed)', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 1, title: 'Task A', done: true }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.putApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 1 },
        body: expect.objectContaining({ status: 'completed' }),
      })
    )
  })

  it('never sends projectId in the PUT body, so toggling cannot clear a task project', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 1, title: 'Task A', done: true }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(vi.mocked(sdk.putApiV1TaskItemsById).mock.calls[0][0]?.body).not.toHaveProperty('projectId')
  })

  it('calls putApiV1TaskItemsById with done=false (status todo)', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 2 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 2, title: 'Task B', done: false }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.putApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 2 },
        body: expect.objectContaining({ status: 'todo' }),
      })
    )
  })

  it('explicit autoCompleteParentWhenChildrenDone:false overrides pref=true in HTTP body', async () => {
    const { usePrefs } = await import('@/context/usePrefs')
    vi.mocked(usePrefs).mockReturnValue({ autoCompleteParentWhenChildrenDone: true } as never)
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 3 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 3, title: 'Sub', done: true, autoCompleteParentWhenChildrenDone: false }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.putApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ autoCompleteParentWhenChildrenDone: false }),
      })
    )
  })
})

describe('useEditTodoMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls putApiV1TaskItemsById with updated title', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: { id: 3 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useEditTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 3, title: 'New title' }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.putApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 3 }, body: expect.objectContaining({ title: 'New title' }) })
    )
  })
})

describe('useRemoveTodoMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls removeJournalTodo with entryId and taskItemId', async () => {
    vi.mocked(journalApi.removeJournalTodo).mockResolvedValue({ data: undefined, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useRemoveTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate(55) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.removeJournalTodo).toHaveBeenCalledWith(10, 55)
  })
})

describe('useAddLogEntryMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createLogEntry with entryId and content', async () => {
    vi.mocked(journalApi.createLogEntry).mockResolvedValue({ data: { id: 1, content: 'did work', journalEntryId: 10, createdAt: '', linkedTaskDeleted: false }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useAddLogEntryMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ content: 'did work' }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.createLogEntry).toHaveBeenCalledWith(10, 'did work', undefined)
  })

  it('passes taskItemId to createLogEntry when provided', async () => {
    vi.mocked(journalApi.createLogEntry).mockResolvedValue({ data: { id: 2, content: 'linked work', journalEntryId: 10, createdAt: '', linkedTaskDeleted: false }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useAddLogEntryMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ content: 'linked work', taskItemId: 42 }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.createLogEntry).toHaveBeenCalledWith(10, 'linked work', 42)
  })

  it('passes taskItemId null to createLogEntry when explicitly set to null', async () => {
    vi.mocked(journalApi.createLogEntry).mockResolvedValue({ data: { id: 3, content: 'test', journalEntryId: 10, createdAt: '', linkedTaskDeleted: false }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useAddLogEntryMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ content: 'test', taskItemId: null }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.createLogEntry).toHaveBeenCalledWith(10, 'test', null)
  })
})

describe('useUpdateLogEntryMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls updateLogEntry with entryId, logId, content, and taskItemId', async () => {
    const mockUpdated = { id: 5, content: 'updated work', journalEntryId: 10, createdAt: '', linkedTaskDeleted: false, taskItemId: 7, linkedTaskTitle: 'Some Task' }
    vi.mocked(journalApi.updateLogEntry).mockResolvedValue({ data: mockUpdated } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useUpdateLogEntryMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 5, content: 'updated work', taskItemId: 7 }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.updateLogEntry).toHaveBeenCalledWith(10, 5, 'updated work', 7)
  })

  it('invalidates journalKeys.all on success', async () => {
    const mockUpdated = { id: 5, content: 'updated work', journalEntryId: 10, createdAt: '', linkedTaskDeleted: false }
    vi.mocked(journalApi.updateLogEntry).mockResolvedValue({ data: mockUpdated } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useUpdateLogEntryMutation(10), { wrapper })
    act(() => { result.current.mutate({ id: 5, content: 'updated work', taskItemId: null }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['journal'] }))
  })
})

describe('useDeleteLogEntryMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls deleteLogEntry with entryId and logId', async () => {
    vi.mocked(journalApi.deleteLogEntry).mockResolvedValue({ data: undefined, response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useDeleteLogEntryMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate(99) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(journalApi.deleteLogEntry).toHaveBeenCalledWith(10, 99)
  })
})

describe('openTodoCount', () => {
  it('returns 0 for empty array', () => {
    expect(openTodoCount([])).toBe(0)
  })

  it('counts only non-Completed, non-isComplete items', () => {
    const todos = [
      { id: 1, title: 'A', status: 'Todo', isComplete: false },
      { id: 2, title: 'B', status: 'Todo', isComplete: false },
      { id: 3, title: 'C', status: 'Completed', isComplete: false },
    ]
    expect(openTodoCount(todos as never)).toBe(2)
  })

  it('item with status=Todo but isComplete=true is still excluded', () => {
    const todos = [
      { id: 1, title: 'A', status: 'Todo', isComplete: true },
      { id: 2, title: 'B', status: 'Todo', isComplete: false },
    ]
    expect(openTodoCount(todos as never)).toBe(1)
  })

  it('PascalCase "Completed" is excluded; lowercase "completed" is not excluded', () => {
    const todos = [
      { id: 1, title: 'A', status: 'Completed', isComplete: false },
      { id: 2, title: 'B', status: 'completed', isComplete: false },
    ]
    // 'Completed' excluded, 'completed' counted (open)
    expect(openTodoCount(todos as never)).toBe(1)
  })
})

describe('yesterdayOf', () => {
  it('returns the day before for a mid-month date', () => {
    expect(yesterdayOf('2026-05-28')).toBe('2026-05-27')
  })

  it('crosses month boundary correctly', () => {
    expect(yesterdayOf('2026-06-01')).toBe('2026-05-31')
  })
})
