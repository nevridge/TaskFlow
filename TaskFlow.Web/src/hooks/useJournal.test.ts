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
  patchApiV1TaskItemsById: vi.fn(),
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
    const entry = { id: 1, date: '2026-05-28', title: 'May 28, 2026', todoTaskItemIds: [], logEntries: [], createdAt: '', summary: null, updatedAt: null, movedCount: 0, movedTaskItemIds: [] }
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [entry], response: new Response() } as never)
    const { result } = renderHook(() => useEnsureJournalEntry('2026-05-28'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.entry).toEqual(entry)
    expect(journalApi.createJournalEntry).not.toHaveBeenCalled()
  })

  it('calls createJournalEntry when no matching entry exists', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue({ data: { id: 2, date: '2026-05-28', title: 'May 28, 2026', todoTaskItemIds: [], logEntries: [], createdAt: '', movedCount: 0, movedTaskItemIds: [] }, response: new Response() } as never)
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
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue({ data: { id: 3, date: '2026-05-28', title: 'May 28, 2026', todoTaskItemIds: [], logEntries: [], createdAt: '', movedCount: 0, movedTaskItemIds: [] }, response: new Response() } as never)
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
    ({ id, date, title: date, todoTaskItemIds: [], logEntries: [], createdAt: '', summary: null, updatedAt: null, movedCount: 0, movedTaskItemIds: [] as number[] })
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
    vi.mocked(journalApi.carryForwardJournalEntry).mockResolvedValue(ok({ movedCount: 0, movedTaskItemIds: [] }))
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
    vi.mocked(journalApi.carryForwardJournalEntry).mockResolvedValue(ok({ movedCount: 3, movedTaskItemIds: [1, 2, 3] }))
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

  it('invalidates task keys after creating today when tasks were moved (movedCount > 0)', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(
      ok({ ...mkEntry(11, TODAY), todoTaskItemIds: [4, 5], movedCount: 2, movedTaskItemIds: [4, 5] }),
    )
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all }))
    expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all })
    await settle()
    expect(journalApi.carryForwardJournalEntry).not.toHaveBeenCalled()
  })

  it('invalidates task keys after creating today even when movedCount is 0 (lost carry-forward race)', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(
      ok({ ...mkEntry(11, TODAY), todoTaskItemIds: [4, 5], movedCount: 0, movedTaskItemIds: [] }),
    )
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all })
  })

  it('does not invalidate task keys for a non-today create even when movedCount > 0', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(
      ok({ ...mkEntry(13, TOMORROW), movedCount: 2, movedTaskItemIds: [4, 5] }),
    )
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TOMORROW), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    expect(spy).not.toHaveBeenCalledWith({ queryKey: taskKeys.all })
    expect(vi.mocked(journalApi.createJournalEntry).mock.calls[0][0]).not.toHaveProperty('timezoneOffsetMinutes')
  })

  it('does not throw and invalidates task keys when the create response omits movedCount', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(
      ok({ id: 14, date: TODAY, title: TODAY, todoTaskItemIds: [], logEntries: [], createdAt: '' }),
    )
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all })
    expect(result.current.error).toBeFalsy()
  })

  it('coerces a string movedCount from the generated client types', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(
      ok({ ...mkEntry(15, TODAY), movedCount: '3', movedTaskItemIds: [1, 2, 3] }),
    )
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all }))
  })

  it('on a 409 create, only journal keys are invalidated, then the session carry-forward invalidates task keys when it moves tasks', async () => {
    vi.mocked(journalApi.getJournalEntries)
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([mkEntry(9, TODAY)]))
    vi.mocked(journalApi.createJournalEntry).mockRejectedValue({ type: 'about:blank', title: 'Conflict', status: 409 })
    vi.mocked(journalApi.carryForwardJournalEntry).mockResolvedValue(ok({ movedCount: 2, movedTaskItemIds: [4, 5] }))
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(journalApi.createJournalEntry).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    // Task keys are only invalidated once the carry-forward reports moved tasks
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledWith(9, -300))
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all }))
  })

  it('on a 409 create, task keys are not invalidated until the carry-forward response arrives', async () => {
    vi.mocked(journalApi.getJournalEntries)
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([mkEntry(9, TODAY)]))
    vi.mocked(journalApi.createJournalEntry).mockRejectedValue({ type: 'about:blank', title: 'Conflict', status: 409 })
    let resolveCarry: (v: never) => void = () => {}
    vi.mocked(journalApi.carryForwardJournalEntry).mockReturnValue(new Promise(r => { resolveCarry = r as never }) as never)
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledWith(9, -300))
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    // Carry-forward is in flight: the 409 path itself must not have touched task keys
    expect(spy).not.toHaveBeenCalledWith({ queryKey: taskKeys.all })

    await act(async () => { resolveCarry(ok({ movedCount: 2, movedTaskItemIds: [4, 5] })) })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all }))
  })

  it('an existing today entry with pre-existing todos takes no create path and leaves task keys alone when carry-forward moves nothing', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([{ ...mkEntry(7, TODAY), todoTaskItemIds: [21, 22] }]))
    vi.mocked(journalApi.carryForwardJournalEntry).mockResolvedValue(ok({ movedCount: 0, movedTaskItemIds: [] }))
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledWith(7, -300))
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    expect(journalApi.createJournalEntry).not.toHaveBeenCalled()
    expect(journalApi.carryForwardJournalEntry).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalledWith({ queryKey: taskKeys.all })
  })

  it('invalidates task keys after creating today even when the entry came back empty', async () => {
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue(ok([]))
    vi.mocked(journalApi.createJournalEntry).mockResolvedValue(ok(mkEntry(12, TODAY)))
    const { queryClient, wrapper } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useEnsureJournalEntry(TODAY), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: journalKeys.all }))
    await settle()
    expect(spy).toHaveBeenCalledWith({ queryKey: taskKeys.all })
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

  it('calls patchApiV1TaskItemsById with done=true (status completed)', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 1, done: true }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.patchApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 1 },
        body: expect.objectContaining({ status: 'completed' }),
      })
    )
  })

  it('sends a PATCH body with exactly status, autoCompleteParentWhenChildrenDone and timezoneOffsetMinutes', async () => {
    const { usePrefs } = await import('@/context/usePrefs')
    vi.mocked(usePrefs).mockReturnValue({ autoCompleteParentWhenChildrenDone: false } as never)
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 1, done: true }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    const body = vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['autoCompleteParentWhenChildrenDone', 'status', 'timezoneOffsetMinutes'])
    for (const key of ['title', 'parentTaskItemId', 'description', 'dueDate', 'isComplete', 'projectId']) {
      expect(body).not.toHaveProperty(key)
    }
    expect(sdk.putApiV1TaskItemsById).not.toHaveBeenCalled()
  })

  it('calls patchApiV1TaskItemsById with done=false (status todo)', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: { id: 2 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 2, done: false }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.patchApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 2 },
        body: expect.objectContaining({ status: 'todo' }),
      })
    )
  })

  it('explicit autoCompleteParentWhenChildrenDone:false overrides pref=true in HTTP body', async () => {
    const { usePrefs } = await import('@/context/usePrefs')
    vi.mocked(usePrefs).mockReturnValue({ autoCompleteParentWhenChildrenDone: true } as never)
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: { id: 3 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 3, done: true, autoCompleteParentWhenChildrenDone: false }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.patchApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ autoCompleteParentWhenChildrenDone: false }),
      })
    )
  })
})

