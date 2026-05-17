import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTaskQuery, useTasksQuery, useUpdateTaskMutation, useDeleteTaskMutation } from '@/hooks/useTasks'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation } from '@/hooks/useNotes'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import { TaskForm, type TaskFormPayload } from '@/components/TaskForm'
import { usePrefs } from '@/context/usePrefs'
import { NoteCard } from '@/components/NoteCard'
import { NoteForm } from '@/components/NoteForm'
import { formatDate } from '@/lib/utils'
import { formatShort } from '@/lib/journal-utils'
import type { TaskItemResponseDto, NoteResponseDto, UpdateTaskItemDto } from '@/api/client/types.gen'
import '@/tasks.css'

type TaskDetailModel = TaskItemResponseDto & {
  currentJournalDate?: string | null
  moveCount?: number
  daysTagged?: number
  parentTaskItemId?: number | null
  childTaskCount?: number
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)

  const { data: taskData, isLoading: taskLoading, error: taskError } = useTaskQuery(taskId)
  const { data: allTasksData } = useTasksQuery()
  const { data: notesData, isLoading: notesLoading } = useNotesQuery(taskId)
  const updateTask = useUpdateTaskMutation()
  const deleteTask = useDeleteTaskMutation()
  const createNote = useCreateNoteMutation(taskId)
  const updateNote = useUpdateNoteMutation(taskId)
  const deleteNote = useDeleteNoteMutation(taskId)
  const { autoCompleteParentWhenChildrenDone } = usePrefs()

  const navigate = useNavigate()

  const [editingTask, setEditingTask] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponseDto | null>(null)
  const [taskMutationError, setTaskMutationError] = useState<string | null>(null)

  const task = taskData?.data as TaskDetailModel | undefined
  const notes: NoteResponseDto[] = (notesData?.data as NoteResponseDto[] | undefined) ?? []
  const allTasks: TaskDetailModel[] = (allTasksData?.data as TaskDetailModel[] | undefined) ?? []
  const parentOptions = allTasks
    .filter(t => Number(t.id) !== taskId)
    .map(t => ({ id: Number(t.id), title: t.title }))

  if (!Number.isFinite(taskId)) return <div className="tasks-page"><div className="t-shell"><p className="t-error">Task not found.</p></div></div>
  if (taskLoading) return <div className="tasks-page"><div className="t-shell"><p className="t-loading">Loading…</p></div></div>
  if (taskError || !task) return <div className="tasks-page"><div className="t-shell"><p className="t-error">Task not found.</p></div></div>

  function handleUpdateTask(data: TaskFormPayload) {
    setTaskMutationError(null)
    updateTask.mutate(
      {
        id: taskId,
        data: {
          ...(data as UpdateTaskItemDto),
          autoCompleteParentWhenChildrenDone,
        } as UpdateTaskItemDto,
      },
      {
        onSuccess: () => setEditingTask(false),
        onError: err => setTaskMutationError(getTaskMutationErrorMessage(err)),
      }
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
              {taskMutationError && <p className="t-inline-error">{taskMutationError}</p>}
              <TaskForm task={task} availableParents={parentOptions} onSubmit={handleUpdateTask} onCancel={() => { setEditingTask(false); setTaskMutationError(null) }} />
            </>
          ) : (
            <>
              <div className="t-card-row">
                <h1 className="t-detail-title">{task.title}</h1>
                <div className="t-card-actions">
                  <button className="t-btn" onClick={() => setEditingTask(true)}>Edit</button>
                  <button className="t-btn-danger" onClick={handleDeleteTask}>Delete</button>
                </div>
              </div>
              {task.description && <p className="t-detail-desc">{task.description}</p>}
              <div className="t-detail-meta">
                <span>Status: <strong>{task.status}</strong></span>
                <span>Priority: <strong>{task.priority}</strong></span>
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

  return 'Unable to save task changes. Please try again.'
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}
