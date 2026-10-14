import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  projectKeys,
  PROJECT_STALE_TIME_MS,
  useProjectsQuery,
  useProjectQuery,
  useProjectTasksQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useDeleteProjectMutation,
  useAssignProjectTaskMutation,
  useUnassignProjectTaskMutation,
  useChangeTaskProject,
} from './useProjects'
import { projectKeys as projectKeysDirect } from './projectKeys'
import { taskKeys } from './useTasks'

vi.mock('@/api/projects', () => ({
  getProjects: vi.fn(),
  getProject: vi.fn(),
  getProjectTasks: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  assignTaskToProject: vi.fn(),
  unassignTaskFromProject: vi.fn(),
}))

import * as api from '@/api/projects'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function makeWrapper(qc = makeClient()) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

const ok = { data: {} } as never

describe('project queries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('useProjectsQuery calls getProjects with short staleTime and refetchOnMount always', async () => {
    vi.mocked(api.getProjects).mockResolvedValue({ data: [] } as never)
    const qc = makeClient()
    const { result } = renderHook(() => useProjectsQuery(), { wrapper: makeWrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.getProjects).toHaveBeenCalledOnce()
    const opts = qc.getQueryCache().find({ queryKey: projectKeys.all })?.observers[0].options
    expect(opts?.staleTime).toBeLessThanOrEqual(10_000)
    expect(opts?.refetchOnMount).toBe('always')
  })

  it('useProjectQuery calls getProject with the id', async () => {
    vi.mocked(api.getProject).mockResolvedValue({ data: { id: 3 } } as never)
    const { result } = renderHook(() => useProjectQuery(3), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.getProject).toHaveBeenCalledWith(3)
  })

  it('useProjectQuery uses the short staleTime and refetchOnMount always', async () => {
    vi.mocked(api.getProject).mockResolvedValue({ data: { id: 3 } } as never)
    const qc = makeClient()
    const { result } = renderHook(() => useProjectQuery(3), { wrapper: makeWrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = qc.getQueryCache().find({ queryKey: projectKeys.detail(3) })?.observers[0].options
    expect(opts?.staleTime).toBe(PROJECT_STALE_TIME_MS)
    expect(opts?.refetchOnMount).toBe('always')
  })

  it('useProjectTasksQuery has retry disabled', async () => {
    vi.mocked(api.getProjectTasks).mockResolvedValue({ data: [] } as never)
    const qc = makeClient()
    const { result } = renderHook(() => useProjectTasksQuery(5), { wrapper: makeWrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const opts = qc.getQueryCache().find({ queryKey: projectKeys.tasks(5) })?.observers[0].options
    expect(opts?.retry).toBe(false)
  })

  it('useProjectQuery is disabled for NaN', () => {
    renderHook(() => useProjectQuery(NaN), { wrapper: makeWrapper() })
    expect(api.getProject).not.toHaveBeenCalled()
  })

  it.each([0, -3, 1.5])('useProjectQuery and useProjectTasksQuery are disabled for id %s', (id) => {
    renderHook(() => useProjectQuery(id), { wrapper: makeWrapper() })
    renderHook(() => useProjectTasksQuery(id), { wrapper: makeWrapper() })
    expect(api.getProject).not.toHaveBeenCalled()
    expect(api.getProjectTasks).not.toHaveBeenCalled()
  })

  it('useProjectQuery does not retry on error', async () => {
    vi.mocked(api.getProject).mockRejectedValue({})
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 3 } } })
    const { result } = renderHook(() => useProjectQuery(3), { wrapper: makeWrapper(qc) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(api.getProject).toHaveBeenCalledOnce()
  })

  it('useProjectTasksQuery calls getProjectTasks with the id', async () => {
    vi.mocked(api.getProjectTasks).mockResolvedValue({ data: [] } as never)
    const { result } = renderHook(() => useProjectTasksQuery(5), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.getProjectTasks).toHaveBeenCalledWith(5)
  })

  it('useProjectTasksQuery is disabled for NaN', () => {
    renderHook(() => useProjectTasksQuery(NaN), { wrapper: makeWrapper() })
    expect(api.getProjectTasks).not.toHaveBeenCalled()
  })
})

