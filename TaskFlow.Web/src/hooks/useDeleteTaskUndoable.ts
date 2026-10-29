import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deleteApiV1TaskItemsById, deleteApiV1TaskItemsByTaskIdNotesById } from '@/api/client/sdk.gen'
import { invalidateAfterTaskDelete } from '@/hooks/useTasks'
import { noteKeys } from '@/hooks/useNotes'
import { pendingKey, useUndoableDelete } from '@/hooks/useUndoableDelete'
import { getErrorCode } from '@/lib/task-errors'

export const TASK_DELETE_WINDOW_MS = 10_000

/** The server refused the delete because the task still has subtasks (422). */
export class TaskDeleteBlockedError extends Error {
  constructor() {
    super('TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN')
    this.name = 'TaskDeleteBlockedError'
  }
}

interface NonThrowingResult {
  error?: unknown
  response?: { ok: boolean; status: number }
}

/**
 * Reads a non-throwing delete result. 2xx and 404 (already gone) are success; the 422 subtask rule becomes a
 * TaskDeleteBlockedError; anything else rejects. The toast commit cannot use throwOnError: an empty 404 body
 * would reject with `{}` and could not be told apart from a real failure.
 */
function assertDeleted({ error, response }: NonThrowingResult) {
  if (!response) {
    if (error) throw error
    return
  }
  if (response.ok || response.status === 404) return
  if (response.status === 422 && getErrorCode(error) === 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN') {
    throw new TaskDeleteBlockedError()
  }
  throw error ?? new Error(`Delete failed with status ${response.status}`)
}

export function getTaskDeleteErrorMessage(err: unknown): string {
  return err instanceof TaskDeleteBlockedError
    ? "Can't delete: this task has subtasks."
    : "Couldn't delete the task. Restored."
}

/** Undoable task delete: hidden at once, the DELETE is sent after 10s unless the user undoes it. */
export function useDeleteTaskUndoable() {
  const qc = useQueryClient()
  const { requestDelete } = useUndoableDelete()
  return useCallback(
    (task: { id: number; title: string }, restoreFocus?: () => void) => {
      const { id } = task
      requestDelete({
        key: pendingKey('task', id),
        message: `Task deleted: "${task.title}"`,
        errorMessage: getTaskDeleteErrorMessage,
        durationMs: TASK_DELETE_WINDOW_MS,
        commit: async () => assertDeleted(await deleteApiV1TaskItemsById({ path: { id } })),
        invalidate: () => invalidateAfterTaskDelete(qc, id),
        restoreFocus,
      })
    },
    [qc, requestDelete],
  )
}

/** Undoable note delete (6s). A note already removed by its task's cascade (404) counts as deleted. */
export function useDeleteNoteUndoable(taskId: number) {
  const qc = useQueryClient()
  const { requestDelete } = useUndoableDelete()
  return useCallback(
    (noteId: number, restoreFocus?: () => void) => {
      requestDelete({
        key: pendingKey('tasknote', noteId),
        message: 'Note deleted',
        errorMessage: "Couldn't delete the note. Restored.",
        commit: async () =>
          assertDeleted(await deleteApiV1TaskItemsByTaskIdNotesById({ path: { taskId, id: noteId } })),
        invalidate: () => qc.invalidateQueries({ queryKey: noteKeys.all(taskId) }),
        restoreFocus,
      })
    },
    [qc, requestDelete, taskId],
  )
}
