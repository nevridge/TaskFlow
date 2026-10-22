import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  useTaskQuery,
  useTasksQuery,
  useDeleteTaskMutation,
  type TaskItemViewModel,
} from '@/hooks/useTasks'
import { useChangeTaskProject, useProjectsQuery } from '@/hooks/useProjects'
import { useSaveTaskWithProject } from '@/hooks/useSaveTaskWithProject'
import { buildProjectOptions, type ProjectOption } from '@/lib/project-options'
import { getProjectMutationErrorMessage, normalizeProjectId } from '@/lib/project-errors'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation } from '@/hooks/useNotes'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import { TaskForm, type TaskFormPayload } from '@/components/TaskForm'
import { usePrefs } from '@/context/usePrefs'
import { NoteCard } from '@/components/NoteCard'
import { NoteForm } from '@/components/NoteForm'
import { formatDate } from '@/lib/utils'
import { formatShort } from '@/lib/journal-utils'
import { getBlockErrorMessage, isBlocked } from '@/lib/task-status'
import type { NoteResponseDto } from '@/api/client/types.gen'
import '@/tasks.css'

type TaskDetailModel = TaskItemViewModel

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)

  const { data: taskData, isLoading: taskLoading, error: taskError } = useTaskQuery(taskId)
  const { data: allTasksData } = useTasksQuery()
  const { data: notesData, isLoading: notesLoading } = useNotesQuery(taskId)
  const { data: projectsData } = useProjectsQuery()
  const saveWithProject = useSaveTaskWithProject(getTaskMutationErrorMessage)
  const changeProject = useChangeTaskProject()
  const deleteTask = useDeleteTaskMutation()
  const createNote = useCreateNoteMutation(taskId)
  const updateNote = useUpdateNoteMutation(taskId)
  const deleteNote = useDeleteNoteMutation(taskId)
  const { autoCompleteParentWhenChildrenDone } = usePrefs()

  const navigate = useNavigate()

  const [editingTask, setEditingTask] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponseDto | null>(null)
  const [quickProjectValue, setQuickProjectValue] = useState<string | null>(null)
  const [quickProjectError, setQuickProjectError] = useState<string | null>(null)
  const projectSelectRef = useRef<HTMLSelectElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const refocusProjectSelect = useRef(false)
  const refocusEditButton = useRef(false)

  const task = taskData?.data as TaskDetailModel | undefined
  const notes: NoteResponseDto[] = (notesData?.data as NoteResponseDto[] | undefined) ?? []
  const allTasks: TaskDetailModel[] = (allTasksData?.data as TaskDetailModel[] | undefined) ?? []
  const projects: ProjectOption[] = useMemo(
    () => (projectsData?.data ?? []).map(p => ({ id: Number(p.id), name: p.name, isArchived: !!p.isArchived })),
    [projectsData],
  )
  const serverProjectId = normalizeProjectId(task?.projectId)

  // Once the refetched task reports a different project, the optimistic value is no longer needed.
  // React's "adjusting state while rendering" pattern; guarded by the seen-value
  // comparison, so the re-render finds them equal and cannot loop.
  const [seenServerProjectId, setSeenServerProjectId] = useState(serverProjectId)
  if (seenServerProjectId !== serverProjectId) {
    setSeenServerProjectId(serverProjectId)
    setQuickProjectValue(null)
  }

  // Restore focus once the quick-change select is enabled again, and to Edit after a full save.
  useEffect(() => {
    if (!changeProject.isPending && refocusProjectSelect.current) {
      refocusProjectSelect.current = false
      projectSelectRef.current?.focus()
    }
  })
  useEffect(() => {
    if (!editingTask && refocusEditButton.current) {
      refocusEditButton.current = false
      editButtonRef.current?.focus()
    }
  }, [editingTask])

  const parentOptions = allTasks
    .filter(t => Number(t.id) !== taskId)
    .map(t => ({ id: Number(t.id), title: t.title }))

  if (!Number.isFinite(taskId)) return <div className="tasks-page"><div className="t-shell"><p className="t-error">Task not found.</p></div></div>
  if (taskLoading) return <div className="tasks-page"><div className="t-shell"><p className="t-loading">Loading…</p></div></div>
  if (taskError || !task) return <div className="tasks-page"><div className="t-shell"><p className="t-error">Task not found.</p></div></div>

  async function handleUpdateTask(data: TaskFormPayload) {
    const saved = await saveWithProject.save(task!, data, autoCompleteParentWhenChildrenDone)
    if (saved) {
      refocusEditButton.current = true
      setEditingTask(false)
    }
  }

  function handleQuickProjectChange(value: string) {
    const to = value ? Number(value) : null
    // The project shown in the select: the optimistic value when a change has been made but the
    // refetched task has not caught up (e.g. the refetch failed), otherwise the server's.
    const current = quickProjectValue !== null ? normalizeProjectId(quickProjectValue) : serverProjectId
    if (to === current) return
    setQuickProjectValue(value)
    setQuickProjectError(null)
    refocusProjectSelect.current = true
    changeProject.mutate(
      { taskId, fromProjectId: current, toProjectId: to },
      {
        onError: err => {
          setQuickProjectValue(null)
          setQuickProjectError(getProjectMutationErrorMessage(err))
        },
      },
    )
  }

  function handleDeleteTask() {
    if (window.confirm(`Delete "${task!.title}"?`)) {
      deleteTask.mutate(taskId, { onSuccess: () => navigate('/tasks') })
    }
  }

  function handleDeleteNote(note: NoteResponseDto) {
    if (window.confirm('Delete this note?')) {
      deleteNote.mutate(Number(note.id))
    }
  }

  const status = String(task.status ?? 'draft').toLowerCase()
  const priority = String(task.priority ?? 'low').toLowerCase()

  return (
    <div className="tasks-page">
      <div className="t-shell t-shell--narrow">
        <Link to="/tasks" className="t-back-link">← Back to Tasks</Link>

        <div className="t-panel">
          {editingTask ? (
            <>
              <h2 className="t-panel-title">Edit Task</h2>
              {saveWithProject.error && <p className="t-inline-error" role="alert">{saveWithProject.error}</p>}
              <TaskForm
                task={task}
                availableParents={parentOptions}
                projects={projects}
                projectInvalid={saveWithProject.projectInvalid}
                onProjectChange={() => saveWithProject.setProjectInvalid(false)}
                isSaving={saveWithProject.isSaving}
                onSubmit={handleUpdateTask}
                onCancel={() => { setEditingTask(false); saveWithProject.clearError() }}
              />
            </>
          ) : (
            <>
              <div className="t-card-row">
                <h1 className="t-detail-title">{task.title}</h1>
                <div className="t-card-actions">
                  <button ref={editButtonRef} className="t-btn" onClick={() => setEditingTask(true)}>Edit</button>
                  <button className="t-btn-danger" onClick={handleDeleteTask}>Delete</button>
                </div>
              </div>
              {task.description && <p className="t-detail-desc">{task.description}</p>}
              <div className="t-detail-meta">
                <span>Status: <strong>{task.status}</strong></span>
                {isBlocked(task.status) && task.blockedReason && (
                  <span title={task.blockedReason}>Blocked reason: <strong>{task.blockedReason}</strong></span>
                )}
                <span>Priority: <strong>{task.priority}</strong></span>
                <div className="t-detail-project" title={task.projectName ?? undefined}>
                  <label htmlFor="task-project">Project: </label>
                  <select
                    id="task-project"
                    ref={projectSelectRef}
                    className="t-select"
                    value={quickProjectValue ?? (serverProjectId !== null ? String(serverProjectId) : '')}
                    disabled={changeProject.isPending}
                    aria-busy={changeProject.isPending || undefined}
                    aria-invalid={quickProjectError ? 'true' : undefined}
                    onChange={e => handleQuickProjectChange(e.target.value)}
                  >
                    <option value="">No project</option>
                    {buildProjectOptions(task, projects).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {quickProjectError && <p className="t-inline-error" role="alert">{quickProjectError}</p>}
                </div>
                <span>Parent: <strong>{task.parentTaskItemId ? `#${task.parentTaskItemId}` : 'None'}</strong></span>
                <span>Children: <strong>{task.childTaskCount ?? 0}</strong></span>
                {task.currentJournalDate && <span>Assigned: <strong>{formatShort(task.currentJournalDate)}</strong></span>}
                <span>Tagged: <strong>{task.daysTagged ?? 0}d</strong></span>
                <span>Moved: <strong>{task.moveCount ?? 0}</strong></span>
                {task.dueDate && <span>Due: <strong>{formatDate(task.dueDate)}</strong></span>}
              </div>
              <div className="t-detail-badges">
                <span className={`t-badge t-badge-${status}`}>{status}</span>
                <span className={`t-badge t-badge-${priority}`}>{priority}</span>
              </div>
            </>
          )}
        </div>

        <div>
          <div className="t-section-hdr">
            <h2 className="t-section-title">Task history</h2>
          </div>
          <TaskHistoryPanel taskId={taskId} />
        </div>

        <div>
          <div className="t-section-hdr">
            <h2 className="t-section-title">Notes</h2>
            {!showNoteForm && !editingNote && (
              <button className="t-btn-primary" onClick={() => setShowNoteForm(true)}>Add Note</button>
            )}
          </div>

          {showNoteForm && (
            <div className="t-panel">
              <NoteForm
                onSubmit={data => createNote.mutate(data, { onSuccess: () => setShowNoteForm(false) })}
                onCancel={() => setShowNoteForm(false)}
              />
            </div>
          )}

          {notesLoading ? (
            <p className="t-empty">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="t-empty">No notes yet.</p>
          ) : (
            <div className="t-note-list">
              {notes.map(note =>
                editingNote?.id === note.id ? (
                  <div key={String(note.id)} className="t-panel t-panel--flush">
                    <NoteForm
                      note={note}
                      onSubmit={data => updateNote.mutate(
                        { id: Number(note.id), data },
                        { onSuccess: () => setEditingNote(null) }
                      )}
                      onCancel={() => setEditingNote(null)}
                    />
                  </div>
                ) : (
                  <NoteCard
                    key={String(note.id)}
                    note={note}
                    onEdit={setEditingNote}
                    onDelete={handleDeleteNote}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getTaskMutationErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED') {
    return 'Completed tasks assigned to past days cannot be reopened.'
  }
  if (code === 'TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN' || code === 'TASK_PARENT_INCOMPLETE_CHILDREN') {
    return 'Parent tasks cannot be completed while child tasks are still open.'
  }
  if (code === 'TASK_PARENT_SELF_NOT_ALLOWED') {
    return 'A task cannot be set as its own parent.'
  }
  if (code === 'TASK_PARENT_CYCLE_NOT_ALLOWED') {
    return 'This parent assignment would create a cycle.'
  }
  if (code === 'TASK_PARENT_DEPTH_NOT_ALLOWED') {
    return 'Only one subtask level is supported.'
  }
  if (code === 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN') {
    return 'This task has subtasks. Remove or reassign subtasks before deleting.'
  }
  if (code === 'TASK_PARENT_NOT_FOUND') {
    return 'The selected parent task was not found.'
  }
  const blockMessage = getBlockErrorMessage(code)
  if (blockMessage) return blockMessage

  return 'Unable to save task changes. Please try again.'
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}
