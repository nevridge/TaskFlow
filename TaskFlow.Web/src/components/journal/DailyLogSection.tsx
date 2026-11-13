import { useState, useRef, useEffect, useLayoutEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deleteLogEntry } from '@/api/journal'
import type { JournalLogEntryResponseDto } from '@/api/journal'
import { useAddLogEntryMutation, useUpdateLogEntryMutation, journalKeys } from '@/hooks/useJournal'
import { useUndoableDelete } from '@/hooks/useUndoableDelete'
import { useTapToEditBlock } from '@/hooks/useTapToEditBlock'
import { useStackedLayout } from '@/hooks/useStackedLayout'
import { isCoarsePointer } from '@/lib/pointer'
import { formatTime } from '@/lib/journal-utils'
import { TaskTypeahead } from './TaskTypeahead'

interface Props {
  entryId: number
  logEntries: JournalLogEntryResponseDto[]
}

export interface DailyLogSectionHandle {
  focusDraftInput: () => void
}

// Matches the backend cap on log content; used for both create and edit.
const MAX_LOG_LENGTH = 2000

/** Log text as a text-like button: tap (touch), double-click (mouse) or Enter/Space (keyboard) starts editing. */
function LogText({ id, content, onEdit }: { id: number; content: string; onEdit: () => void }) {
  const tap = useTapToEditBlock(onEdit)
  return (
    <div {...tap} className={`log-text ${tap.className}`} data-log-id={id}>
      {content}
    </div>
  )
}

