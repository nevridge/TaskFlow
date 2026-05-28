import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import type { JournalNoteResponseDto } from '@/api/journal'
import {
  useJournalNotes,
  useCreateJournalNoteMutation,
  useUpdateJournalNoteMutation,
  useDeleteJournalNoteMutation,
} from '@/hooks/useJournal'
import { formatTime } from '@/lib/journal-utils'

interface Props {
  entryId: number
}

export interface NotesSectionHandle {
  focusNewNote: () => void
}

export const NotesSection = forwardRef<NotesSectionHandle, Props>(function NotesSection({ entryId }, ref) {
  const { data: notes = [] } = useJournalNotes(entryId)
  const createNote = useCreateJournalNoteMutation(entryId)
  const updateNote = useUpdateJournalNoteMutation(entryId)
  const deleteNote = useDeleteJournalNoteMutation(entryId)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focusNewNote: () => inputRef.current?.focus(),
  }))

  function addNote(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    createNote.mutate(text, { onSuccess: () => inputRef.current?.focus() })
    setDraft('')
  }

  function startEdit(note: JournalNoteResponseDto) {
    setEditingId(note.id)
    setEditingText(note.content)
  }

  function commitEdit(noteId: number, original: string) {
    const text = editingText.trim()
    if (text && text !== original) {
      updateNote.mutate({ id: noteId, content: text })
    }
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  return (
    <section className="card notes-section">
      <ol className="log-list">
        {notes.length === 0 && (
          <li className="j-empty">No notes yet — capture anything below.</li>
        )}
        {notes.map(note => (
          <li key={note.id} className="log-entry">
            <div className="log-time">{formatTime(note.createdAt)}</div>
            {editingId === note.id ? (
              <input
                className="note-edit"
                value={editingText}
                autoFocus
                onChange={e => setEditingText(e.target.value)}
                onBlur={() => commitEdit(note.id, note.content)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(note.id, note.content) }
                  if (e.key === 'Escape') cancelEdit()
                }}
              />
            ) : (
              <div className="note-text" onDoubleClick={() => startEdit(note)}>
                {note.content}
              </div>
            )}
            <button
              className="todo-x"
              onClick={() => deleteNote.mutate(note.id)}
              aria-label="Delete note"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </li>
        ))}
      </ol>

      <form className="add-row" onSubmit={addNote}>
        <span className="add-plus">›</span>
        <input
          ref={inputRef}
          className="add-input"
          placeholder="Add a note… Press Enter to save"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={createNote.isPending}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDraft(''); inputRef.current?.blur() }
          }}
        />
      </form>
    </section>
  )
})
