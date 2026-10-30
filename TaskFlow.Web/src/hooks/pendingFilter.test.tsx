import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { makeProviders } from '@/test/renderWithToast'
import { useTasksQuery, useTaskQuery, hidePendingTasks } from './useTasks'
import { useNotesQuery } from './useNotes'
import { useProjectTasksQuery } from './useProjects'
import { useJournalTodos } from './useJournal'
import { pendingKey, useUndoableDelete } from './useUndoableDelete'

vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  getTaskV1: vi.fn(),
  getApiV1TaskItemsByTaskIdNotes: vi.fn(),
}))
vi.mock('@/api/projects', () => ({ getProjectTasks: vi.fn() }))
vi.mock('@/api/journal', () => ({ getJournalTodos: vi.fn() }))
vi.mock('@/context/usePrefs', () => ({ usePrefs: vi.fn() }))

import * as sdk from '@/api/client/sdk.gen'
import { getProjectTasks } from '@/api/projects'
import { getJournalTodos } from '@/api/journal'

const parent = { id: 1, title: 'Parent', parentTaskItemId: null, childTaskCount: 2, status: 'Todo' }
const childA = { id: 2, title: 'A', parentTaskItemId: 1, childTaskCount: 0, status: 'Todo' }
const childB = { id: 3, title: 'B', parentTaskItemId: 1, childTaskCount: 0, status: 'Completed' }
const other = { id: 4, title: 'Other', parentTaskItemId: null, childTaskCount: 0, status: 'Todo' }

/** Runs `useHook` next to a delete trigger sharing one provider. */
function setup<T>(useHook: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = renderHook(
    () => ({ value: useHook(), del: useUndoableDelete() }),
    { wrapper: makeProviders(qc) },
  )
  const hide = (key: string) =>
    act(() => rendered.result.current.del.requestDelete({
      key,
      message: 'm',
      errorMessage: 'e',
      commit: () => Promise.resolve({}),
      invalidate: () => undefined,
    }))
  return { ...rendered, qc, hide }
}

describe('pending delete filter on read hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sdk.getApiV1TaskItems).mockResolvedValue({ data: [parent, childA, childB, other] } as never)
    vi.mocked(sdk.getTaskV1).mockResolvedValue({ data: { ...parent } } as never)
  })

  afterEach(() => vi.useRealTimers())

  it('useTasksQuery hides a pending task and lowers the parent childTaskCount (AC11, AC13)', async () => {
    const { result, hide } = setup(() => useTasksQuery())
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    expect((result.current.value.data?.data as unknown[]).length).toBe(4)

    hide(pendingKey('task', 2))
    const list = result.current.value.data?.data as Array<{ id: number; childTaskCount: number }>
    expect(list.map(t => t.id)).toEqual([1, 3, 4])
    expect(list.find(t => t.id === 1)?.childTaskCount).toBe(1)
  })

  it('does not change the cached data, only the read result', async () => {
    const { result, hide, qc } = setup(() => useTasksQuery())
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    hide(pendingKey('task', 2))
    const cached = qc.getQueryData<{ data: unknown[] }>(['tasks'])
    expect(cached?.data).toHaveLength(4)
  })

  it('applyOptimisticTaskUpdate writes to the raw cache and the filter still applies on read', async () => {
    const { result, hide, qc } = setup(() => useTasksQuery())
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    // Reading data first subscribes the hook to data changes.
    expect(result.current.value.data).toBeDefined()
    hide(pendingKey('task', 4))
    act(() => {
      qc.setQueryData(['tasks'], (old: { data: Array<{ id: number; title: string }> }) => ({
        ...old,
        data: old.data.map(t => (t.id === 1 ? { ...t, title: 'Renamed' } : t)),
      }))
    })
    await waitFor(() => {
      const list = result.current.value.data?.data as Array<{ id: number; title: string }>
      expect(list.find(t => t.id === 1)?.title).toBe('Renamed')
      expect(list.some(t => t.id === 4)).toBe(false)
    })
  })

  it('useTaskQuery returns a not-found result for a pending id (AC12)', async () => {
    const { result, hide } = setup(() => useTaskQuery(1))
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    expect(result.current.value.data?.data).toBeDefined()
    hide(pendingKey('task', 1))
    expect(result.current.value.data?.data).toBeUndefined()
  })

  it('useTaskQuery lowers its own childTaskCount by pending children', async () => {
    const { result, hide, qc } = setup(() => useTaskQuery(1))
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    qc.setQueryData(['tasks'], { data: [parent, childA, childB] })
    hide(pendingKey('task', 2))
    expect((result.current.value.data?.data as { childTaskCount: number }).childTaskCount).toBe(1)
    hide(pendingKey('task', 3))
    expect((result.current.value.data?.data as { childTaskCount: number }).childTaskCount).toBe(0)
  })

  it('useNotesQuery hides tasknote:<id> but not task:<id> or a journal note with the same id (AC11)', async () => {
    vi.mocked(sdk.getApiV1TaskItemsByTaskIdNotes).mockResolvedValue({ data: [{ id: 5, content: 'a' }, { id: 6, content: 'b' }] } as never)
    const { result, hide } = setup(() => useNotesQuery(1))
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    hide('note:5')
    hide(pendingKey('task', 5))
    expect((result.current.value.data?.data as unknown[]).length).toBe(2)
    hide(pendingKey('tasknote', 5))
    expect((result.current.value.data?.data as Array<{ id: number }>).map(n => n.id)).toEqual([6])
  })

  it('useProjectTasksQuery hides pending tasks (AC13)', async () => {
    vi.mocked(getProjectTasks).mockResolvedValue({ data: [{ id: 1, title: 'x' }, { id: 2, title: 'y' }] } as never)
    const { result, hide } = setup(() => useProjectTasksQuery(9))
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    hide(pendingKey('task', 1))
    expect((result.current.value.data?.data as Array<{ id: number }>).map(t => t.id)).toEqual([2])
  })

  it('useJournalTodos hides pending tasks and pending subtasks, but not journal todo keys (AC13)', async () => {
    vi.mocked(getJournalTodos).mockResolvedValue({
      data: [
        { id: 1, title: 'P', children: [{ id: 2, title: 'c1' }, { id: 3, title: 'c2' }] },
        { id: 4, title: 'Q', children: [] },
      ],
    } as never)
    const { result, hide } = setup(() => useJournalTodos(1))
    await waitFor(() => expect(result.current.value.isSuccess).toBe(true))
    hide('todo:1:4')
    expect((result.current.value.data?.data as unknown[]).length).toBe(2)
    hide(pendingKey('task', 2))
    const todos = result.current.value.data?.data as Array<{ id: number; children: Array<{ id: number }> }>
    expect(todos[0].children.map(c => c.id)).toEqual([3])
    hide(pendingKey('task', 4))
    expect((result.current.value.data?.data as Array<{ id: number }>).map(t => t.id)).toEqual([1])
  })
})

describe('hidePendingTasks', () => {
  it('returns the same list when nothing is pending', () => {
    const list = [parent]
    expect(hidePendingTasks(list, new Set())).toBe(list)
  })

  it('never lets childTaskCount go negative', () => {
    const list = [{ ...parent, childTaskCount: 0 }, childA]
    const out = hidePendingTasks(list, new Set(['task:2']))
    expect(out).toHaveLength(1)
    expect(out[0].childTaskCount).toBe(0)
  })
})
