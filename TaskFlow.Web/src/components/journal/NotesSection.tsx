import { useState, useRef, useEffect, useLayoutEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import type { RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deleteJournalNote } from '@/api/journal'
import type { JournalNoteResponseDto } from '@/api/journal'
import {
  useJournalNotes,
  useCreateJournalNoteMutation,
  useUpdateJournalNoteMutation,
  journalKeys,
} from '@/hooks/useJournal'
import { useTapToEditBlock } from '@/hooks/useTapToEditBlock'
import { isCoarsePointer } from '@/lib/pointer'
import { formatTime } from '@/lib/journal-utils'
import { useUndoableDelete } from '@/hooks/useUndoableDelete'
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

/** Note body as a text-like button: tap (touch), double-click (mouse) or Enter/Space (keyboard) starts editing. */
function NoteText({ note, onEdit }: { note: JournalNoteResponseDto; onEdit: () => void }) {
  const tap = useTapToEditBlock(onEdit)
  return (
    <div {...tap} className={`note-text ${tap.className}`} data-note-id={note.id}>
      <NoteContent text={note.content} />
    </div>
  )
}

// Keeps the soft keyboard up while a Save/Cancel button is pressed: a button that takes focus blurs the textarea.
const keepFocus = {
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
}

interface NoteActionsProps {
  saveDisabled: boolean
  onCancel: () => void
  onSave: () => void
}

/** Touch-only Save/Cancel row, Cancel first so Save sits at the right edge. */
function NoteActions({ saveDisabled, onCancel, onSave }: NoteActionsProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Bring the buttons above the soft keyboard when the row appears (not sticky: it stays in the flow).
  useLayoutEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  return (
    <div className="note-actions" ref={ref}>
      <button type="button" className="note-action-cancel" {...keepFocus} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="note-action-save" {...keepFocus} onClick={onSave} disabled={saveDisabled}>
        Save
      </button>
    </div>
  )
}

export const NotesSection = forwardRef<NotesSectionHandle, Props>(function NotesSection({ entryId }, ref) {
  const { data: allNotes = [] } = useJournalNotes(entryId)
  const queryClient = useQueryClient()
  const { requestDelete, isHidden } = useUndoableDelete()
  // Notes waiting out the undo window stay in the cache but are not shown.
  const notes = useMemo(() => allNotes.filter(n => !isHidden(`note:${n.id}`)), [allNotes, isHidden])
  const createNote = useCreateJournalNoteMutation(entryId)
  const updateNote = useUpdateJournalNoteMutation(entryId)

  // Decided once per mount because it changes the rendered DOM (buttons, placeholder, Enter). The edit trigger
  // decides per event instead, so a hybrid device can differ between the two. That is accepted, not a bug.
  const [touch] = useState(() => isCoarsePointer())

  const [draft, setDraft] = useState('')
  const [draftFocused, setDraftFocused] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  // Guards against double-handling an edit session (e.g. Enter then blur, Escape then blur)
  const committedRef = useRef(false)
  // Note whose text should regain focus after the next render; expires after 100ms.
  const pendingFocus = useRef<number | null>(null)
  const [, setFocusTick] = useState(0)

  useEffect(() => {
    const id = pendingFocus.current
    if (id == null) return
    sectionRef.current?.querySelector<HTMLElement>(`[data-note-id="${id}"]`)?.focus()
  })

  function requestFocus(id: number) {
    pendingFocus.current = id
    setFocusTick(t => t + 1)
    window.setTimeout(() => {
      if (pendingFocus.current === id) pendingFocus.current = null
    }, 100)
  }

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

  function cancelDraft() {
    setDraft('')
    inputRef.current?.blur()
  }

  function removeNote(note: JournalNoteResponseDto) {
    const next = notes[notes.findIndex(n => n.id === note.id) + 1]
    const nextButton = next
      ? sectionRef.current?.querySelector<HTMLElement>(`[data-note-x="${next.id}"]`)
      : null
    ;(nextButton ?? inputRef.current)?.focus()
    const section = sectionRef.current
    requestDelete({
      key: `note:${note.id}`,
      message: 'Note deleted',
      errorMessage: "Couldn't delete. Restored.",
      commit: () => deleteJournalNote(entryId, note.id),
      invalidate: () => queryClient.invalidateQueries({ queryKey: journalKeys.notes(entryId) }),
      restoreFocus: () => section?.querySelector<HTMLElement>(`[data-note-x="${note.id}"]`)?.focus(),
    })
  }

  function startEdit(note: JournalNoteResponseDto) {
    committedRef.current = false
    setEditingId(note.id)
    setEditingText(note.content)
  }

  function commitEdit(noteId: number, original: string, via: 'blur' | 'key' | 'button' = 'key') {
    if (committedRef.current) return
    committedRef.current = true
    const text = editingText.trim()
    if (text && text !== original) {
      updateNote.mutate({ id: noteId, content: text })
    }
    setEditingId(null)
    if (via !== 'blur') requestFocus(noteId)
  }

  function cancelEdit(noteId: number) {
    if (committedRef.current) return
    committedRef.current = true
    setEditingId(null)
    requestFocus(noteId)
  }

  const showDraftActions = touch && (draft.trim() !== '' || draftFocused)

  return (
    <section className="card notes-section" ref={sectionRef}>
      <ol className="log-list">
        {notes.length === 0 && (
          <li className="j-empty">No notes yet — capture anything below.</li>
        )}
        {notes.map(note => (
          <li key={note.id} className="log-entry note-entry">
            <div className="log-time">{formatTime(note.createdAt)}</div>
            {editingId === note.id ? (
              <div className="note-edit-wrap">
                <textarea
                  ref={editRef}
                  className="note-edit"
                  aria-label="Edit note"
                  rows={1}
                  maxLength={MAX_NOTE_LENGTH}
                  value={editingText}
                  autoFocus
                  onFocus={e => {
                    const end = e.currentTarget.value.length
                    e.currentTarget.setSelectionRange(end, end)
                  }}
                  onChange={e => setEditingText(e.target.value)}
                  onBlur={() => commitEdit(note.id, note.content, 'blur')}
                  onKeyDown={e => {
                    // On touch Enter is a newline; Ctrl/Cmd+Enter (hardware keyboard) saves.
                    const save = touch ? e.ctrlKey || e.metaKey : !e.shiftKey
                    if (e.key === 'Enter' && save && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      commitEdit(note.id, note.content)
                    }
                    if (e.key === 'Escape') cancelEdit(note.id)
                  }}
                />
                {touch && (
                  <NoteActions
                    saveDisabled={!editingText.trim()}
                    onCancel={() => cancelEdit(note.id)}
                    onSave={() => commitEdit(note.id, note.content, 'button')}
                  />
                )}
              </div>
            ) : (
              <NoteText note={note} onEdit={() => startEdit(note)} />
            )}
            <button
              className="todo-x"
              data-note-x={note.id}
              onClick={() => removeNote(note)}
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
          placeholder={touch ? 'Add a note' : 'Add a note… Enter to save, Shift+Enter for new line'}
          enterKeyHint={touch ? 'enter' : undefined}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          // Disabling would blur the field and close the soft keyboard mid-capture, so touch never does.
          disabled={!touch && createNote.isPending}
          onFocus={() => setDraftFocused(true)}
          // The draft survives blur on touch (switching apps); saving is explicit.
          onBlur={() => setDraftFocused(false)}
          onKeyDown={e => {
            const save = touch ? e.ctrlKey || e.metaKey : !e.shiftKey
            if (e.key === 'Enter' && save && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submitDraft()
            }
            if (e.key === 'Escape') cancelDraft()
          }}
        />
        {showDraftActions && (
          <NoteActions saveDisabled={!draft.trim()} onCancel={cancelDraft} onSave={submitDraft} />
        )}
      </form>
    </section>
  )
})
