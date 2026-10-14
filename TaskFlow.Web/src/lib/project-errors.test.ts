import { describe, it, expect } from 'vitest'
import {
  getProjectErrorKind,
  getProjectMutationErrorMessage,
  normalizeProjectId,
} from './project-errors'
import { buildProjectOptions } from './project-options'

describe('getProjectErrorKind', () => {
  it.each([
    [{ status: 404 }, 'notFound'],
    [{ status: 409 }, 'conflict'],
    [{ message: 'This task is already assigned to the project.' }, 'conflict'],
    [{ message: 'boom' }, 'generic'],
    ['', 'generic'],
    [null, 'generic'],
    [undefined, 'generic'],
  ])('classifies %j as %s', (error, kind) => {
    expect(getProjectErrorKind(error)).toBe(kind)
  })
})

describe('getProjectMutationErrorMessage', () => {
  it('maps each kind to a friendly message', () => {
    expect(getProjectMutationErrorMessage({ status: 404 })).toBe('The task or project could not be found. It may have been changed or removed.')
    expect(getProjectMutationErrorMessage({ status: 409 })).toBe('This task is already in that project.')
    expect(getProjectMutationErrorMessage({ status: 500, message: 'raw server text' })).toBe(
      'Unable to change the project. Please try again.',
    )
  })
})

describe('normalizeProjectId', () => {
  it.each([
    [3, 3],
    ['3', 3],
    [null, null],
    [undefined, null],
    ['', null],
    ['abc', null],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeProjectId(input as never)).toBe(expected)
  })
})

describe('buildProjectOptions', () => {
  const projects = [
    { id: 1, name: 'Zed', isArchived: false },
    { id: 2, name: 'Alpha', isArchived: false },
    { id: 3, name: 'Old', isArchived: true },
  ]

  it('offers only non-archived projects, sorted by name', () => {
    expect(buildProjectOptions(undefined, projects).map(o => o.label)).toEqual(['Alpha', 'Zed'])
  })

  it('keeps an active current project in sorted position without duplicating it', () => {
    expect(buildProjectOptions({ projectId: 1, projectName: 'Zed' }, projects).map(o => o.label)).toEqual(['Alpha', 'Zed'])
  })

  it('adds the archived current project first with a suffix', () => {
    expect(buildProjectOptions({ projectId: '3', projectName: 'Old' }, projects).map(o => o.label)).toEqual([
      'Old (archived)',
      'Alpha',
      'Zed',
    ])
  })

  it('does not mutate the projects argument', () => {
    const copy = [...projects]
    buildProjectOptions(undefined, projects)
    expect(projects).toEqual(copy)
  })
})
