import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  journalKeys,
  openTodoCount,
  blockedTodoCount,
  useBlockTodoMutation,
  useUnblockTodoMutation,
  useEditBlockedReasonTodoMutation,
  useToggleTodoMutation,
  useEditTodoMutation,
} from './useJournal'
import type { TaskItemResponseDto } from '@/api/journal'

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

import * as sdk from '@/api/client/sdk.gen'

const ENTRY = 10

function todo(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'T', status: 'Todo', ...overrides } as TaskItemResponseDto
}

function seeded(rows: TaskItemResponseDto[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(journalKeys.todos(ENTRY), { data: rows })
  return qc
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
}

const rows = (qc: QueryClient) =>
  (qc.getQueryData(journalKeys.todos(ENTRY)) as { data: TaskItemResponseDto[] }).data

function deferred() {
  let resolve!: (v: unknown) => void
  let reject!: (e: unknown) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const blocked = todo({
  id: 2,
  status: 'Blocked',
  blockedReason: 'Waiting',
  blockedAt: '2026-05-01T00:00:00Z',
  previousStatus: 'Todo',
})

describe('todo counts with Blocked', () => {
  const list = [todo({ id: 1 }), blocked, todo({ id: 3, status: 'Completed' })]

  it('openTodoCount counts Blocked as open', () => {
    expect(openTodoCount(list)).toBe(2)
  })

  it('blockedTodoCount counts only Blocked rows', () => {
    expect(blockedTodoCount(list)).toBe(1)
    expect(blockedTodoCount([todo({})])).toBe(0)
  })
})

describe('journal block / unblock mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('block is optimistic on the journal todos, including subtasks, and PATCHes status blocked', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const child = todo({ id: 5, parentTaskItemId: 1 })
    const qc = seeded([todo({ id: 1, children: [child] })])
    const { result } = renderHook(() => useBlockTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    act(() => { result.current.mutate({ id: 5, reason: 'Waiting' }) })
    await waitFor(() => expect(rows(qc)[0].children?.[0].status).toBe('Blocked'))
    expect(rows(qc)[0].children?.[0]).toMatchObject({ blockedReason: 'Waiting', previousStatus: 'Todo' })
    expect(rows(qc)[0].status).toBe('Todo')
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]).toMatchObject({
      path: { id: 5 },
      body: { status: 'blocked', blockedReason: 'Waiting' },
    })
    await act(async () => { d.resolve({ data: {} }); await d.promise })
  })

  it('a failed block rolls the journal todos back', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockRejectedValue({ code: 'TASK_BLOCK_DRAFT_NOT_ALLOWED' })
    const qc = seeded([todo({ id: 1 })])
    const { result } = renderHook(() => useBlockTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 1, reason: 'x' }).catch(() => {}) })
    expect(rows(qc)[0]).toMatchObject({ status: 'Todo' })
    expect(rows(qc)[0].blockedReason).toBeUndefined()
  })

  it('unblock restores the previous status before the server responds and PATCHes status todo', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const qc = seeded([blocked])
    const { result } = renderHook(() => useUnblockTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    act(() => { result.current.mutate({ id: 2 }) })
    await waitFor(() => expect(rows(qc)[0].status).toBe('Todo'))
    expect(rows(qc)[0]).toMatchObject({ blockedReason: null, blockedAt: null, previousStatus: null })
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toEqual({ status: 'todo' })
    await act(async () => { d.resolve({ data: {} }); await d.promise })
  })

  it('a failed unblock puts the Blocked row back with its reason', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockRejectedValue({ message: 'boom' })
    const qc = seeded([blocked])
    const { result } = renderHook(() => useUnblockTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 2 }).catch(() => {}) })
    expect(rows(qc)[0]).toMatchObject({ status: 'Blocked', blockedReason: 'Waiting', previousStatus: 'Todo' })
  })

  it('editing the reason sends only blockedReason', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const qc = seeded([blocked])
    const { result } = renderHook(() => useEditBlockedReasonTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 2, reason: 'Other' }) })
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toEqual({ blockedReason: 'Other' })
  })
})

describe('useToggleTodoMutation on Blocked rows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('completing a Blocked row clears reason and blocked fields optimistically', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const qc = seeded([blocked])
    const { result } = renderHook(() => useToggleTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    act(() => { result.current.mutate({ id: 2, done: true }) })
    await waitFor(() => expect(rows(qc)[0].status).toBe('Completed'))
    expect(rows(qc)[0]).toMatchObject({ blockedReason: null, blockedAt: null, previousStatus: null })
    await act(async () => { d.resolve({ data: {} }); await d.promise })
  })

  it('rolls back the optimistic completion when the request fails', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockRejectedValue({ code: 'TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN' })
    const qc = seeded([blocked])
    const { result } = renderHook(() => useToggleTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 2, done: true }).catch(() => {}) })
    expect(rows(qc)[0]).toMatchObject({ status: 'Blocked', blockedReason: 'Waiting' })
  })

  it('does not touch non-Blocked rows', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const qc = seeded([todo({ id: 1 })])
    const { result } = renderHook(() => useToggleTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    act(() => { result.current.mutate({ id: 1, done: true }) })
    expect(rows(qc)[0].status).toBe('Todo')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useEditTodoMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('never sends blockedReason, so a rename keeps the stored reason', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const { result } = renderHook(() => useEditTodoMutation(ENTRY), { wrapper: wrapperFor(seeded([blocked])) })
    await act(async () => { await result.current.mutateAsync({ id: 2, title: 'Renamed' }) })
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toEqual({ title: 'Renamed' })
  })
})
