import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

vi.mock('@/hooks/useTasks', () => ({
  useUpdateTaskMutation: vi.fn(),
  taskKeys: {
    all: ['tasks'],
    detail: (id: number) => ['tasks', id],
    history: (id: number) => ['tasks', id, 'history'],
  },
}))

vi.mock('@/hooks/useProjects', () => ({
  useChangeTaskProject: vi.fn(),
}))

import { useUpdateTaskMutation } from '@/hooks/useTasks'
import { useChangeTaskProject } from '@/hooks/useProjects'
import { useSaveTaskWithProject } from './useSaveTaskWithProject'

const updateAsync = vi.fn()
const changeAsync = vi.fn()

function setup() {
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useSaveTaskWithProject(() => 'task error'), { wrapper })
  return { result, invalidate }
}

const form = { title: 'T', projectId: 2 }

describe('useSaveTaskWithProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateAsync.mockReset().mockResolvedValue({})
    changeAsync.mockReset().mockResolvedValue(undefined)
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutateAsync: updateAsync } as never)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: changeAsync } as never)
  })

  it('PUTs without projectId, then makes one project call, and resolves true', async () => {
    const { result } = setup()
    let saved = false
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, form, true) })

    expect(saved).toBe(true)
    expect(updateAsync.mock.calls[0][0].data).not.toHaveProperty('projectId')
    expect(changeAsync).toHaveBeenCalledOnce()
    expect(changeAsync).toHaveBeenCalledWith({ taskId: 5, fromProjectId: 1, toProjectId: 2 })
  })

  it('makes no project call when the selection equals the current project (string id)', async () => {
    const { result } = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: '2' }, form, false) })

    expect(changeAsync).not.toHaveBeenCalled()
  })

  it('makes no project call when the form carries no projectId', async () => {
    const { result } = setup()
    await act(async () => { await result.current.save({ id: 5, projectId: 1 }, { title: 'T' }, false) })

    expect(changeAsync).not.toHaveBeenCalled()
  })

  it('a failed PUT sets the task error, resolves false and makes no project call', async () => {
    updateAsync.mockRejectedValue({ code: 'X' })
    const { result } = setup()
    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, form, false) })

    expect(saved).toBe(false)
    expect(result.current.error).toBe('task error')
    expect(changeAsync).not.toHaveBeenCalled()
  })

  it('a failed project call reports the partial failure, invalidates task keys and resolves false', async () => {
    changeAsync.mockRejectedValue({ status: 404 })
    const { result, invalidate } = setup()
    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, form, false) })

    expect(saved).toBe(false)
    expect(result.current.error).toBe('Task saved, but the project change failed: The task or project could not be found. It may have been changed or removed.')
    expect(result.current.projectInvalid).toBe(true)
    const keys = invalidate.mock.calls.map(c => c[0]?.queryKey)
    expect(keys).toContainEqual(['tasks'])
    expect(keys).toContainEqual(['tasks', 5])
  })

  it('ignores a second save while the first is in flight (no double submit)', async () => {
    let release: () => void = () => {}
    updateAsync.mockReturnValue(new Promise<void>(resolve => { release = resolve }))
    const { result } = setup()
    let first: Promise<boolean> = Promise.resolve(false)
    let second = true
    await act(async () => {
      first = result.current.save({ id: 5, projectId: 1 }, form, false)
      second = await result.current.save({ id: 5, projectId: 1 }, form, false)
    })

    expect(second).toBe(false)
    await act(async () => { release(); await first })
    expect(updateAsync).toHaveBeenCalledOnce()
    expect(changeAsync).toHaveBeenCalledOnce()
    expect(result.current.isSaving).toBe(false)
  })
})
