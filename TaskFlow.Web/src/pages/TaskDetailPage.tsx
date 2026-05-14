import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTaskQuery, useUpdateTaskMutation, useDeleteTaskMutation } from '@/hooks/useTasks'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation } from '@/hooks/useNotes'
import { TaskForm } from '@/components/TaskForm'
import { NoteCard } from '@/components/NoteCard'
import { NoteForm } from '@/components/NoteForm'
import { formatDate } from '@/lib/utils'
import type { TaskItemResponseDto, NoteResponseDto, CreateTaskItemDto } from '@/api/client/types.gen'
import '@/tasks.css'

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)

  const { data: taskData, isLoading: taskLoading, error: taskError } = useTaskQuery(taskId)
  const { data: notesData, isLoading: notesLoading } = useNotesQuery(taskId)
  const updateTask = useUpdateTaskMutation()
  const deleteTask = useDeleteTaskMutation()
  const createNote = useCreateNoteMutation(taskId)
  const updateNote = useUpdateNoteMutation(taskId)
  const deleteNote = useDeleteNoteMutation(taskId)

  const navigate = useNavigate()

  const [editingTask, setEditingTask] = useState(false)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponseDto | null>(null)

  const task = taskData?.data as TaskItemResponseDto | undefined
  const notes: NoteResponseDto[] = (notesData?.data as NoteResponseDto[] | undefined) ?? []

  if (!Number.isFinite(taskId)) return <div className="tasks-page"><div className="t-shell" style={{ color: 'var(--danger-ink)', paddingTop: 40 }}>Task not found.</div></div>
  if (taskLoading) return <div className="tasks-page"><div className="t-shell" style={{ color: 'var(--muted)', paddingTop: 40 }}>Loading…</div></div>
  if (taskError || !task) return <div className="tasks-page"><div className="t-shell" style={{ color: 'var(--danger-ink)', paddingTop: 40 }}>Task not found.</div></div>

  function handleUpdateTask(data: CreateTaskItemDto) {
    updateTask.mutate({ id: taskId, data }, { onSuccess: () => setEditingTask(false) })
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
      <div className="t-shell" style={{ maxWidth: 800 }}>
        <Link to="/tasks" className="t-back-link">← Back to Tasks</Link>

        <div className="t-panel">
          {editingTask ? (
            <>
              <h2 className="t-panel-title">Edit Task</h2>
              <TaskForm task={task} onSubmit={handleUpdateTask} onCancel={() => setEditingTask(false)} />
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
                {task.dueDate && <span>Due: <strong>{formatDate(task.dueDate)}</strong></span>}
              </div>
              <div className="t-badges" style={{ marginTop: 14 }}>
                <span className={`t-badge t-badge-${status}`}>{status}</span>
                <span className={`t-badge t-badge-${priority}`}>{priority}</span>
              </div>
            </>
          )}
        </div>

        <div>
          <div className="t-section-hdr">
            <h2 className="t-section-title">Notes</h2>
            {!showNoteForm && !editingNote && (
              <button className="t-btn-primary" onClick={() => setShowNoteForm(true)}>Add Note</button>
            )}
          </div>

          {showNoteForm && (
            <div className="t-panel" style={{ marginBottom: 12 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.map(note =>
                editingNote?.id === note.id ? (
                  <div key={String(note.id)} className="t-panel" style={{ marginBottom: 0 }}>
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