describe('useEditTodoMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls patchApiV1TaskItemsById with updated title', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: { id: 3 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useEditTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 3, title: 'New title' }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.patchApiV1TaskItemsById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 3 }, body: expect.objectContaining({ title: 'New title' }) })
    )
  })

  it('sends a PATCH body of exactly { title }, so a rename cannot touch any other field', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: { id: 3 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useEditTodoMutation(10), { wrapper: makeWrapper() })
    act(() => { result.current.mutate({ id: 3, title: 'New title' }) })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toEqual({ title: 'New title' })
    expect(sdk.putApiV1TaskItemsById).not.toHaveBeenCalled()
  })
})

describe('todo PATCH mutations timezone offset', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('toggle sends the current timezoneOffsetMinutes on every call', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: { id: 1 }, response: new Response() } as never)
    vi.mocked(journalApi.getJournalTodos).mockResolvedValue({ data: [], response: new Response() } as never)
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset')
    const { result } = renderHook(() => useToggleTodoMutation(10), { wrapper: makeWrapper() })

    spy.mockReturnValue(300)
    await act(async () => { await result.current.mutateAsync({ id: 1, done: false }) })
    spy.mockReturnValue(480)
    await act(async () => { await result.current.mutateAsync({ id: 1, done: false }) })

    const calls = vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls
    expect(calls[0][0]?.body).toEqual(expect.objectContaining({ timezoneOffsetMinutes: -300 }))
    expect(calls[1][0]?.body).toEqual(expect.objectContaining({ timezoneOffsetMinutes: -480 }))
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

  describe('optimistic cache patch', () => {
    const logs = [
      { id: 5, content: 'original', journalEntryId: 10, createdAt: '', linkedTaskDeleted: true, taskItemId: 3, linkedTaskTitle: 'Old task' },
      { id: 6, content: 'untouched', journalEntryId: 10, createdAt: '', linkedTaskDeleted: false },
    ]
    const entries = [
      { id: 10, title: 't', date: '2026-05-28', createdAt: '', todoTaskItemIds: [], logEntries: logs, movedCount: 0, movedTaskItemIds: [] },
      { id: 11, title: 'other', date: '2026-05-27', createdAt: '', todoTaskItemIds: [], logEntries: [{ ...logs[0] }], movedCount: 0, movedTaskItemIds: [] },
    ]

    function setup() {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      queryClient.setQueryData(journalKeys.all, { data: entries })
      // A sibling query under the same prefix with a different shape must not be touched.
      queryClient.setQueryData(journalKeys.notes(10), { data: [{ id: 10, content: 'note' }] })
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children)
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      return { queryClient, wrapper, invalidateSpy }
    }

    const cachedLog = (qc: QueryClient, logId: number, entryId = 10) =>
      (qc.getQueryData(journalKeys.all) as { data: typeof entries }).data
        .find(e => e.id === entryId)!.logEntries.find(l => l.id === logId)!

    function deferred() {
      let resolve!: (v: unknown) => void
      let reject!: (e: unknown) => void
      const promise = new Promise((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }

    it('patches the content and taskItemId in the cache before the request settles', async () => {
      const { queryClient, wrapper } = setup()
      const d = deferred()
      vi.mocked(journalApi.updateLogEntry).mockReturnValue(d.promise as never)
      const { result } = renderHook(() => useUpdateLogEntryMutation(10), { wrapper })
      act(() => { result.current.mutate({ id: 5, content: 'edited', taskItemId: 8 }) })
      await waitFor(() => expect(cachedLog(queryClient, 5).content).toBe('edited'))
      const log = cachedLog(queryClient, 5)
      expect(log.taskItemId).toBe(8)
      // A relink clears the deleted flag and leaves the chip text to the refetch.
      expect(log.linkedTaskDeleted).toBe(false)
      expect(log.linkedTaskTitle).toBe('Old task')
      expect(cachedLog(queryClient, 6).content).toBe('untouched')
      expect(cachedLog(queryClient, 5, 11).content).toBe('original')
      expect(queryClient.getQueryData(journalKeys.notes(10))).toEqual({ data: [{ id: 10, content: 'note' }] })
      d.resolve({ data: log })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })

    it('clears the chip title when relinked to None', async () => {
      const { queryClient, wrapper } = setup()
      const d = deferred()
      vi.mocked(journalApi.updateLogEntry).mockReturnValue(d.promise as never)
      const { result } = renderHook(() => useUpdateLogEntryMutation(10), { wrapper })
      act(() => { result.current.mutate({ id: 5, content: 'original', taskItemId: null }) })
      await waitFor(() => expect(cachedLog(queryClient, 5).taskItemId).toBeNull())
      expect(cachedLog(queryClient, 5).linkedTaskTitle).toBeNull()
      d.resolve({ data: {} })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })

    it('rolls back on error', async () => {
      const { queryClient, wrapper } = setup()
      vi.mocked(journalApi.updateLogEntry).mockRejectedValue(new Error('boom'))
      vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: entries, response: new Response() } as never)
      const { result } = renderHook(() => useUpdateLogEntryMutation(10), { wrapper })
      act(() => { result.current.mutate({ id: 5, content: 'edited', taskItemId: 8 }) })
      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(cachedLog(queryClient, 5).content).toBe('original')
      expect(cachedLog(queryClient, 5).taskItemId).toBe(3)
    })

    it('invalidates journalKeys.all on settle', async () => {
      const { wrapper, invalidateSpy } = setup()
      vi.mocked(journalApi.updateLogEntry).mockResolvedValue({ data: {} } as never)
      vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: entries, response: new Response() } as never)
      const { result } = renderHook(() => useUpdateLogEntryMutation(10), { wrapper })
      act(() => { result.current.mutate({ id: 5, content: 'edited', taskItemId: null }) })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['journal'] }))
    })

    it('does not invalidate while a second update is in flight, and keeps its optimistic value', async () => {
      const { queryClient, wrapper, invalidateSpy } = setup()
      const first = deferred()
      const second = deferred()
      vi.mocked(journalApi.updateLogEntry)
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never)
      vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: entries, response: new Response() } as never)
      const { result } = renderHook(
        () => ({ a: useUpdateLogEntryMutation(10), b: useUpdateLogEntryMutation(10) }),
        { wrapper },
      )
      act(() => { result.current.a.mutate({ id: 5, content: 'first', taskItemId: 3 }) })
      await waitFor(() => expect(cachedLog(queryClient, 5).content).toBe('first'))
      act(() => { result.current.b.mutate({ id: 5, content: 'second', taskItemId: 3 }) })
      await waitFor(() => expect(cachedLog(queryClient, 5).content).toBe('second'))

      first.resolve({ data: {} })
      await waitFor(() => expect(result.current.a.isSuccess).toBe(true))
      expect(invalidateSpy).not.toHaveBeenCalled()
      expect(cachedLog(queryClient, 5).content).toBe('second')

      second.resolve({ data: {} })
      await waitFor(() => expect(result.current.b.isSuccess).toBe(true))
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['journal'] }))
    })

    it('a failed second update rolls back to the first update value, not the original', async () => {
      const { queryClient, wrapper } = setup()
      const first = deferred()
      const second = deferred()
      vi.mocked(journalApi.updateLogEntry)
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never)
      vi.mocked(journalApi.getJournalEntries).mockResolvedValue({ data: entries, response: new Response() } as never)
      const { result } = renderHook(
        () => ({ a: useUpdateLogEntryMutation(10), b: useUpdateLogEntryMutation(10) }),
        { wrapper },
      )
      act(() => { result.current.a.mutate({ id: 5, content: 'first', taskItemId: 3 }) })
      await waitFor(() => expect(cachedLog(queryClient, 5).content).toBe('first'))
      act(() => { result.current.b.mutate({ id: 5, content: 'second', taskItemId: 3 }) })
      await waitFor(() => expect(cachedLog(queryClient, 5).content).toBe('second'))

      second.reject(new Error('boom'))
      await waitFor(() => expect(result.current.b.isError).toBe(true))
      expect(cachedLog(queryClient, 5).content).toBe('first')
      first.resolve({ data: {} })
      await waitFor(() => expect(result.current.a.isSuccess).toBe(true))
    })
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

  it('counts only items whose status is not Completed', () => {
    const todos = [
      { id: 1, title: 'A', status: 'Todo' },
      { id: 2, title: 'B', status: 'Draft' },
      { id: 3, title: 'C', status: 'Completed' },
    ]
    expect(openTodoCount(todos as never)).toBe(2)
  })

  it('a Todo item is open and a Completed item is closed, decided by status alone', () => {
    const todos = [
      { id: 1, title: 'A', status: 'Todo' },
      { id: 2, title: 'B', status: 'Completed' },
    ]
    expect(openTodoCount(todos as never)).toBe(1)
  })

  it('PascalCase "Completed" is excluded; lowercase "completed" is not excluded', () => {
    const todos = [
      { id: 1, title: 'A', status: 'Completed' },
      { id: 2, title: 'B', status: 'completed' },
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
