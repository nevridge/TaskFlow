import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePatchTaskMutation, taskKeys } from '@/hooks/useTasks'
import { journalKeys } from '@/hooks/journalKeys'
import { removeJournalTodo } from '@/api/journal'
import { getPlanClearErrorMessage } from '@/lib/task-errors'
import type { TaskFormPayload } from '@/components/TaskForm'
import {
  getProjectErrorKind,
  getProjectMutationErrorMessage,
  normalizeProjectId,
} from '@/lib/project-errors'

interface SaveTarget {
  id?: number | string
  projectId?: number | string | null
  /** Journal entry the task is currently planned on; needed to clear the planned day. */
  currentJournalEntryId?: number | string | null
}

/**
 * Whether a refused PATCH takes the project copy. The choice depends on what was sent, not on the code
 * alone: `TASK_PROJECT_NOT_FOUND` is always about the project, but `TASK_GOAL_NOT_NOW` also fires on a
 * status-only edit, where "would join a goal" would describe a move the user never made. So it takes the
 * project copy only when `projectId` was in the PATCH body; otherwise the task messages
 * (`getGoalErrorMessage` via `getTaskErrorMessage`) apply.
 */
function isProjectRefusal(err: unknown, projectIdSent: boolean): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'TASK_PROJECT_NOT_FOUND' || (code === 'TASK_GOAL_NOT_NOW' && projectIdSent)
}

/**
 * Shared edit-save sequence for TaskForm hosts (TasksPage, TaskDetailPage):
 * 1. One PATCH carries the task fields, `journalDate` (only when the form sets or changes the planned day)
 *    and `projectId` (only when the selected project differs from the task's current one; `null` removes
 *    it). The server commits all of it or nothing, so a refused PATCH saves nothing: `save` resolves
 *    false, the form stays open with the user's edits and they can correct the project and resubmit.
 * 2. Only when the form cleared the planned day (`plannedDay === null`) and the task is on a journal
 *    entry, remove it from that day (the PATCH cannot clear a plan). This runs after the PATCH, so a
 *    refused PATCH leaves the planned day untouched.
 * If the clear fails the PATCH has already committed, so "Task saved, but removing the planned day
 * failed" is truthful. The form then reverts to the stored day, so a retry does not re-run the clear:
 * the user must clear again. `plannedDayRevertToken` increments after a failed clear so the form snaps
 * back to the stored day.
 * Error text for a refused PATCH: 422 `TASK_PROJECT_NOT_FOUND`, or `TASK_GOAL_NOT_NOW` when `projectId`
 * was in the body, use the project messages; everything else, including `TASK_GOAL_NOT_NOW` on a save
 * that sent no `projectId`, uses `getTaskErrorMessage`. Only project-not-found marks the project field
 * invalid, because for `TASK_GOAL_NOT_NOW` the project exists. The goal is never sent, so a project
 * change resets it on the server.
 */
export function useSaveTaskWithProject(getTaskErrorMessage: (error: unknown) => string) {
  const qc = useQueryClient()
  const patchTask = usePatchTaskMutation()
  const savingRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectInvalid, setProjectInvalid] = useState(false)
  const [plannedDayRevertToken, setPlannedDayRevertToken] = useState(0)

  function clearError() {
    setError(null)
    setProjectInvalid(false)
  }

  /** Resolves true when everything saved, false when the form must stay open. */
  async function save(
    task: SaveTarget,
    formData: TaskFormPayload,
    autoCompleteParentWhenChildrenDone: boolean,
  ): Promise<boolean> {
    if (savingRef.current || task.id === undefined) return false
    savingRef.current = true
    setIsSaving(true)
    clearError()
    const taskId = Number(task.id)
    try {
      const { projectId: selected, plannedDay, ...fields } = formData
      const from = normalizeProjectId(task.projectId)
      const to = selected === undefined ? from : normalizeProjectId(selected)
      const projectIdSent = from !== to
      try {
        await patchTask.mutateAsync({
          id: taskId,
          data: {
            title: fields.title,
            // PATCH keeps what is omitted, so an emptied field is an explicit null.
            description: fields.description || null,
            dueDate: fields.dueDate || null,
            status: fields.status,
            priority: fields.priority,
            parentTaskItemId: fields.parentTaskItemId ?? null,
            ...(fields.blockedReason !== undefined && { blockedReason: fields.blockedReason }),
            ...(typeof plannedDay === 'string' && plannedDay !== '' && { journalDate: plannedDay }),
            ...(projectIdSent && { projectId: to }),
            autoCompleteParentWhenChildrenDone,
          },
        })
      } catch (err) {
        if (isProjectRefusal(err, projectIdSent)) {
          setError(getProjectMutationErrorMessage(err))
          if (getProjectErrorKind(err) === 'notFound') setProjectInvalid(true)
        } else {
          setError(getTaskErrorMessage(err))
        }
        return false
      }

      if (plannedDay === null && task.currentJournalEntryId != null) {
        try {
          await removeJournalTodo(Number(task.currentJournalEntryId), taskId)
          qc.invalidateQueries({ queryKey: taskKeys.all })
          qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
          qc.invalidateQueries({ queryKey: journalKeys.all })
        } catch (err) {
          setError(`Task saved, but removing the planned day failed: ${getPlanClearErrorMessage(err)}`)
          setPlannedDayRevertToken(n => n + 1)
          qc.invalidateQueries({ queryKey: taskKeys.all })
          qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
          qc.invalidateQueries({ queryKey: journalKeys.all })
          return false
        }
      }
      return true
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  return { save, isSaving, error, setError, projectInvalid, setProjectInvalid, clearError, plannedDayRevertToken }
}