describe('project mutations and invalidation', () => {
  beforeEach(() => vi.clearAllMocks())

  function setup<T>(useHook: () => T) {
    const qc = makeClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const remove = vi.spyOn(qc, 'removeQueries')
    const { result } = renderHook(useHook, { wrapper: makeWrapper(qc) })
    const invalidatedKeys = () => invalidate.mock.calls.map((c) => c[0]?.queryKey)
    const removedKeys = () => remove.mock.calls.map((c) => c[0]?.queryKey)
    return { result, invalidatedKeys, removedKeys }
  }

  it('create invalidates the list only', async () => {
    vi.mocked(api.createProject).mockResolvedValue(ok)
    const { result, invalidatedKeys, removedKeys } = setup(useCreateProjectMutation)
    result.current.mutate({ name: 'A' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.createProject).toHaveBeenCalledWith({ name: 'A' })
    expect(invalidatedKeys()).toEqual([projectKeys.all])
    expect(removedKeys()).toEqual([])
  })

  it('update invalidates list and detail', async () => {
    vi.mocked(api.updateProject).mockResolvedValue(ok)
    const { result, invalidatedKeys } = setup(useUpdateProjectMutation)
    const data = { name: 'A', description: null, isArchived: true }
    result.current.mutate({ id: 7, data })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.updateProject).toHaveBeenCalledWith(7, data)
    expect(invalidatedKeys()).toEqual([projectKeys.all, projectKeys.detail(7)])
  })

  it('delete invalidates list and tasks, removes detail and project tasks', async () => {
    vi.mocked(api.deleteProject).mockResolvedValue(ok)
    const { result, invalidatedKeys, removedKeys } = setup(useDeleteProjectMutation)
    result.current.mutate(7)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.deleteProject).toHaveBeenCalledWith(7)
    expect(invalidatedKeys()).toEqual([projectKeys.all, taskKeys.all])
    expect(removedKeys()).toEqual([projectKeys.detail(7), projectKeys.tasks(7)])
  })

  it('assign invalidates counts, project tasks and tasks', async () => {
    vi.mocked(api.assignTaskToProject).mockResolvedValue(ok)
    const { result, invalidatedKeys } = setup(useAssignProjectTaskMutation)
    result.current.mutate({ projectId: 2, taskItemId: 9 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.assignTaskToProject).toHaveBeenCalledWith(2, 9)
    expect(invalidatedKeys()).toEqual([projectKeys.all, projectKeys.tasks(2), taskKeys.all])
  })

  it('unassign invalidates counts, project tasks and tasks', async () => {
    vi.mocked(api.unassignTaskFromProject).mockResolvedValue(ok)
    const { result, invalidatedKeys } = setup(useUnassignProjectTaskMutation)
    result.current.mutate({ projectId: 2, taskItemId: 9 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.unassignTaskFromProject).toHaveBeenCalledWith(2, 9)
    expect(invalidatedKeys()).toEqual([projectKeys.all, projectKeys.tasks(2), taskKeys.all])
  })

  it('does not invalidate when the mutation fails', async () => {
    vi.mocked(api.createProject).mockRejectedValue({ message: 'dup' })
    const { result, invalidatedKeys } = setup(useCreateProjectMutation)
    result.current.mutate({ name: 'A' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidatedKeys()).toEqual([])
  })
})

describe('useChangeTaskProject', () => {
  beforeEach(() => vi.clearAllMocks())

  function setup() {
    const qc = makeClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useChangeTaskProject(), { wrapper: makeWrapper(qc) })
    const keys = () => invalidate.mock.calls.map(c => c[0]?.queryKey)
    return { result, keys }
  }

  it('re-exports the same projectKeys object from useProjects', () => {
    expect(projectKeys).toBe(projectKeysDirect)
  })

  it('assigns with a POST when the task had no project', async () => {
    vi.mocked(api.assignTaskToProject).mockResolvedValue(ok)
    const { result, keys } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: null, toProjectId: 2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.assignTaskToProject).toHaveBeenCalledWith(2, 9)
    expect(api.unassignTaskFromProject).not.toHaveBeenCalled()
    expect(keys()).toEqual(expect.arrayContaining([projectKeys.all, projectKeys.tasks(2), taskKeys.all]))
  })

  it('unassigns with a DELETE from the old project', async () => {
    vi.mocked(api.unassignTaskFromProject).mockResolvedValue(ok)
    const { result, keys } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: 4, toProjectId: null })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.unassignTaskFromProject).toHaveBeenCalledWith(4, 9)
    expect(api.assignTaskToProject).not.toHaveBeenCalled()
    expect(keys()).toEqual(expect.arrayContaining([projectKeys.all, projectKeys.tasks(4), taskKeys.all]))
  })

  it('moves with a single POST to the new project and refreshes the old project tasks', async () => {
    vi.mocked(api.assignTaskToProject).mockResolvedValue(ok)
    const { result, keys } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: 1, toProjectId: 2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.assignTaskToProject).toHaveBeenCalledOnce()
    expect(api.assignTaskToProject).toHaveBeenCalledWith(2, 9)
    expect(api.unassignTaskFromProject).not.toHaveBeenCalled()
    expect(keys()).toContainEqual(projectKeys.tasks(1))
  })

  it('makes no call when the project is unchanged', async () => {
    const { result, keys } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: 2, toProjectId: 2 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.assignTaskToProject).not.toHaveBeenCalled()
    expect(api.unassignTaskFromProject).not.toHaveBeenCalled()
    expect(keys()).toEqual([])
  })

  it('makes no call when both are null', async () => {
    const { result } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: null, toProjectId: null })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.assignTaskToProject).not.toHaveBeenCalled()
    expect(api.unassignTaskFromProject).not.toHaveBeenCalled()
  })

  it.each([
    ['404', { status: 404 }],
    ['409', { message: 'This task is already assigned to the project.' }],
  ])('invalidates project and task keys after a %s so the UI matches the server', async (_label, error) => {
    vi.mocked(api.assignTaskToProject).mockRejectedValue(error)
    const { result, keys } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: 1, toProjectId: 2 })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys()).toEqual(expect.arrayContaining([projectKeys.all, taskKeys.all]))
  })

  it('unassign 404 invalidates project and task keys', async () => {
    vi.mocked(api.unassignTaskFromProject).mockRejectedValue({ status: 404 })
    const { result, keys } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: 1, toProjectId: null })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys()).toEqual(expect.arrayContaining([projectKeys.all, taskKeys.all]))
  })

  it('invalidates project and task keys on a generic failure too', async () => {
    vi.mocked(api.assignTaskToProject).mockRejectedValue({ message: 'boom' })
    const { result, keys } = setup()
    result.current.mutate({ taskId: 9, fromProjectId: null, toProjectId: 2 })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys()).toEqual(expect.arrayContaining([projectKeys.all, taskKeys.all]))
  })
})
