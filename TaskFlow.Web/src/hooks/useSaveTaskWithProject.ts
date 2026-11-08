import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateTaskMutation, taskKeys, type UpdateTaskPayload } from '@/hooks/useTasks'
import { useChangeTaskProject } from '@/hooks/useProjects'
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
 * Shared edit-save sequence for TaskForm hosts (TasksPage, TaskDetailPage):
 * 1. PUT the task fields (full replace; the PUT never carries projectId). It carries
 *    `journalDate` only when the form sets or changes the planned day.
 * 2. Only when the form cleared the planned day (`plannedDay === null`) and the task is on a
 *    journal entry, remove it from that day (the PUT cannot clear a plan).
 * 3. Only if the selected project differs from the task's current one, make one
 *    assign/unassign call.
 * Steps stop at the first failure. If the PUT fails nothing else runs and nothing was saved. If the
 * clear or project call fails the task fields are already saved, so a "Task saved, but..." message is
 * produced and a retry re-sends the idempotent PUT followed by the remaining steps.
 * `plannedDayRevertToken` increments after a failed clear so the form snaps back to the stored day.
 */
export function useSaveTaskWithProject(getTaskErrorMessage: (error: unknown) => string) {
  const qc = useQueryClient()
  const updateTask = useUpdateTaskMutation()
  const changeProject = useChangeTaskProject()
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
      try {
        await updateTask.mutateAsync({
          id: taskId,
          data: {
            ...(fields as UpdateTaskPayload),
            ...(typeof plannedDay === 'string' && plannedDay !== '' && { journalDate: plannedDay }),
            autoCompleteParentWhenChildrenDone,
          },
        })
      } catch (err) {
        setError(getTaskErrorMessage(err))
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

      const from = normalizeProjectId(task.projectId)
      const to = selected === undefined ? from : normalizeProjectId(selected)
      if (from === to) return true

      try {
        await changeProject.mutateAsync({ taskId, fromProjectId: from, toProjectId: to })
        return true
      } catch (err) {
        setError(`Task saved, but the project change failed: ${getProjectMutationErrorMessage(err)}`)
        if (getProjectErrorKind(err) === 'notFound') setProjectInvalid(true)
        qc.invalidateQueries({ queryKey: taskKeys.all })
        qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
        return false
      }
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  return { save, isSaving, error, setError, projectInvalid, setProjectInvalid, clearError, plannedDayRevertToken }
}
