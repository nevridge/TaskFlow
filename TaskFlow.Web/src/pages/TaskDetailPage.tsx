import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  useTaskQuery,
  useTasksQuery,
  type TaskItemViewModel,
} from '@/hooks/useTasks'
import { useChangeTaskProject, useProjectsQuery } from '@/hooks/useProjects'
import { useSaveTaskWithProject } from '@/hooks/useSaveTaskWithProject'
import { buildProjectOptions, type ProjectOption } from '@/lib/project-options'
import { getProjectMutationErrorMessage, normalizeProjectId } from '@/lib/project-errors'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation } from '@/hooks/useNotes'
import { useDeleteNoteUndoable, useDeleteTaskUndoable } from '@/hooks/useDeleteTaskUndoable'
import { getTaskMutationErrorMessage } from '@/lib/task-errors'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import { TaskForm, type TaskFormPayload } from '@/components/TaskForm'
import { usePrefs } from '@/context/usePrefs'
import { NoteCard } from '@/components/NoteCard'
import { NoteForm } from '@/components/NoteForm'
import { formatDate } from '@/lib/utils'
import { formatShort, formatStartedAt } from '@/lib/journal-utils'
import { getStatusLabel, isBlocked } from '@/lib/task-status'
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
  const deleteTaskUndoable = useDeleteTaskUndoable()
  const createNote = useCreateNoteMutation(taskId)
  const updateNote = useUpdateNoteMutation(taskId)
  const deleteNoteUndoable = useDeleteNoteUndoable(taskId)
  const { autoCompleteParentWhenChildrenDone } = usePrefs()

  const navigate = useNavigate()

  const [editingTask, setEditingTask] = useState(false)
  // Set by a self-initiated delete so the frame between the pending filter and the navigation is empty,
  // not "Task not found".
  const [leaving, setLeaving] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponseDto | null>(null)
  const [quickProjectValue, setQuickProjectValue] = useState<string | null>(null)
  const [quickProjectError, setQuickProjectError] = useState<string | null>(null)
  const projectSelectRef = useRef<HTMLSelectElement>(null)
  const addNoteBtnRef = useRef<HTMLButtonElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const refocusProjectSelect = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const wasEditing = useRef(false)

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

  // Restore focus once the quick-change select is enabled again.
  useEffect(() => {
    if (!changeProject.isPending && refocusProjectSelect.current) {
      refocusProjectSelect.current = false
      projectSelectRef.current?.focus()
    }
  })
  // Title takes focus when the form opens; Edit (remounted) takes it back when the form closes.
  useEffect(() => {
    if (editingTask) titleRef.current?.focus()
    else if (wasEditing.current) editButtonRef.current?.focus()
    wasEditing.current = editingTask
  }, [editingTask])

  const parentOptions = allTasks
    .filter(t => Number(t.id) !== taskId)
    .map(t => ({ id: Number(t.id), title: t.title }))

  if (!Number.isFinite(taskId)) return <div className="tasks-page"><div className="t-shell"><p className="t-error">Task not found.</p></div></div>
  if (leaving) return <div className="tasks-page"><div className="t-shell" /></div>
  if (taskLoading) return <div className="tasks-page"><div className="t-shell"><p className="t-loading">Loading…</p></div></div>
  if (taskError || !task) return <div className="tasks-page"><div className="t-shell"><p className="t-error">Task not found.</p></div></div>

  async function handleUpdateTask(data: TaskFormPayload) {
    const saved = await saveWithProject.save(task!, data, autoCompleteParentWhenChildrenDone)
    if (saved) {
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
    if (deleteBlocked) return
    // Undo restores focus to the row's Delete in the list (a no-op if the list has not rendered it).
    deleteTaskUndoable({ id: taskId, title: task!.title }, () => {
      document.querySelector<HTMLElement>(`[data-task-delete-id="${taskId}"]`)?.focus()
    })
    setLeaving(true)
    navigate('/tasks', { replace: true, state: { focusNewTask: true } })
  }

  function handleDeleteNote(note: NoteResponseDto) {
    const noteId = Number(note.id)
    // Focus first, synchronously: the next note's Delete, else the previous, else Add Note.
    const all = [...document.querySelectorAll<HTMLElement>('[data-note-delete-id]')]
    const index = all.findIndex(el => el.dataset.noteDeleteId === String(noteId))
    const next = index >= 0 ? (all[index + 1] ?? all[index - 1]) : undefined
    ;(next ?? addNoteBtnRef.current)?.focus()
    deleteNoteUndoable(noteId, () => {
      document.querySelector<HTMLElement>(`[data-note-delete-id="${noteId}"]`)?.focus()
    })
  }

  const childCount = Number(task.childTaskCount ?? 0)
  const deleteBlocked = childCount > 0
  const deleteHint = `Delete subtasks first (${childCount})`

  const status = String(task.status ?? 'draft').toLowerCase()
  const priority = String(task.priority ?? 'low').toLowerCase()
  const projectOptions = buildProjectOptions(task, projects)
  const selectValue = quickProjectValue ?? (serverProjectId !== null ? String(serverProjectId) : '')
  // Visible copy of the selected project name (a select cannot wrap long names); empty for "No project".
  const selectedProjectLabel = projectOptions.find(o => o.value === selectValue)?.label

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
                titleInputRef={titleRef}
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
                  {/* aria-disabled (never `disabled`) keeps it focusable; the `!` variants beat tasks.css hover/cursor. */}
                  <button
                    className="t-btn-danger aria-disabled:opacity-50 aria-disabled:cursor-not-allowed! aria-disabled:hover:bg-transparent!"
                    aria-label="Delete task"
                    data-task-delete-id={taskId}
                    aria-disabled={deleteBlocked ? 'true' : undefined}
                    aria-describedby={deleteBlocked ? 'task-delete-hint' : undefined}
                    onClick={handleDeleteTask}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {deleteBlocked && <p id="task-delete-hint" className="t-detail-hint">{deleteHint}</p>}
              {task.description && <p className="t-detail-desc">{task.description}</p>}
              <div className="t-detail-meta">
                <span>Status: <strong>{getStatusLabel(task.status)}</strong></span>
                {task.startedAt && <span>Started: <strong>{formatStartedAt(task.startedAt)}</strong></span>}
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
                    value={selectValue}
                    disabled={changeProject.isPending}
                    aria-busy={changeProject.isPending || undefined}
                    aria-invalid={quickProjectError ? 'true' : undefined}
                    onChange={e => handleQuickProjectChange(e.target.value)}
                  >
                    <option value="">No project</option>
                    {projectOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {selectedProjectLabel && (
                    <span className="t-detail-project-name" aria-hidden="true">{selectedProjectLabel}</span>
                  )}
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
                <span className={`t-badge t-badge-${status}`}>{getStatusLabel(task.status ?? 'draft')}</span>
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
              <button ref={addNoteBtnRef} className="t-btn-primary" onClick={() => setShowNoteForm(true)}>Add Note</button>
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
