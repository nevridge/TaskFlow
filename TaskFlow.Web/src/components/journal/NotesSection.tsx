import { useState, useEffect, useRef } from 'react'
import { useUpdateNotesMutation } from '@/hooks/useJournal'

interface Props {
  entryId: number
  entryTitle: string
  initialValue: string | null | undefined
}

export function NotesSection({ entryId, entryTitle, initialValue }: Props) {
  const [value, setValue] = useState(initialValue ?? '')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const updateNotes = useUpdateNotesMutation(entryId, entryTitle)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external value when entry changes (e.g., navigating to a different date)
  useEffect(() => {
    setValue(initialValue ?? '')
    setSavedAt(null)
  }, [entryId, initialValue])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    setValue(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateNotes.mutate(next, { onSuccess: () => setSavedAt(Date.now()) })
    }, 600)
  }

  const wordCount = (value ?? '').trim().split(/\s+/).filter(Boolean).length

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
        className="notes-area"
        placeholder="Free-form notes for the day — observations, decisions, follow-ups, anything."
        value={value}
        onChange={handleChange}
      />
    </section>
  )
}
