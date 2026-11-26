export type ProjectErrorKind = 'notFound' | 'conflict' | 'generic'

// The API returns a bare 404 for a missing project, a missing task, and an unassign of a
// task that is not in that project, so the wording must not blame the project alone.
export const PROJECT_NOT_FOUND_MESSAGE = 'The task or project could not be found. It may have been changed or removed.'
export const PROJECT_CONFLICT_MESSAGE = 'This task is already in that project.'
export const PROJECT_GENERIC_MESSAGE = 'Unable to change the project. Please try again.'
export const PROJECT_CREATE_NOT_FOUND_MESSAGE = 'The selected project was not found.'

function readField(error: unknown, field: string): unknown {
  if (!error || typeof error !== 'object') return undefined
  return (error as Record<string, unknown>)[field]
}

/**
 * Classifies an assign/unassign failure. The client throws the parsed response
 * body only (no HTTP status): ASP.NET returns ProblemDetails with `status: 404`
 * for NotFound(), and `{ message }` for the 409 conflict.
 */
export function getProjectErrorKind(error: unknown): ProjectErrorKind {
  const status = readField(error, 'status')
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  const message = readField(error, 'message')
  if (typeof message === 'string' && /already (assigned|in)/i.test(message)) return 'conflict'
  return 'generic'
}

/** The move was refused by the goal rule (#491): retrying alone cannot succeed. */
export const PROJECT_GOAL_NOT_NOW_MESSAGE =
  "This task is in progress and would join a goal that is not the current goal. Pause it first, or swap that goal to Now with the assistant."

export function getProjectMutationErrorMessage(error: unknown): string {
  if (readField(error, 'code') === 'TASK_GOAL_NOT_NOW') return PROJECT_GOAL_NOT_NOW_MESSAGE
  switch (getProjectErrorKind(error)) {
    case 'notFound':
      return PROJECT_NOT_FOUND_MESSAGE
    case 'conflict':
      return PROJECT_CONFLICT_MESSAGE
    default:
      return PROJECT_GENERIC_MESSAGE
  }
}

/** Project ids arrive typed number | string | null; normalise to number | null. */
export function normalizeProjectId(id: number | string | null | undefined): number | null {
  if (id === null || id === undefined || id === '') return null
  const n = Number(id)
  return Number.isFinite(n) ? n : null
}