export const DailyLogSection = forwardRef<DailyLogSectionHandle, Props>(function DailyLogSection({ entryId, logEntries: allLogEntries }, ref) {
  const addLog = useAddLogEntryMutation(entryId)
  const queryClient = useQueryClient()
  const { requestDelete, isHidden } = useUndoableDelete()
  // Entries waiting out the undo window stay in the cache but are not shown or counted.
  // Shown newest first. The API returns oldest first, so sort a copy: createdAt desc, then id desc; an
  // unparsable createdAt falls back to id desc. Render, the focus lookups and removeEntry all read this array.
  const logEntries = useMemo(
    () =>
      allLogEntries
        .filter(l => !isHidden(`log:${l.id}`))
        .sort((a, b) => {
          const ta = Date.parse(a.createdAt)
          const tb = Date.parse(b.createdAt)
          if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta
          return b.id - a.id
        }),
    [allLogEntries, isHidden],
  )
  const updateLog = useUpdateLogEntryMutation(entryId)

  // Decided once per mount because it changes whether the field is disabled while saving (disabling would
  // blur it and close the soft keyboard). The edit trigger decides per event instead, so a hybrid device can
  // differ between the two. That is accepted, not a bug.
  const [touch] = useState(() => isCoarsePointer())

  const [draft, setDraft] = useState('')
  const [draftTaskItemId, setDraftTaskItemId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Set after a successful add until the new newest entry has rendered and the list has been scrolled to the top.
  const scrollToTopPending = useRef(false)
  // The input is disabled while an add is pending (desktop), and focus() on a disabled field does nothing, so
  // the focus the callbacks ask for is repeated once the mutation has settled and the field is enabled again.
  const refocusInput = useRef(false)
  const stacked = useStackedLayout()
  // Latest props for event handlers: a relink and a text edit are both full-row PUTs, so each must send the
  // other field's current value, not one captured when the row rendered.
  const logEntriesRef = useRef(logEntries)
  // Latest draft for the add-failure restore, which must not overwrite text typed while the save was in flight.
  const draftRef = useRef(draft)
  useEffect(() => {
    logEntriesRef.current = logEntries
    draftRef.current = draft
  })
  // Set once the text edit has been committed or cancelled, so a following blur does nothing.
  const committedRef = useRef(false)
  // Log entry whose text should regain focus after the next render; expires after 100ms.
  const pendingFocus = useRef<number | null>(null)
  const [, setFocusTick] = useState(0)

  useEffect(() => {
    const id = pendingFocus.current
    if (id == null) return
    sectionRef.current?.querySelector<HTMLElement>(`[data-log-id="${id}"]`)?.focus()
  })

  const newestId = logEntries[0]?.id
  useEffect(() => {
    if (!scrollToTopPending.current || !scrollRef.current) return
    scrollRef.current.scrollTop = 0
    scrollToTopPending.current = false
  }, [newestId])

  const addPending = addLog.isPending
  useEffect(() => {
    if (addPending || !refocusInput.current) return
    refocusInput.current = false
    inputRef.current?.focus()
  }, [addPending])

  // The region stops being focusable when the layout stacks; keep focus from dropping to the page.
  useLayoutEffect(() => {
    if (stacked && document.activeElement === scrollRef.current) inputRef.current?.focus()
  }, [stacked])

  function requestFocus(id: number) {
    pendingFocus.current = id
    setFocusTick(t => t + 1)
    window.setTimeout(() => {
      if (pendingFocus.current === id) pendingFocus.current = null
    }, 100)
  }

  useImperativeHandle(ref, () => ({
    focusDraftInput: () => inputRef.current?.focus(),
  }))

  function addEntry(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    const linkedTaskId = draftTaskItemId
    const newestAtSubmit = logEntriesRef.current[0]?.id
    addLog.mutate(
      { content: text, taskItemId: linkedTaskId },
      {
        onSuccess: () => {
          // The refetch can land before this runs; then the newest id has already changed and the effect below
          // has already run, so a flag set now would only fire on some later, unrelated change.
          scrollToTopPending.current = logEntriesRef.current[0]?.id === newestAtSubmit
          if (scrollRef.current) scrollRef.current.scrollTop = 0
          refocusInput.current = true
          inputRef.current?.focus()
        },
        // Put the text and link back if the save failed, unless something was typed since
        onError: () => {
          scrollToTopPending.current = false
          setDraft(current => current || text)
          if (!draftRef.current) {
            setDraftTaskItemId(linkedTaskId)
            refocusInput.current = true
            inputRef.current?.focus()
          }
        },
      },
    )
    // Reset the link with the text: on touch the field stays enabled while saving, so a quick second entry
    // must not inherit this one's task.
    setDraft('')
    setDraftTaskItemId(null)
  }

  function handleTaskLink(logId: number, taskItemId: number | null) {
    const live = logEntriesRef.current.find(l => l.id === logId)
    if (!live) return
    updateLog.mutate({ id: logId, content: live.content, taskItemId })
  }

  function removeEntry(en: JournalLogEntryResponseDto) {
    const next = logEntries[logEntries.findIndex(l => l.id === en.id) + 1]
    const nextButton = next
      ? sectionRef.current?.querySelector<HTMLElement>(`[data-log-x="${next.id}"]`)
      : null
    ;(nextButton ?? inputRef.current)?.focus()
    const section = sectionRef.current
    requestDelete({
      key: `log:${en.id}`,
      message: 'Log entry deleted',
      errorMessage: "Couldn't delete. Restored.",
      commit: () => deleteLogEntry(entryId, en.id),
      invalidate: () => queryClient.invalidateQueries({ queryKey: journalKeys.all }),
      restoreFocus: () => {
        if (section?.dataset.entryId !== String(entryId)) return
        section.querySelector<HTMLElement>(`[data-log-x="${en.id}"]`)?.focus()
      },
    })
  }

  function startEdit(en: JournalLogEntryResponseDto) {
    committedRef.current = false
    setEditingId(en.id)
    setEditingText(en.content)
  }

  function commitEdit(logId: number, via: 'blur' | 'key') {
    if (committedRef.current) return
    committedRef.current = true
    const text = editingText.trim()
    const live = logEntriesRef.current.find(l => l.id === logId)
    setEditingId(null)
    if (via !== 'blur') requestFocus(logId)
    // Empty or unchanged: keep the original. taskItemId is required by the API, so always send null, never undefined.
    if (!live || !text || text === live.content) return
    updateLog.mutate({ id: logId, content: text, taskItemId: live.taskItemId ?? null })
  }

  function cancelEdit(logId: number) {
    if (committedRef.current) return
    committedRef.current = true
    setEditingId(null)
    requestFocus(logId)
  }

  return (
    <section className="card log" ref={sectionRef} data-entry-id={entryId}>
      <div className="card-hdr">
        <h2 className="card-title">Daily Log</h2>
        <div className="card-meta">
          <span className="todo-count">
            {logEntries.length} {logEntries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </div>

      <form className="add-row log-add-row" onSubmit={addEntry}>
        <span className="add-plus">›</span>
        <input
          ref={inputRef}
          className="add-input"
          maxLength={MAX_LOG_LENGTH}
          enterKeyHint="enter"
          placeholder="What did you just work on? Press Enter to log"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          // Disabling would blur the field and close the soft keyboard mid-capture, so touch never does.
          disabled={!touch && addLog.isPending}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDraft(''); inputRef.current?.blur() }
          }}
        />
        <div className="log-add-inputs">
          <TaskTypeahead value={draftTaskItemId} onChange={setDraftTaskItemId} onEscape={() => inputRef.current?.focus()} />
          {/* The submit button also lets Enter in the text input submit the form even though the TaskTypeahead
              adds a second <input> (the HTML implicit-submission rule needs a submit button then). CSS hides it
              on desktop and shows it on touch. */}
          <button
            type="submit"
            className="log-add-btn"
            disabled={!draft.trim()}
            onPointerDown={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
          >
            Add
          </button>
        </div>
      </form>

      <div
        className="log-scroll"
        ref={scrollRef}
        role="region"
        aria-label="Daily log"
        tabIndex={stacked ? undefined : 0}
      >
      <ol className="log-list">
        {logEntries.length === 0 && (
          <li className="j-empty">No log entries yet — capture what you worked on above.</li>
        )}
        {logEntries.map(en => (
          <li key={en.id} className="log-entry">
            <div className="log-time">{formatTime(en.createdAt)}</div>
            <div className="log-body">
              {editingId === en.id ? (
                <input
                  type="text"
                  className="log-edit"
                  aria-label="Edit log entry"
                  maxLength={MAX_LOG_LENGTH}
                  enterKeyHint="done"
                  value={editingText}
                  autoFocus
                  onFocus={e => {
                    const end = e.currentTarget.value.length
                    e.currentTarget.setSelectionRange(end, end)
                  }}
                  onChange={e => setEditingText(e.target.value)}
                  onBlur={() => commitEdit(en.id, 'blur')}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      commitEdit(en.id, 'key')
                    }
                    if (e.key === 'Escape') cancelEdit(en.id)
                  }}
                />
              ) : (
                <LogText id={en.id} content={en.content} onEdit={() => startEdit(en)} />
              )}
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
                  onChange={taskItemId => handleTaskLink(en.id, taskItemId)}
                />
              </div>
            </div>
            <button
              className="todo-x"
              data-log-x={en.id}
              onClick={() => removeEntry(en)}
              aria-label="Delete entry"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </li>
        ))}
      </ol>
      </div>
    </section>
  )
})
