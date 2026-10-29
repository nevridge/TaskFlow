import { PROJECT_CREATE_NOT_FOUND_MESSAGE } from '@/lib/project-errors'
import { getBlockErrorMessage } from '@/lib/task-status'

export function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}

/** Shared by the Tasks list and the task detail page. The journal keeps its own getTaskActionErrorMessage. */
export function getTaskMutationErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED') return 'Completed tasks assigned to past days cannot be reopened.'
  if (code === 'TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN' || code === 'TASK_PARENT_INCOMPLETE_CHILDREN') return 'Parent tasks cannot be completed while child tasks are still open.'
  if (code === 'TASK_PARENT_SELF_NOT_ALLOWED') return 'A task cannot be set as its own parent.'
  if (code === 'TASK_PARENT_CYCLE_NOT_ALLOWED') return 'This parent assignment would create a cycle.'
  if (code === 'TASK_PARENT_DEPTH_NOT_ALLOWED') return 'Only one subtask level is supported.'
  if (code === 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN') return 'This task has subtasks. Remove or reassign subtasks before deleting.'
  if (code === 'TASK_PARENT_NOT_FOUND') return 'The selected parent task was not found.'
  if (code === 'TASK_CREATION_PAST_DAY_NOT_ALLOWED') return 'You cannot create new tasks on a past journal day.'
  if (code === 'TASK_PROJECT_NOT_FOUND') return PROJECT_CREATE_NOT_FOUND_MESSAGE
  const blockMessage = getBlockErrorMessage(code)
  if (blockMessage) return blockMessage
  return 'Unable to save task changes. Please try again.'
}
