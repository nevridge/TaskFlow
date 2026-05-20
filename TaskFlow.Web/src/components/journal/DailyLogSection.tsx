import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import type { JournalLogEntryResponseDto } from '@/api/journal'
import { useAddLogEntryMutation, useDeleteLogEntryMutation } from '@/hooks/useJournal'
import { formatTime } from '@/lib/journal-utils'

interface Props {
  entryId: number
  logEntries: JournalLogEntryResponseDto[]
}

export interface DailyLogSectionHandle {
  focusDraftInput: () => void
}

export const DailyLogSection = forwardRef<DailyLogSectionHandle, Props>(function DailyLogSection({ entryId, logEntries }, ref) {
  const addLog = useAddLogEntryMutation(entryId)
  const deleteLog = useDeleteLogEntryMutation(entryId)

  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focusDraftInput: () => inputRef.current?.focus(),
  }))

  function addEntry(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    addLog.mutate(text, { onSuccess: () => inputRef.current?.focus() })
    setDraft('')
  }

  return (
    <section className="card log">
      <div className="card-hdr">
        <h2 className="card-title">Daily Log</h2>
        <div className="card-meta">
          <span className="todo-count">
            {logEntries.length} {logEntries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </div>

      <ol className="log-list">
        {logEntries.length === 0 && (
          <li className="j-empty">No log entries yet — capture what you worked on below.</li>
        )}
        {logEntries.map(en => (
          <li key={en.id} className="log-entry">
            <div className="log-time">{formatTime(en.createdAt)}</div>
            <div className="log-text">{en.content}</div>
            <button
              className="todo-x"
              onClick={() => deleteLog.mutate(en.id)}
              aria-label="Delete entry"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </li>
        ))}
      </ol>

      <form className="add-row" onSubmit={addEntry}>
        <span className="add-plus">›</span>
        <input
          ref={inputRef}
          className="add-input"
          placeholder="What did you just work on? Press Enter to log"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={addLog.isPending}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDraft(''); inputRef.current?.blur() }
          }}
        />
      </form>
    </section>
  )
})
