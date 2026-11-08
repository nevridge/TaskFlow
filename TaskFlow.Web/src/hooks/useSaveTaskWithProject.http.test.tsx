import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

// Uses the REAL useUpdateTaskMutation and mocks only the SDK, behaving like the generated client:
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

vi.mock('@/hooks/useProjects', () => ({
  useChangeTaskProject: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'
import { removeJournalTodo } from '@/api/journal'
import { useChangeTaskProject } from '@/hooks/useProjects'
import { journalKeys } from '@/hooks/journalKeys'
import { taskKeys } from '@/hooks/useTasks'
import { getTaskMutationErrorMessage, getTaskPlanSaveErrorMessage } from '@/lib/task-errors'
import { useSaveTaskWithProject } from './useSaveTaskWithProject'

const changeAsync = vi.fn()

function setup(getError: (e: unknown) => string = getTaskMutationErrorMessage) {
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  const result = renderHook(() => useSaveTaskWithProject(getError), { wrapper }).result
  return {
    get current() { return result.current },
    invalidatedKeys: () => invalidate.mock.calls.map(c => c[0]?.queryKey),
  }
}

describe('useSaveTaskWithProject against an HTTP failing PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    changeAsync.mockReset().mockResolvedValue(undefined)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: changeAsync } as never)
  })

  it('save() resolves false, sets the error and makes no project call when the PUT returns an HTTP error', async () => {
    const apiError = { code: 'TASK_PARENT_SELF_NOT_ALLOWED' }
    vi.mocked(sdk.putApiV1TaskItemsById).mockImplementation(((opts?: { throwOnError?: boolean }) =>
      opts?.throwOnError
        ? Promise.reject(apiError)
        : Promise.resolve({ error: apiError, response: new Response(null, { status: 422 }) })) as never)
    const result = setup()

    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, { title: 'T', projectId: 2 }, false) })

    expect(sdk.putApiV1TaskItemsById).toHaveBeenCalledWith(expect.objectContaining({ throwOnError: true }))
    expect(saved).toBe(false)
    expect(result.current.error).toBe('A task cannot be set as its own parent.')
    expect(changeAsync).not.toHaveBeenCalled()
  })

  it('a generic HTTP 500 falls back to the generic save message', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockImplementation(((opts?: { throwOnError?: boolean }) =>
      opts?.throwOnError ? Promise.reject('boom') : Promise.resolve({ response: new Response(null, { status: 500 }) })) as never)
    const result = setup()

    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5 }, { title: 'T' }, false) })

    expect(saved).toBe(false)
    expect(result.current.error).toBe('Unable to save task changes. Please try again.')
  })
})

describe('useSaveTaskWithProject planned day', () => {
  const okPut = () => vi.mocked(sdk.putApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
  const putBody = () => vi.mocked(sdk.putApiV1TaskItemsById).mock.calls[0][0]!.body as Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    changeAsync.mockReset().mockResolvedValue(undefined)
    vi.mocked(removeJournalTodo).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: changeAsync } as never)
    okPut()
  })

  it('a set/change sends journalDate with the timezone offset, makes no remove call and invalidates journal queries', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: 3 }, { title: 'T', plannedDay: '2099-11-12' }, false) })

    expect(putBody().journalDate).toBe('2099-11-12')
    expect(putBody()).toHaveProperty('timezoneOffsetMinutes')
    expect(putBody()).not.toHaveProperty('plannedDay')
    expect(removeJournalTodo).not.toHaveBeenCalled()
    expect(result.invalidatedKeys()).toContainEqual(journalKeys.all)
  })

  it('an untouched planned day sends no journalDate and makes no remove call', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: 3 }, { title: 'T' }, false) })

    expect(putBody()).not.toHaveProperty('journalDate')
    expect(removeJournalTodo).not.toHaveBeenCalled()
    expect(result.invalidatedKeys()).not.toContainEqual(journalKeys.all)
  })

  it('a clear sends no journalDate, then removes the todo once, then changes the project, invalidating tasks and journal', async () => {
    const result = setup()
    let saved = false
    await act(async () => {
      saved = await result.current.save({ id: 5, projectId: 1, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null, projectId: 2 }, false)
    })

    expect(saved).toBe(true)
    expect(putBody()).not.toHaveProperty('journalDate')
    expect(removeJournalTodo).toHaveBeenCalledTimes(1)
    expect(removeJournalTodo).toHaveBeenCalledWith(3, 5)
    const put = vi.mocked(sdk.putApiV1TaskItemsById).mock.invocationCallOrder[0]
    const remove = vi.mocked(removeJournalTodo).mock.invocationCallOrder[0]
    const project = changeAsync.mock.invocationCallOrder[0]
    expect(put).toBeLessThan(remove)
    expect(remove).toBeLessThan(project)
    expect(result.invalidatedKeys()).toEqual(
      expect.arrayContaining([taskKeys.all, taskKeys.detail(5), journalKeys.all]),
    )
  })

  it('a clear on a task with no journal entry id makes no remove call', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: null }, { title: 'T', plannedDay: null }, false) })
    expect(removeJournalTodo).not.toHaveBeenCalled()
  })

  it('a failed clear returns false with the partial-save message, bumps the revert token, invalidates and skips the project step', async () => {
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
    expect(changeAsync).not.toHaveBeenCalled()
    expect(result.invalidatedKeys()).toEqual(expect.arrayContaining([taskKeys.all, taskKeys.detail(5), journalKeys.all]))
  })

  it('a generic clear failure uses the generic remove message', async () => {
    vi.mocked(removeJournalTodo).mockRejectedValue(new Error('boom'))
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null }, false) })
    expect(result.current.error).toBe('Task saved, but removing the planned day failed: Unable to remove the planned day. Please try again.')
  })

  it('a failed PUT makes no clear or project call', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockRejectedValue({ code: 'TASK_PLAN_HAS_OPEN_SUBTASKS' })
    const result = setup(getTaskPlanSaveErrorMessage)
    let saved = true
    await act(async () => {
      saved = await result.current.save({ id: 5, projectId: 1, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null, projectId: 2 }, false)
    })

    expect(saved).toBe(false)
    expect(result.current.error).toContain('Nothing was saved.')
    expect(removeJournalTodo).not.toHaveBeenCalled()
    expect(changeAsync).not.toHaveBeenCalled()
  })

  it('a 409 assignment conflict shows the conflict message and refetches the task queries', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockRejectedValue({ code: 'TASK_JOURNAL_ASSIGNMENT_CONFLICT' })
    const result = setup(getTaskPlanSaveErrorMessage)
    await act(async () => { await result.current.save({ id: 5 }, { title: 'T', plannedDay: '2099-11-12' }, false) })

    expect(result.current.error).toMatch(/^Another tab or device just changed this task's planned day/)
    expect(result.invalidatedKeys()).toEqual(expect.arrayContaining([taskKeys.all, taskKeys.detail(5)]))
  })
})
