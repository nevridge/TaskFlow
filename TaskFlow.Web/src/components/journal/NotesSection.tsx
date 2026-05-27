import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useUpdateNotesMutation } from '@/hooks/useJournal'

interface Props {
  entryId: number
  entryTitle: string
  initialValue: string | null | undefined
}

export interface NotesSectionHandle {
  focusNotes: () => void
}

export const NotesSection = forwardRef<NotesSectionHandle, Props>(function NotesSection({ entryId, entryTitle, initialValue }, ref) {
  const [value, setValue] = useState(initialValue ?? '')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const updateNotes = useUpdateNotesMutation(entryId, entryTitle)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focusNotes: () => textareaRef.current?.focus(),
  }))

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [entryId])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    setValue(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateNotes.mutate(next, { onSuccess: () => setSavedAt(Date.now()) })
    }, 600)
  }

  const wordCount = value.trim().split(/\s+/).filter(Boolean).length

  return (
    <section className="card notes-section">
      <div className="card-hdr">
        <h2 className="card-title">Notes</h2>
        <div className="card-meta">
          <span className="word-count">{wordCount} words</span>
          {savedAt && <span className="saved">Saved</span>}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className="notes-area"
        placeholder="Free-form notes for the day — observations, decisions, follow-ups, anything."
        value={value}
        onChange={handleChange}
        onKeyDown={e => {
          if (e.key === 'Escape') textareaRef.current?.blur()
        }}
      />
    </section>
  )
})
