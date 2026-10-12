import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client/client.gen', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { client } from './client/client.gen'
import {
  getProjects,
  getProject,
  getProjectTasks,
  createProject,
  updateProject,
  deleteProject,
  assignTaskToProject,
  unassignTaskFromProject,
} from './projects'

describe('projects api (mocked client)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getProjects', () => {
    getProjects()
    expect(client.get).toHaveBeenCalledWith({ url: '/api/v1/Projects', throwOnError: true })
  })

  it('getProject', () => {
    getProject(4)
    expect(client.get).toHaveBeenCalledWith({
      url: '/api/v1/Projects/{id}',
      path: { id: 4 },
      throwOnError: true,
    })
  })

  it('getProjectTasks', () => {
    getProjectTasks(4)
    expect(client.get).toHaveBeenCalledWith({
      url: '/api/v1/Projects/{id}/tasks',
      path: { id: 4 },
      throwOnError: true,
    })
  })

  it('createProject', () => {
    createProject({ name: 'A', description: null })
    expect(client.post).toHaveBeenCalledWith({
      url: '/api/v1/Projects',
      body: { name: 'A', description: null },
      headers: { 'Content-Type': 'application/json' },
      throwOnError: true,
    })
  })

  it('updateProject', () => {
    updateProject(2, { name: 'A', description: 'd', isArchived: true })
    expect(client.put).toHaveBeenCalledWith({
      url: '/api/v1/Projects/{id}',
      path: { id: 2 },
      body: { name: 'A', description: 'd', isArchived: true },
      headers: { 'Content-Type': 'application/json' },
      throwOnError: true,
    })
  })

  it('deleteProject', () => {
    deleteProject(2)
    expect(client.delete).toHaveBeenCalledWith({
      url: '/api/v1/Projects/{id}',
      path: { id: 2 },
      throwOnError: true,
    })
  })

  it('assignTaskToProject', () => {
    assignTaskToProject(2, 9)
    expect(client.post).toHaveBeenCalledWith({
      url: '/api/v1/Projects/{id}/tasks',
      path: { id: 2 },
      body: { taskItemId: 9 },
      headers: { 'Content-Type': 'application/json' },
      throwOnError: true,
    })
  })

  it('unassignTaskFromProject', () => {
    unassignTaskFromProject(2, 9)
    expect(client.delete).toHaveBeenCalledWith({
      url: '/api/v1/Projects/{id}/tasks/{taskItemId}',
      path: { id: 2, taskItemId: 9 },
      throwOnError: true,
    })
  })
})
