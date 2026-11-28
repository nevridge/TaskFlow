import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

// Uses the REAL usePatchTaskMutation and mocks only the SDK, behaving like the generated client:
// an HTTP error rejects only when throwOnError is set, otherwise it resolves with { error }.
vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  getTaskV1: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
  patchApiV1TaskItemsById: vi.fn(),
}))

vi.mock('@/api/journal', () => ({
  removeJournalTodo: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'
import { removeJournalTodo } from '@/api/journal'
import { journalKeys } from '@/hooks/journalKeys'
import { taskKeys } from '@/hooks/useTasks'
import { getTaskMutationErrorMessage, getTaskPlanSaveErrorMessage } from '@/lib/task-errors'
import { useSaveTaskWithProject } from './useSaveTaskWithProject'

function setup(getError: (e: unknown) => string = getTaskMutationErrorMessage, qc = new QueryClient()) {
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  const result = renderHook(() => useSaveTaskWithProject(getError), { wrapper }).result
  return {
    qc,
    get current() { return result.current },
    invalidatedKeys: () => invalidate.mock.calls.map(c => c[0]?.queryKey),
  }
}

const patchMock = () => vi.mocked(sdk.patchApiV1TaskItemsById)
const patchBody = () => patchMock().mock.calls[0][0]!.body as Record<string, unknown>
const rejectWith = (apiError: unknown) =>
  patchMock().mockImplementation(((opts?: { throwOnError?: boolean }) =>
    opts?.throwOnError
      ? Promise.reject(apiError)
      : Promise.resolve({ error: apiError, response: new Response(null, { status: 422 }) })) as never)

describe('useSaveTaskWithProject against an HTTP failing PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(removeJournalTodo).mockReset().mockResolvedValue(undefined as never)
  })

  it('save() resolves false and sets the error when the PATCH returns an HTTP error (throwOnError is set)', async () => {
    rejectWith({ code: 'TASK_PARENT_SELF_NOT_ALLOWED' })
    const result = setup()

    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, { title: 'T', projectId: 2 }, false) })

    expect(patchMock()).toHaveBeenCalledWith(expect.objectContaining({ throwOnError: true }))
    expect(saved).toBe(false)
    expect(result.current.error).toBe('A task cannot be set as its own parent.')
  })

  it('a generic HTTP 500 falls back to the generic save message', async () => {
    patchMock().mockImplementation(((opts?: { throwOnError?: boolean }) =>
      opts?.throwOnError ? Promise.reject('boom') : Promise.resolve({ response: new Response(null, { status: 500 }) })) as never)
    const result = setup()

    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5 }, { title: 'T' }, false) })

    expect(saved).toBe(false)
    expect(result.current.error).toBe('Unable to save task changes. Please try again.')
  })

  it('a refused status-plus-project save rolls the optimistic status back in the list and detail caches', async () => {
    rejectWith({ code: 'TASK_GOAL_NOT_NOW' })
    const qc = new QueryClient()
    const list = { data: [{ id: 5, status: 'Todo', title: 'T' }] }
    const detail = { data: { id: 5, status: 'Todo', title: 'T' } }
    qc.setQueryData(taskKeys.all, list)
    qc.setQueryData(taskKeys.detail(5), detail)
    const result = setup(getTaskMutationErrorMessage, qc)

    await act(async () => {
      await result.current.save({ id: 5, projectId: 1 }, { title: 'T', status: 'inProgress', projectId: 2 } as never, false)
    })

    expect(qc.getQueryData(taskKeys.all)).toEqual(list)
    expect(qc.getQueryData(taskKeys.detail(5))).toEqual(detail)
  })
})

