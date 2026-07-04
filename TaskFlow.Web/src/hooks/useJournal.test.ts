import { describe, it, expect, vi, beforeEach } from 'vitest'
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
} from './useJournal'

vi.mock('@/api/journal', () => ({
  getJournalEntries: vi.fn(),
  createJournalEntry: vi.fn(),
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
