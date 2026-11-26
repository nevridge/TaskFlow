import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

vi.mock('@/hooks/useTasks', () => ({
  usePatchTaskMutation: vi.fn(),
  taskKeys: {
    all: ['tasks'],
    detail: (id: number) => ['tasks', id],
    history: (id: number) => ['tasks', id, 'history'],
  },
}))

vi.mock('@/api/journal', () => ({ removeJournalTodo: vi.fn() }))

import { usePatchTaskMutation } from '@/hooks/useTasks'
import { removeJournalTodo } from '@/api/journal'
import { useSaveTaskWithProject } from './useSaveTaskWithProject'

const patchAsync = vi.fn()

function setup() {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useSaveTaskWithProject(() => 'task error'), { wrapper })
  return result
}

const form = { title: 'T', projectId: 2 }
const sentData = () => patchAsync.mock.calls[0][0].data as Record<string, unknown>

describe('useSaveTaskWithProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    patchAsync.mockReset().mockResolvedValue({})
    vi.mocked(removeJournalTodo).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(usePatchTaskMutation).mockReturnValue({ mutateAsync: patchAsync } as never)
  })

  it('sends one PATCH carrying the changed project and resolves true', async () => {
    const result = setup()
    let saved = false
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, form, true) })

    expect(saved).toBe(true)
    expect(patchAsync).toHaveBeenCalledOnce()
    expect(patchAsync.mock.calls[0][0].id).toBe(5)
    expect(sentData()).toMatchObject({ projectId: 2, autoCompleteParentWhenChildrenDone: true })
  })

  it('sends projectId null to remove the project', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: 1 }, { title: 'T', projectId: null }, false) })

    expect(sentData()).toHaveProperty('projectId', null)
  })

  it('sends no projectId when the selection equals the current project (string id)', async () => {
    const result = setup()
    let saved = false
    await act(async () => { saved = await result.current.save({ id: 5, projectId: '2' }, form, false) })

    expect(saved).toBe(true)
    expect(sentData()).not.toHaveProperty('projectId')
    expect(result.current.error).toBeNull()
  })

  it('sends no projectId when the form carries none', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: 1 }, { title: 'T' }, false) })

    expect(sentData()).not.toHaveProperty('projectId')
  })

  it('sends an emptied description and due date as explicit null', async () => {
    const result = setup()
    await act(async () => {
      await result.current.save({ id: 5 }, { title: 'T', description: null, dueDate: null }, false)
    })

    expect(sentData()).toHaveProperty('description', null)
    expect(sentData()).toHaveProperty('dueDate', null)
  })

  it('a refused PATCH shows one generic task error, resolves false and does not clear the planned day', async () => {
    patchAsync.mockRejectedValue({ code: 'X' })
    const result = setup()
    let saved = true
    await act(async () => {
      saved = await result.current.save({ id: 5, projectId: 1, currentJournalEntryId: 3 }, { ...form, plannedDay: null }, false)
    })

    expect(saved).toBe(false)
    expect(result.current.error).toBe('task error')
    expect(result.current.projectInvalid).toBe(false)
    expect(removeJournalTodo).not.toHaveBeenCalled()
  })

  it('a project-not-found refusal shows the project message, marks the project invalid and never says "saved"', async () => {
    patchAsync.mockRejectedValue({ code: 'TASK_PROJECT_NOT_FOUND', message: 'The selected project was not found.' })
    const result = setup()
    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, form, false) })

    expect(saved).toBe(false)
    expect(result.current.error).toBe('The selected project was not found.')
    expect(result.current.projectInvalid).toBe(true)
    expect(result.current.error).not.toMatch(/saved|project change failed/i)
  })

  it('a TASK_GOAL_NOT_NOW refusal shows the project message but does not mark the project invalid', async () => {
    patchAsync.mockRejectedValue({ code: 'TASK_GOAL_NOT_NOW' })
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: 1 }, form, false) })

    expect(result.current.error).toMatch(/Pause it first/)
    expect(result.current.projectInvalid).toBe(false)
  })

  it('a TASK_GOAL_NOT_NOW refusal from a save that sent no projectId uses the task message, not the project copy', async () => {
    patchAsync.mockRejectedValue({ code: 'TASK_GOAL_NOT_NOW' })
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: 1 }, { title: 'T', projectId: 1 }, false) })

    expect(sentData()).not.toHaveProperty('projectId')
    expect(result.current.error).toBe('task error')
    expect(result.current.error).not.toMatch(/would join a goal/)
    expect(result.current.projectInvalid).toBe(false)
  })

  it('a project-not-found refusal on a save that sent no projectId still takes the project path', async () => {
    patchAsync.mockRejectedValue({ code: 'TASK_PROJECT_NOT_FOUND' })
    const result = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: 1 }, { title: 'T', projectId: 1 }, false) })

    expect(result.current.error).toBe('The selected project was not found.')
    expect(result.current.projectInvalid).toBe(true)
  })

  it('a Blocked save with an emptied reason sends blockedReason "" (the API clears it, as PUT did), and one with none omits it', async () => {
    const result = setup()
    await act(async () => { await result.current.save({ id: 5 }, { title: 'T', blockedReason: '' }, false) })
    expect(sentData()).toHaveProperty('blockedReason', '')

    patchAsync.mockClear()
    await act(async () => { await result.current.save({ id: 5 }, { title: 'T' }, false) })
    expect(sentData()).not.toHaveProperty('blockedReason')
  })

  it('runs the planned-day clear after the PATCH and resolves true', async () => {
    const result = setup()
    let saved = false
    await act(async () => {
      saved = await result.current.save({ id: 5, currentJournalEntryId: 3 }, { title: 'T', plannedDay: null }, false)
    })

    expect(saved).toBe(true)
    expect(removeJournalTodo).toHaveBeenCalledWith(3, 5)
    expect(patchAsync.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(removeJournalTodo).mock.invocationCallOrder[0])
  })

  it('a failed clear after a committed PATCH reports it once and bumps the revert token', async () => {
    vi.mocked(removeJournalTodo).mockRejectedValue({ status: 404 })
    const result = setup()
    let saved = true
    await act(async () => {
      saved = await result.current.save({ id: 5, projectId: 1, currentJournalEntryId: 3 }, { ...form, plannedDay: null }, false)
    })

    expect(saved).toBe(false)
    expect(result.current.error).toMatch(/^Task saved, but removing the planned day failed/)
    expect(result.current.plannedDayRevertToken).toBe(1)
  })

  it('ignores a second save while the first is in flight (no double submit)', async () => {
    let release: () => void = () => {}
    patchAsync.mockReturnValue(new Promise<void>(resolve => { release = resolve }))
    const result = setup()
    let first: Promise<boolean> = Promise.resolve(false)
    let second = true
    await act(async () => {
      first = result.current.save({ id: 5, projectId: 1 }, form, false)
      second = await result.current.save({ id: 5, projectId: 1 }, form, false)
    })

    expect(second).toBe(false)
    await act(async () => { release(); await first })
    expect(patchAsync).toHaveBeenCalledOnce()
    expect(result.current.isSaving).toBe(false)
  })
})
