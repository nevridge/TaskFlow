import { useState, useRef, useLayoutEffect, forwardRef, useImperativeHandle } from 'react'
import type { RefObject } from 'react'
import type { JournalNoteResponseDto } from '@/api/journal'
import {
  useJournalNotes,
  useCreateJournalNoteMutation,
  useUpdateJournalNoteMutation,
  useDeleteJournalNoteMutation,
} from '@/hooks/useJournal'
import { formatTime } from '@/lib/journal-utils'
import { NoteContent } from './NoteContent'

interface Props {
  entryId: number
}

export interface NotesSectionHandle {
  focusNewNote: () => void
}

const MAX_NOTE_LENGTH = 2000

// Grows a textarea to fit its content (capped via CSS max-height)
function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, active = true) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value, active])
}

export const NotesSection = forwardRef<NotesSectionHandle, Props>(function NotesSection({ entryId }, ref) {
  const { data: notes = [] } = useJournalNotes(entryId)
  const createNote = useCreateJournalNoteMutation(entryId)
  const updateNote = useUpdateJournalNoteMutation(entryId)
  const deleteNote = useDeleteJournalNoteMutation(entryId)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  // Guards against double-handling an edit session (e.g. Enter then blur, Escape then blur)
  const committedRef = useRef(false)

  useAutoGrow(inputRef, draft)
  useAutoGrow(editRef, editingText, editingId !== null)

  useImperativeHandle(ref, () => ({
    focusNewNote: () => inputRef.current?.focus(),
  }))

  function addNote(e: React.FormEvent) {
    e.preventDefault()
    submitDraft()
  }

  function submitDraft() {
    const text = draft.trim()
    if (!text) return
    createNote.mutate(text, {
      onSuccess: () => inputRef.current?.focus(),
      // Put the text back if the save failed, unless something was typed since
      onError: () => setDraft(current => current || text),
    })
    setDraft('')
  }

  function startEdit(note: JournalNoteResponseDto) {
    committedRef.current = false
    setEditingId(note.id)
    setEditingText(note.content)
  }

  function commitEdit(noteId: number, original: string) {
    if (committedRef.current) return
    committedRef.current = true
    const text = editingText.trim()
    if (text && text !== original) {
      updateNote.mutate({ id: noteId, content: text })
    }
    setEditingId(null)
  }

  function cancelEdit() {
    if (committedRef.current) return
    committedRef.current = true
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
              <textarea
                ref={editRef}
                className="note-edit"
                rows={1}
                maxLength={MAX_NOTE_LENGTH}
                value={editingText}
                autoFocus
                onFocus={e => {
                  const end = e.currentTarget.value.length
                  e.currentTarget.setSelectionRange(end, end)
                }}
                onChange={e => setEditingText(e.target.value)}
                onBlur={() => commitEdit(note.id, note.content)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    commitEdit(note.id, note.content)
                  }
                  if (e.key === 'Escape') cancelEdit()
                }}
              />
            ) : (
              <div className="note-text" onDoubleClick={() => startEdit(note)}>
                <NoteContent text={note.content} />
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
        <textarea
          ref={inputRef}
          className="add-input note-add-input"
          rows={1}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Add a note… Enter to save, Shift+Enter for new line"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={createNote.isPending}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submitDraft()
            }
            if (e.key === 'Escape') { setDraft(''); inputRef.current?.blur() }
          }}
        />
      </form>
    </section>
  )
})
