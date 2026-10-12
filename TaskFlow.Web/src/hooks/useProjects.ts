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

export const projectKeys = {
  all: ['projects'] as const,
  detail: (id: number) => ['projects', id] as const,
  tasks: (id: number) => ['projects', id, 'tasks'] as const,
}

// Task mutations elsewhere do not invalidate project keys, so project queries
// that show counts refetch on every mount and go stale quickly.
export const PROJECT_STALE_TIME_MS = 5_000

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
    enabled: Number.isFinite(id),
    retry: false,
    staleTime: PROJECT_STALE_TIME_MS,
    refetchOnMount: 'always',
  })
}

export function useProjectTasksQuery(id: number) {
  return useQuery({
    queryKey: projectKeys.tasks(id),
    queryFn: () => getProjectTasks(id),
    enabled: Number.isFinite(id),
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
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: projectKeys.all })
      qc.invalidateQueries({ queryKey: projectKeys.detail(id) })
    },
  })
}

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
