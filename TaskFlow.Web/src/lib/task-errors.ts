import { PROJECT_CREATE_NOT_FOUND_MESSAGE } from '@/lib/project-errors'
import { getBlockErrorMessage } from '@/lib/task-status'

/** Shown wherever the server answers TASK_PARENT_COMPLETED_NOT_ALLOWED (Tasks, detail, journal). */
export const PARENT_COMPLETED_MESSAGE =
  "A completed task can't have open subtasks. Reopen the parent first, or keep this subtask completed."

const PLAN_COMPLETED_MESSAGE = 'Completed tasks cannot be moved to another day. Reopen the task first.'

export function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}

/** Shared by the Tasks list and the task detail page. The journal keeps its own getTaskActionErrorMessage. */
export function getTaskMutationErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED') return 'Tasks completed on a past day cannot be reopened.'
  if (code === 'TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN') return 'Parent tasks cannot be completed while child tasks are still open.'
  if (code === 'TASK_PARENT_SELF_NOT_ALLOWED') return 'A task cannot be set as its own parent.'
  if (code === 'TASK_PARENT_COMPLETED_NOT_ALLOWED') return PARENT_COMPLETED_MESSAGE
  if (code === 'TASK_PARENT_DEPTH_NOT_ALLOWED') return 'Only one subtask level is supported.'
  if (code === 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN') return 'This task has subtasks. Remove or reassign subtasks before deleting.'
  if (code === 'TASK_PARENT_NOT_FOUND') return 'The selected parent task was not found.'
  if (code === 'TASK_CREATION_PAST_DAY_NOT_ALLOWED') return 'You cannot create new tasks on a past journal day.'
  if (code === 'TASK_PROJECT_NOT_FOUND') return PROJECT_CREATE_NOT_FOUND_MESSAGE
  if (code === 'TASK_PLAN_COMPLETED_NOT_ALLOWED') return PLAN_COMPLETED_MESSAGE
  const blockMessage = getBlockErrorMessage(code)
  if (blockMessage) return blockMessage
  return 'Unable to save task changes. Please try again.'
}

/** Save errors for the detail page's PUT, which may also plan the task. A failed PUT rolls back everything. */
export function getTaskPlanSaveErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'TASK_CREATION_PAST_DAY_NOT_ALLOWED') return 'You cannot plan a task on a past journal day. Nothing was saved.'
  if (code === 'TASK_PLAN_HAS_OPEN_SUBTASKS') {
    return "A task with open subtasks can't be planned on a day. Plan its subtasks instead. Nothing was saved."
  }
  if (code === 'TASK_JOURNAL_ASSIGNMENT_CONFLICT') {
    return "Another tab or device just changed this task's planned day. Your other edits were not saved. We've refreshed it. Try again."
  }
  return getTaskMutationErrorMessage(error)
}

/** Errors for removing a task from its journal day (the "clear planned day" step). */
export function getPlanClearErrorMessage(error: unknown): string {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  if (status === 404) return 'The task is no longer on that day. Showing its current planned day.'
  if (getErrorCode(error) === 'TASK_PLAN_COMPLETED_NOT_ALLOWED') return PLAN_COMPLETED_MESSAGE
  return 'Unable to remove the planned day. Please try again.'
}
