import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  journalKeys,
  openTodoCount,
  useToggleTodoMutation,
  useUnblockTodoMutation,
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
const STARTED = '2026-05-01T08:00:00Z'

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
  const promise = new Promise(res => { resolve = res })
  return { promise, resolve }
}

describe('In Progress journal todos', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts In Progress todos as open', () => {
    expect(openTodoCount([todo({ id: 1, status: 'InProgress' }), todo({ id: 2, status: 'Completed' })])).toBe(1)
  })

  it('ticking an InProgress todo completes it optimistically and keeps startedAt', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const qc = seeded([todo({ status: 'InProgress', startedAt: STARTED })])
    const { result } = renderHook(() => useToggleTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    act(() => { result.current.mutate({ id: 1, done: true }) })
    await waitFor(() => expect(rows(qc)[0].status).toBe('Completed'))
    expect(rows(qc)[0].startedAt).toBe(STARTED)
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toMatchObject({ status: 'completed' })
    await act(async () => { d.resolve({ data: {} }); await d.promise })
  })

  it('rolls the tick back on failure without losing startedAt', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockRejectedValue({ message: 'boom' })
    const qc = seeded([todo({ status: 'InProgress', startedAt: STARTED })])
    const { result } = renderHook(() => useToggleTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 1, done: true }).catch(() => {}) })
    expect(rows(qc)[0]).toMatchObject({ status: 'InProgress', startedAt: STARTED })
  })

  it('unticking a completed todo sends todo and keeps startedAt in the cache', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const qc = seeded([todo({ status: 'Completed', startedAt: STARTED })])
    const { result } = renderHook(() => useToggleTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    await act(async () => { await result.current.mutateAsync({ id: 1, done: false }) })
    expect(vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0]?.body).toMatchObject({ status: 'todo' })
    expect(rows(qc)[0].startedAt).toBe(STARTED)
  })

  it('unblocking a task that was In Progress shows InProgress, not Todo, and keeps startedAt', async () => {
    const d = deferred()
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(d.promise as never)
    const qc = seeded([
      todo({ status: 'Blocked', previousStatus: 'InProgress', blockedReason: 'Waiting', startedAt: STARTED }),
    ])
    const { result } = renderHook(() => useUnblockTodoMutation(ENTRY), { wrapper: wrapperFor(qc) })
    act(() => { result.current.mutate({ id: 1 }) })
    await waitFor(() => expect(rows(qc)[0].status).toBe('InProgress'))
    expect(rows(qc)[0]).toMatchObject({ startedAt: STARTED, blockedReason: null, previousStatus: null })
    await act(async () => { d.resolve({ data: {} }); await d.promise })
  })
})
