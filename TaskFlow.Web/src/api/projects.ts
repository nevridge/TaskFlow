import { client } from './client/client.gen'

export type ProjectResponseDto = {
  id: number
  name: string
  description?: string | null
  isArchived: boolean
  createdAt: string
  updatedAt?: string | null
  openTaskCount: number
  completedTaskCount: number
  blockedCount?: number
}

export type CreateProjectDto = { name: string; description?: string | null }
export type UpdateProjectDto = { name: string; description?: string | null; isArchived: boolean }

export type ProjectTaskDto = {
  id: number
  title: string
  description?: string | null
  dueDate?: string | null
  /** PascalCase status. Typed as string so an unknown value renders as itself (see normalizeStatus). */
  status: string
  blockedReason?: string | null
  priority: 'Low' | 'Medium' | 'High'
  parentTaskItemId?: number | null
  projectId?: number | null
  projectName?: string | null
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
// throwOnError is a runtime flag, set globally by configureApiClient() at startup; the `true`
// generic is type-only. Calls already reject on HTTP errors, so THROW is a redundant, harmless
// belt-and-braces spread.
const THROW = { throwOnError: true } as const

export const getProjects = () =>
  client.get<{ 200: ProjectResponseDto[] }, unknown, true>({
    url: '/api/v1/Projects',
    ...THROW,
  })

export const getProject = (id: number) =>
  client.get<{ 200: ProjectResponseDto }, unknown, true>({
    url: '/api/v1/Projects/{id}',
    path: { id },
    ...THROW,
  })

export const getProjectTasks = (id: number) =>
  client.get<{ 200: ProjectTaskDto[] }, unknown, true>({
    url: '/api/v1/Projects/{id}/tasks',
    path: { id },
    ...THROW,
  })

export const createProject = (body: CreateProjectDto) =>
  client.post<{ 201: ProjectResponseDto }, unknown, true>({
    url: '/api/v1/Projects',
    body,
    headers: JSON_HEADERS,
    ...THROW,
  })

export const updateProject = (id: number, body: UpdateProjectDto) =>
  client.put<{ 200: ProjectResponseDto }, unknown, true>({
    url: '/api/v1/Projects/{id}',
    path: { id },
    body,
    headers: JSON_HEADERS,
    ...THROW,
  })

export const deleteProject = (id: number) =>
  client.delete<{ 204: void }, unknown, true>({
    url: '/api/v1/Projects/{id}',
    path: { id },
    ...THROW,
  })

export const assignTaskToProject = (id: number, taskItemId: number) =>
  client.post<{ 204: void }, unknown, true>({
    url: '/api/v1/Projects/{id}/tasks',
    path: { id },
    body: { taskItemId },
    headers: JSON_HEADERS,
    ...THROW,
  })

export const unassignTaskFromProject = (id: number, taskItemId: number) =>
  client.delete<{ 204: void }, unknown, true>({
    url: '/api/v1/Projects/{id}/tasks/{taskItemId}',
    path: { id, taskItemId },
    ...THROW,
  })
