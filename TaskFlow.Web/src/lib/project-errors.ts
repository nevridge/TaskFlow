export type ProjectErrorKind = 'notFound' | 'conflict' | 'generic'

export const PROJECT_NOT_FOUND_MESSAGE = 'That project no longer exists.'
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

export function getProjectMutationErrorMessage(error: unknown): string {
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
