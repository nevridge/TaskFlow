import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import type { JournalLogEntryResponseDto } from '@/api/journal'
import { useAddLogEntryMutation, useDeleteLogEntryMutation, useUpdateLogEntryMutation } from '@/hooks/useJournal'
import { formatTime } from '@/lib/journal-utils'
import { TaskTypeahead } from './TaskTypeahead'

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
  const updateLog = useUpdateLogEntryMutation(entryId)

  const [draft, setDraft] = useState('')
  const [draftTaskItemId, setDraftTaskItemId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focusDraftInput: () => inputRef.current?.focus(),
  }))

  function addEntry(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    addLog.mutate(
      { content: text, taskItemId: draftTaskItemId },
      {
        onSuccess: () => {
          inputRef.current?.focus()
          setDraftTaskItemId(null)
        },
      },
    )
    setDraft('')
  }

  function handleTaskLink(logEntry: JournalLogEntryResponseDto, taskItemId: number | null) {
    updateLog.mutate({ id: logEntry.id, content: logEntry.content, taskItemId })
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
            <div className="log-body">
              <div className="log-text">{en.content}</div>
              <div className="log-task-row">
                {en.linkedTaskDeleted ? (
                  <span className="log-task-deleted-badge">
                    {en.linkedTaskTitle} (deleted)
                  </span>
                ) : en.linkedTaskTitle ? (
                  <span className="log-task-chip">{en.linkedTaskTitle}</span>
                ) : null}
                <TaskTypeahead
                  value={en.taskItemId ?? null}
                  onChange={taskItemId => handleTaskLink(en, taskItemId)}
                />
              </div>
            </div>
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

      <form className="add-row log-add-row" onSubmit={addEntry}>
        <span className="add-plus">›</span>
        <div className="log-add-inputs">
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
          <TaskTypeahead value={draftTaskItemId} onChange={setDraftTaskItemId} onEscape={() => inputRef.current?.focus()} />
        </div>
        {/* Hidden submit button so Enter in the log text input submits the form
            even though the TaskTypeahead adds a second <input> to the form.
            Without this, the HTML implicit-submission rule blocks Enter. */}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
      </form>
    </section>
  )
})