describe('useSaveTaskWithProject PATCH body and cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(removeJournalTodo).mockReset().mockResolvedValue(undefined as never)
    patchMock().mockResolvedValue({ data: {} } as never)
  })

  it('an emptied description and due date go as explicit null, blockedReason is absent, and PUT and assign are never called', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5 }, { title: 'T', description: null, dueDate: null }, false) })

    expect(patchBody()).toHaveProperty('description', null)
    expect(patchBody()).toHaveProperty('dueDate', null)
    expect(patchBody()).not.toHaveProperty('blockedReason')
    expect(patchBody()).not.toHaveProperty('goalId')
    expect(sdk.putApiV1TaskItemsById).not.toHaveBeenCalled()
  })

  it('a project-only change invalidates the task list and detail keys', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: 1 }, { title: 'T', projectId: 2 }, false) })

    expect(patchBody()).toHaveProperty('projectId', 2)
    expect(result.invalidatedKeys()).toEqual(expect.arrayContaining([taskKeys.all, taskKeys.detail(5)]))
    expect(result.invalidatedKeys()).not.toContainEqual(journalKeys.all)
  })

  it('a set/change sends journalDate with the timezone offset, makes no remove call and invalidates journal queries', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: 3 }, { title: 'T', plannedDay: '2099-11-12' }, false) })

    expect(patchBody().journalDate).toBe('2099-11-12')
    expect(patchBody()).toHaveProperty('timezoneOffsetMinutes')
    expect(patchBody()).not.toHaveProperty('plannedDay')
    expect(removeJournalTodo).not.toHaveBeenCalled()
    expect(result.invalidatedKeys()).toContainEqual(journalKeys.all)
  })

  it('an untouched planned day sends no journalDate and makes no remove call', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: 3 }, { title: 'T' }, false) })

    expect(patchBody()).not.toHaveProperty('journalDate')
    expect(removeJournalTodo).not.toHaveBeenCalled()
    expect(result.invalidatedKeys()).not.toContainEqual(journalKeys.all)
  })

  it('a clear sends no journalDate, then removes the todo once after the PATCH, invalidating tasks and journal', async () => {
    const result = setup()
    let saved = false
    await act(async () => {
      saved = await result.current.save({ id: 5, projectId: 1, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null, projectId: 2 }, false)
    })

    expect(saved).toBe(true)
    expect(patchBody()).not.toHaveProperty('journalDate')
    expect(removeJournalTodo).toHaveBeenCalledTimes(1)
    expect(removeJournalTodo).toHaveBeenCalledWith(3, 5)
    expect(patchMock().mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(removeJournalTodo).mock.invocationCallOrder[0])
    expect(result.invalidatedKeys()).toEqual(
      expect.arrayContaining([taskKeys.all, taskKeys.detail(5), journalKeys.all]),
    )
  })

  it('a clear on a task with no journal entry id makes no remove call', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: null }, { title: 'T', plannedDay: null }, false) })
    expect(removeJournalTodo).not.toHaveBeenCalled()
  })

  it('a failed clear returns false with the partial-save message, bumps the revert token and invalidates', async () => {
    vi.mocked(removeJournalTodo).mockRejectedValue({ status: 404 })
    const result = setup()
    let saved = true
    await act(async () => {
      saved = await result.current.save({ id: 5, projectId: 1, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null, projectId: 2 }, false)
    })

    expect(saved).toBe(false)
    expect(result.current.error).toBe(
      'Task saved, but removing the planned day failed: The task is no longer on that day. Showing its current planned day.',
    )
    expect(result.current.plannedDayRevertToken).toBe(1)
    expect(result.invalidatedKeys()).toEqual(expect.arrayContaining([taskKeys.all, taskKeys.detail(5), journalKeys.all]))
  })

  it('a generic clear failure uses the generic remove message', async () => {
    vi.mocked(removeJournalTodo).mockRejectedValue(new Error('boom'))
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null }, false) })
    expect(result.current.error).toBe('Task saved, but removing the planned day failed: Unable to remove the planned day. Please try again.')
  })

  it('a refused PATCH makes no clear call, so the planned day is untouched', async () => {
    patchMock().mockRejectedValue({ code: 'TASK_PLAN_HAS_OPEN_SUBTASKS' })
    const result = setup(getTaskPlanSaveErrorMessage)
    let saved = true
    await act(async () => {
      saved = await result.current.save({ id: 5, projectId: 1, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null, projectId: 2 }, false)
    })

    expect(saved).toBe(false)
    expect(result.current.error).toContain('Nothing was saved.')
    expect(removeJournalTodo).not.toHaveBeenCalled()
  })

  it('a 409 assignment conflict shows the conflict message and refetches the task queries', async () => {
    patchMock().mockRejectedValue({ code: 'TASK_JOURNAL_ASSIGNMENT_CONFLICT' })
    const result = setup(getTaskPlanSaveErrorMessage)
    await act(async () => { await result.current.save({ id: 5 }, { title: 'T', plannedDay: '2099-11-12' }, false) })

    expect(result.current.error).toMatch(/^Another tab or device just changed this task's planned day/)
    expect(result.invalidatedKeys()).toEqual(expect.arrayContaining([taskKeys.all, taskKeys.detail(5)]))
  })
})
