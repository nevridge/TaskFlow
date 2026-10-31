import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useToggleTodoMutation, journalKeys } from './useJournal'
import type { TaskItemResponseDto } from '@/api/journal'

vi.mock('@/api/client/sdk.gen', () => ({
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  patchApiV1TaskItemsById: vi.fn(),
}))
vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(() => ({ autoCompleteParentWhenChildrenDone: false })),
}))

import * as sdk from '@/api/client/sdk.gen'

const NOW = new Date('2026-06-05T15:00:00Z')
const PAST_ID = 10
const TODAY_ID = 11
const task = (id: number, extra: Partial<TaskItemResponseDto> = {}) =>
  ({ id, title: `T${id}`, status: 'Todo', priority: 'low', ...extra }) as TaskItemResponseDto

function setup(viewed: TaskItemResponseDto[], today: TaskItemResponseDto[] | undefined, viewedDay = '2026-06-02') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const entry = (id: number, date: string) => ({ id, date, title: date, createdAt: date, todoTaskItemIds: [], logEntries: [], movedCount: 0, movedTaskItemIds: [] })
  qc.setQueryData(journalKeys.all, { data: [entry(PAST_ID, viewedDay), entry(TODAY_ID, '2026-06-05')] })
  qc.setQueryData(journalKeys.todos(PAST_ID), { data: viewed })
  if (today) qc.setQueryData(journalKeys.todos(TODAY_ID), { data: today })
  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  const hook = renderHook(() => useToggleTodoMutation(PAST_ID, viewedDay), { wrapper })
  const list = (id: number) => (qc.getQueryData(journalKeys.todos(id)) as { data: TaskItemResponseDto[] } | undefined)?.data
  return { qc, hook, list }
}

describe('useToggleTodoMutation completion-day move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('moves a root completed from a past day into the completed tier of today before the server answers', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(new Promise(() => {}) as never)
    const { hook, list } = setup([task(1), task(2)], [task(3)])
    act(() => hook.result.current.mutate({ id: 1, done: true }))
    await waitFor(() => expect(list(PAST_ID)?.map(t => t.id)).toEqual([2]))
    const todayList = list(TODAY_ID)!
    expect(todayList.map(t => t.id)).toEqual([3, 1])
    expect(todayList[1].status).toBe('Completed')
    expect(todayList[1].completedAt).toBe(NOW.toISOString())
  })

  it('keeps the PATCH body keys unchanged', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
    const { hook } = setup([task(1)], [])
    await act(async () => { await hook.result.current.mutateAsync({ id: 1, done: true }) })
    const call = vi.mocked(sdk.patchApiV1TaskItemsById).mock.calls[0][0] as { body: object }
    expect(Object.keys(call.body).sort()).toEqual(['autoCompleteParentWhenChildrenDone', 'status', 'timezoneOffsetMinutes'])
  })

  it('restores both caches when the server rejects', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockRejectedValue({ code: 'X' })
    const { hook, list } = setup([task(1), task(2)], [task(3)])
    await act(async () => { await hook.result.current.mutateAsync({ id: 1, done: true }).catch(() => {}) })
    expect(list(PAST_ID)?.map(t => [t.id, t.status])).toEqual([[1, 'Todo'], [2, 'Todo']])
    expect(list(TODAY_ID)?.map(t => t.id)).toEqual([3])
  })

  it('only updates in place when completing on today', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(new Promise(() => {}) as never)
    const { hook, list } = setup([task(1)], undefined, '2026-06-05')
    act(() => hook.result.current.mutate({ id: 1, done: true }))
    await waitFor(() => expect(list(PAST_ID)?.[0].status).toBe('Completed'))
    expect(list(PAST_ID)?.[0].completedAt).toBe(NOW.toISOString())
  })

  it('completes a child inside its parent without touching the parent', async () => {
    vi.mocked(sdk.patchApiV1TaskItemsById).mockReturnValue(new Promise(() => {}) as never)
    const parent = task(1, { children: [task(5, { parentTaskItemId: 1 }), task(6, { parentTaskItemId: 1 })] })
    const { hook, list } = setup([parent], [])
    act(() => hook.result.current.mutate({ id: 5, done: true }))
    await waitFor(() => expect(list(PAST_ID)?.[0].children?.[0].status).toBe('Completed'))
    expect(list(PAST_ID)?.[0].status).toBe('Todo')
    expect(list(PAST_ID)?.[0].children?.[1].status).toBe('Todo')
    expect(list(PAST_ID)?.[0].children?.[0].completedAt).toBe(NOW.toISOString())
  })
})
