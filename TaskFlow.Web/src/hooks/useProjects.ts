import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getProjects,
  getProject,
  getProjectTasks,
  createProject,
  updateProject,
  deleteProject,
  assignTaskToProject,
  unassignTaskFromProject,
} from '@/api/projects'
import type { CreateProjectDto, UpdateProjectDto } from '@/api/projects'
import { taskKeys } from '@/hooks/useTasks'
import { projectKeys } from '@/hooks/projectKeys'

// Re-exported so existing imports from '@/hooks/useProjects' keep working.
export { projectKeys }

// The task create/update/delete mutations in useTasks.ts invalidate projectKeys.all,
// but the journal toggle/create paths call the SDK directly and do not. Project queries
// that show counts therefore still refetch on every mount and go stale quickly; this
// workaround remains for the journal paths only.
export const PROJECT_STALE_TIME_MS = 5_000

function isValidProjectId(id: number) {
  return Number.isInteger(id) && id > 0
}

export function useProjectsQuery() {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: () => getProjects(),
    staleTime: PROJECT_STALE_TIME_MS,
    refetchOnMount: 'always',
  })
}

export function useProjectQuery(id: number) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
    enabled: isValidProjectId(id),
    retry: false,
    staleTime: PROJECT_STALE_TIME_MS,
    refetchOnMount: 'always',
  })
}

export function useProjectTasksQuery(id: number) {
  return useQuery({
    queryKey: projectKeys.tasks(id),
    queryFn: () => getProjectTasks(id),
    enabled: isValidProjectId(id),
    retry: false,
  })
}

export function useCreateProjectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateProjectDto) => createProject(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  })
}

export function useUpdateProjectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateProjectDto }) => updateProject(id, data),
    onSuccess: (_result, { id }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: projectKeys.all }),
        qc.invalidateQueries({ queryKey: projectKeys.detail(id) }),
      ]),
  })
}

// Deleting a project has no UI yet.
export function useDeleteProjectMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: projectKeys.all })
      qc.removeQueries({ queryKey: projectKeys.detail(id) })
      qc.removeQueries({ queryKey: projectKeys.tasks(id) })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

function invalidateAssignment(qc: ReturnType<typeof useQueryClient>, projectId: number) {
  qc.invalidateQueries({ queryKey: projectKeys.all })
  qc.invalidateQueries({ queryKey: projectKeys.tasks(projectId) })
  qc.invalidateQueries({ queryKey: taskKeys.all })
}

export function useAssignProjectTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskItemId }: { projectId: number; taskItemId: number }) =>
      assignTaskToProject(projectId, taskItemId),
    onSuccess: (_result, { projectId }) => invalidateAssignment(qc, projectId),
  })
}

export function useUnassignProjectTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskItemId }: { projectId: number; taskItemId: number }) =>
      unassignTaskFromProject(projectId, taskItemId),
    onSuccess: (_result, { projectId }) => invalidateAssignment(qc, projectId),
  })
}

export interface ChangeTaskProjectInput {
  taskId: number
  fromProjectId: number | null
  toProjectId: number | null
}

/**
 * Moves a task between projects using the assign/unassign endpoints.
 * - same project: no call (never sends a redundant assign)
 * - to a project: one POST assign (the server moves it; never unassign first)
 * - to no project: DELETE from the old project
 * On any failure the project and task caches are refetched so the UI matches the server.
 */
export function useChangeTaskProject() {
  const qc = useQueryClient()
  const assign = useAssignProjectTaskMutation()
  const unassign = useUnassignProjectTaskMutation()
  return useMutation({
    mutationFn: async ({ taskId, fromProjectId, toProjectId }: ChangeTaskProjectInput) => {
      if (fromProjectId === toProjectId) return
      if (toProjectId !== null) {
        await assign.mutateAsync({ projectId: toProjectId, taskItemId: taskId })
      } else if (fromProjectId !== null) {
        await unassign.mutateAsync({ projectId: fromProjectId, taskItemId: taskId })
      }
    },
    onSuccess: (_result, { fromProjectId, toProjectId }) => {
      // Assignment hooks already invalidated the target project's task list; also
      // refresh the project the task left.
      if (fromProjectId !== null && toProjectId !== null && fromProjectId !== toProjectId) {
        qc.invalidateQueries({ queryKey: projectKeys.tasks(fromProjectId) })
      }
    },
    // Any failure refetches, so the UI converges on server state even when the error
    // body (e.g. from a proxy) cannot be classified as 404/409.
    onError: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}
