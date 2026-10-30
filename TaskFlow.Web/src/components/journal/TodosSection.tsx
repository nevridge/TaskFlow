import { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useTapToEdit } from '@/hooks/useTapToEdit'
import { removeJournalTodo } from '@/api/journal'
import type { TaskItemResponseDto } from '@/api/journal'
import type { SortMode } from '@/lib/prefs'
import { BlockIcon, BlockReasonInput, BlockedReasonText } from '@/components/BlockControls'
import { formatSubtaskProgress, getBlockErrorMessage, journalSortTier } from '@/lib/task-status'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import {
  useJournalTodos,
  useCreateTodoMutation,
  useToggleTodoMutation,
  useEditTodoMutation,
  useBlockTodoMutation,
  useUnblockTodoMutation,
  useEditBlockedReasonTodoMutation,
  openTodoCount,
  blockedTodoCount,
  journalKeys,
} from '@/hooks/useJournal'
import { useUndoableDelete } from '@/hooks/useUndoableDelete'
import { TodoBadges } from '@/components/journal/TodoBadges'
import { getErrorCode } from '@/lib/task-errors'
import { todayISO, formatMonthDay } from '@/lib/journal-utils'

const CheckSvg = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const HistorySvg = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8v5l3 2"/>
    <path d="M3.05 11a9 9 0 1 1 .5 4"/>
    <path d="M3 4v7h7"/>
  </svg>
)

const MAX_TOAST_TITLE = 30

function truncateTitle(title: string): string {
  return title.length > MAX_TOAST_TITLE ? `${title.slice(0, MAX_TOAST_TITLE)}…` : title
}

const todoKey = (entryId: number, id: number | string | undefined) => `todo:${entryId}:${id}`

const DeleteSvg = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>
)

/** Title as a text-like button: tap (touch), double-click (mouse) or Enter/Space (keyboard) starts editing. */
function TodoTitle({ id, title, onEdit }: { id: number; title: string; onEdit: () => void }) {
  const tap = useTapToEdit(onEdit)
  return (
    <button
      type="button"
      {...tap}
      className={`todo-text ${tap.className}`}
      data-todo-title={id}
    >
      {title}
    </button>
  )
}

interface Props {
  entryId: number
  isoDate: string
  sort: SortMode
}

export interface TodosSectionHandle {
  focusDraftInput: () => void
}

export const TodosSection = forwardRef<TodosSectionHandle, Props>(function TodosSection({ entryId, isoDate, sort }, ref) {
  const { data: todosData, isLoading } = useJournalTodos(entryId)
  const queryClient = useQueryClient()
  const { requestDelete, isHidden } = useUndoableDelete()
  // Deletes waiting out the undo window are filtered here (never written to the cache), before sort and counts.
  const todos = useMemo<TaskItemResponseDto[]>(() => {
    const all = (todosData?.data as TaskItemResponseDto[] | undefined) ?? []
    return all
      .filter(t => !isHidden(todoKey(entryId, t.id)))
      .map(t =>
        t.children?.some(c => isHidden(todoKey(entryId, c.id)))
          ? { ...t, children: t.children.filter(c => !isHidden(todoKey(entryId, c.id))) }
          : t,
      )
  }, [todosData, isHidden, entryId])

  const createTodo = useCreateTodoMutation(entryId, isoDate)
  const toggleTodo = useToggleTodoMutation(entryId)
  const editTodo = useEditTodoMutation(entryId)
  const blockTodo = useBlockTodoMutation(entryId)
  const unblockTodo = useUnblockTodoMutation(entryId)
  const editReason = useEditBlockedReasonTodoMutation(entryId)

  // Block flow: which row has the reason input open, and the text to restore after a failed save.
  const [blockingId, setBlockingId] = useState<number | null>(null)
  const [blockDraft, setBlockDraft] = useState('')
  const [reasonEditId, setReasonEditId] = useState<number | null>(null)
  const [liveMessage, setLiveMessage] = useState('')
  const submittingBlockRef = useRef(false)
  const sectionRef = useRef<HTMLElement>(null)
  // Focus target applied after the next render, by todo id (the row may re-sort).
  const pendingFocus = useRef<{ id: number; kind: 'check' | 'block' | 'reason' | 'title' } | null>(null)

  const [, setFocusTick] = useState(0)

  // Applied after every render while pending, because the optimistic update can re-sort the list a
  // moment after the action (and a moved row may lose focus). The request expires after 100ms.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    sectionRef.current?.querySelector<HTMLElement>(`[data-todo-${target.kind}="${target.id}"]`)?.focus()
  })

  function requestFocus(id: number, kind: 'check' | 'block' | 'reason' | 'title') {
    const request = { id, kind }
    pendingFocus.current = request
    setFocusTick(t => t + 1)
    window.setTimeout(() => {
      if (pendingFocus.current === request) pendingFocus.current = null
    }, 100)
  }

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [historyTask, setHistoryTask] = useState<TaskItemResponseDto | null>(null)
  const historyCloseRef = useRef<HTMLButtonElement | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const draftInputRef = useRef<HTMLInputElement>(null)
  // Set once the title edit has been committed or cancelled, so a following blur does nothing.
  const committedRef = useRef(false)

  useImperativeHandle(ref, () => ({
    focusDraftInput: () => draftInputRef.current?.focus(),
  }))

  // Declared before the effect that moves focus into the sheet, so the opener is captured first.
  useFocusTrap(modalRef, !!historyTask, { fallbackRef: sectionRef })

  useEffect(() => {
    if (!historyTask) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    historyCloseRef.current?.focus()

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryTask(null)
      }
    }

    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = previousOverflow
    }
  }, [historyTask])

  const today = todayISO()
  const isPastDay = isoDate < today

  const sorted = useMemo(() => {
    const arr = [...todos]
    if (sort === 'open first' || sort === 'done last') {
      // Tiers: open, blocked, completed. Array.sort is stable, so order within a tier is kept.
      arr.sort((a, b) => journalSortTier(a.status) - journalSortTier(b.status))
    }
    return arr
  }, [todos, sort])

  const remaining = openTodoCount(todos)
  const blockedCount = blockedTodoCount(todos)
  const total = todos.length

  function addTodo(e: React.FormEvent) {
    e.preventDefault()
    setActionError(null)
    if (isPastDay) {
      setActionError('You cannot create new tasks on a past journal day.')
      return
    }

    const text = draft.trim()
    if (!text) return
    createTodo.mutate(text, {
      onSuccess: () => setDraft(''),
      onError: err => setActionError(getTaskActionErrorMessage(err)),
    })
  }

  function toggle(todo: TaskItemResponseDto) {
    setActionError(null)
    const isDone = todo.status === 'Completed'
    const isChild = todo.parentTaskItemId != null
    toggleTodo.mutate(
      {
        id: Number(todo.id),
        done: !isDone,
        // Subtask completion must never auto-complete the parent in the journal UI
        ...(isChild && { autoCompleteParentWhenChildrenDone: false }),
      },
      { onError: err => setActionError(getTaskActionErrorMessage(err)) }
    )
  }

  function openBlock(todo: TaskItemResponseDto) {
    setActionError(null)
    setReasonEditId(null)
    setBlockDraft('')
    setBlockingId(Number(todo.id))
  }

  function closeReasonInput(id: number, via: 'escape' | 'blur') {
    setBlockingId(null)
    setReasonEditId(null)
    // Esc returns to the control that opened the input; blur leaves focus where the user put it.
    if (via === 'escape') requestFocus(id, blockingId === id ? 'block' : 'reason')
  }

  function submitBlock(todo: TaskItemResponseDto, reason: string) {
    if (submittingBlockRef.current) return
    submittingBlockRef.current = true
    const id = Number(todo.id)
    setBlockingId(null)
    requestFocus(id, 'check')
    blockTodo.mutate(
      { id, reason },
      {
        onSuccess: () => setLiveMessage(`Task blocked: ${todo.title}`),
        onError: err => {
          // Re-open the input with the typed text so nothing is lost; its autoFocus takes the focus.
          pendingFocus.current = null
          setBlockDraft(reason)
          setBlockingId(id)
          setActionError(getTaskActionErrorMessage(err))
        },
        onSettled: () => { submittingBlockRef.current = false },
      },
    )
  }

  function unblock(todo: TaskItemResponseDto) {
    setActionError(null)
    const id = Number(todo.id)
    requestFocus(id, 'check')
    unblockTodo.mutate(
      { id },
      {
        onSuccess: () => setLiveMessage(`Task unblocked: ${todo.title}`),
        onError: err => setActionError(getTaskActionErrorMessage(err)),
      },
    )
  }

  function saveReason(todo: TaskItemResponseDto, reason: string) {
    const id = Number(todo.id)
    setReasonEditId(null)
    requestFocus(id, 'check')
    if (reason === (todo.blockedReason ?? '')) return
    editReason.mutate({ id, reason }, { onError: err => setActionError(getTaskActionErrorMessage(err)) })
  }

  function startEdit(todo: TaskItemResponseDto) {
    committedRef.current = false
    setEditingId(Number(todo.id))
    setEditingText(todo.title ?? '')
  }

  function finishEdit(via: 'enter' | 'escape' | 'blur') {
    if (committedRef.current || editingId == null) return
    committedRef.current = true
    const id = editingId
    const text = editingText.trim()
    if (via !== 'escape' && text) {
      editTodo.mutate({ id, title: text })
    }
    setEditingId(null)
    setEditingText('')
    // Enter and Escape return focus to the title; a blur leaves focus where the user put it. Deferred so the
    // still-pending keypress of this Enter cannot land on the freshly mounted title button and re-activate it.
    if (via !== 'blur') window.setTimeout(() => requestFocus(id, 'title'), 0)
  }

  /** Hides the row at once and removes it from the day after the undo window. */
  function removeFromDay(td: TaskItemResponseDto, isChild: boolean, siblings: TaskItemResponseDto[]) {
    const id = Number(td.id)
    setActionError(null)
    // Pick the focus target first: the next sibling's delete button, else the add input.
    const next = siblings[siblings.findIndex(s => s.id === td.id) + 1]
    const nextButton = next
      ? sectionRef.current?.querySelector<HTMLElement>(`[data-todo-x="${next.id}"]`)
      : null
    ;(nextButton ?? draftInputRef.current)?.focus()
    const section = sectionRef.current
    requestDelete({
      key: todoKey(entryId, id),
      hideKeys: (td.children ?? []).map(c => todoKey(entryId, c.id)),
      message: isChild
        ? 'Removed from this day'
        : `Removed from this day: "${truncateTitle(td.title ?? '')}"`,
      errorMessage: "Couldn't remove from day. Restored.",
      commit: () => removeJournalTodo(entryId, id),
      invalidate: () => queryClient.invalidateQueries({ queryKey: journalKeys.todos(entryId) }),
      restoreFocus: () => {
        // Skip when the section now shows another day: task ids can repeat across entries.
        if (section?.dataset.entryId !== String(entryId)) return
        section.querySelector<HTMLElement>(`[data-todo-x="${id}"]`)?.focus()
      },
    })
  }

  /** Controls shared by top-level todos and subtasks. */
  function renderRow(td: TaskItemResponseDto, isChild: boolean, siblings: TaskItemResponseDto[]) {
    const id = Number(td.id)
    const isDone = td.status === 'Completed'
    const isBlocked = td.status === 'Blocked'
    const canBlock = td.status === 'Todo'
    const childIsFuture = isChild && !!td.currentJournalDate && td.currentJournalDate > isoDate
    return (
      <>
        <button
          className="todo-check"
          data-todo-check={id}
          onClick={() => toggle(td)}
          aria-label={isDone ? 'Mark not done' : isBlocked ? 'Mark done (blocked)' : 'Mark done'}
        >
          {isDone && <CheckSvg />}
          {isBlocked && <BlockIcon size={isChild ? 9 : 11} />}
        </button>

        {td.id !== undefined && td.id !== null && (
          <span className="todo-id" aria-label={`Task ${td.id}`} role="img">#{td.id}</span>
        )}

        {editingId === id ? (
          <input
            className="todo-edit"
            value={editingText}
            autoFocus
            enterKeyHint="done"
            onChange={e => setEditingText(e.target.value)}
            onBlur={() => finishEdit('blur')}
            onKeyDown={e => {
              if (e.key === 'Enter') finishEdit('enter')
              if (e.key === 'Escape') finishEdit('escape')
            }}
          />
        ) : (
          <TodoTitle id={id} title={td.title ?? ''} onEdit={() => startEdit(td)} />
        )}

        {/* Two lines on phones (actions left, badges right). Above 480px .todo-subline and .todo-subline-actions are
            display: contents, while .todo-subline-meta is a display: flex full-width line beneath the title. */}
        <div className="todo-subline">
          {/* Actions come first in the DOM so that, above 480px, they stay on the title line while the
              metadata wraps beneath it. DOM order is the visual and Tab order at every width. */}
          <div className="todo-subline-actions">
            <button
              className="todo-history"
              onClick={() => setHistoryTask(td)}
              aria-label={isChild ? 'View history' : 'History'}
            >
              <HistorySvg />
            </button>

            {canBlock && blockingId !== id && (
              <button
                type="button"
                className="todo-block"
                data-todo-block={id}
                aria-label="Block"
                title="Block"
                onClick={() => openBlock(td)}
              >
                <BlockIcon />
              </button>
            )}

            {!(isChild && childIsFuture) && (
              <button
                className="todo-x"
                data-todo-x={id}
                onClick={() => removeFromDay(td, isChild, siblings)}
                aria-label={isChild ? 'Remove from day' : `Remove from day: ${td.title ?? ''}`}
                title={isChild ? undefined : `Remove from day: ${td.title ?? ''}`}
              >
                <DeleteSvg />
              </button>
            )}
          </div>

          <div className="todo-subline-meta">
            {childIsFuture && td.currentJournalDate && (
              <span className="todo-future-badge">{formatMonthDay(td.currentJournalDate)}</span>
            )}

            {!isChild && td.children && td.children.length > 0 && (
              <span className="todo-subprogress">
                {formatSubtaskProgress(
                  td.children.filter(c => c.status === 'Completed').length,
                  td.children.length,
                  td.children.filter(c => c.status === 'Blocked').length,
                )}
              </span>
            )}

            <TodoBadges priority={td.priority} projectName={td.projectName} />

            {isBlocked && (
              <button
                type="button"
                className="todo-blocked-badge"
                aria-label="Unblock task"
                title="Unblock task"
                onClick={() => unblock(td)}
              >
                <BlockIcon size={11} />
                <span className="todo-blocked-badge-text">Blocked</span>
              </button>
            )}
          </div>
        </div>

        {blockingId === id && (
          <BlockReasonInput
            className="todo-block-input"
            initialValue={blockDraft}
            onSubmit={reason => submitBlock(td, reason)}
            onCancel={(_reason, via) => closeReasonInput(id, via)}
          />
        )}
        {isBlocked && reasonEditId === id && (
          <BlockReasonInput
            className="todo-block-input"
            initialValue={td.blockedReason ?? ''}
            onSubmit={reason => saveReason(td, reason)}
            onCancel={(_reason, via) => closeReasonInput(id, via)}
          />
        )}
        {isBlocked && reasonEditId !== id && (
          <BlockedReasonText
            className="todo-block-reason"
            data-todo-reason={id}
            reason={td.blockedReason ?? ''}
            onEdit={() => setReasonEditId(id)}
          />
        )}
      </>
    )
  }

  return (
    <section
      className="card todos"
      ref={sectionRef}
      data-entry-id={entryId}
      tabIndex={-1}
      // New user input supersedes a pending focus request.
      onPointerDownCapture={() => { pendingFocus.current = null }}
      onKeyDownCapture={() => { pendingFocus.current = null }}
    >
      <div className="card-hdr">
        <h2 className="card-title">TODOs</h2>
        <div className="card-meta">
          <span className="todo-count">{total - remaining}/{total}</span>
          {blockedCount > 0 && <span className="todo-count">{`· ${blockedCount} blocked`}</span>}
        </div>
      </div>

      {/* Persistent polite live region: present before any text is announced. */}
      <div role="status" className="sr-only">{liveMessage}</div>

      {isLoading ? (
        <p className="j-empty">Loading…</p>
      ) : (
        <ul className="todo-list">
          {sorted.length === 0 && (
            <li className="j-empty">No TODOs yet — add one below.</li>
          )}
          {sorted.map(td => {
            const isDone = td.status === 'Completed'
            const isBlocked = td.status === 'Blocked'
            return (
              <li key={td.id} className={'todo' + (isDone ? ' is-done' : '') + (isBlocked ? ' is-blocked' : '')}>
                {renderRow(td, false, sorted)}

                {td.children && td.children.length > 0 && (
                  <ul className="todo-child-list">
                    {td.children.map(child => {
                      const childDone = child.status === 'Completed'
                      const childBlocked = child.status === 'Blocked'
                      const childIsFuture =
                        !!child.currentJournalDate && child.currentJournalDate > isoDate
                      return (
                        <li
                          key={child.id}
                          className={
                            'todo todo-child' +
                            (childDone ? ' is-done' : '') +
                            (childBlocked ? ' is-blocked' : '') +
                            (childIsFuture ? ' is-future' : '')
                          }
                        >
                          {renderRow(child, true, td.children ?? [])}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {actionError && <p className="todo-error" role="alert">{actionError}</p>}

      {isPastDay && (
        <p className="todo-helper">Cannot add tasks to past days. Completed tasks remain as history for this date.</p>
      )}

      <form className="add-row" onSubmit={addTodo}>
        <span className="add-plus">+</span>
        <input
          ref={draftInputRef}
          className="add-input"
          placeholder={isPastDay ? 'Adding tasks is disabled for past dates' : 'Add a TODO and press Enter'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={createTodo.isPending || isPastDay}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDraft(''); draftInputRef.current?.blur() }
          }}
        />
      </form>

      {historyTask && (
        <>
          <div className="sheet-backdrop j-modal-backdrop" onClick={() => setHistoryTask(null)} aria-hidden="true" />
          <div ref={modalRef} className="sheet j-modal" role="dialog" aria-modal="true" aria-labelledby="journal-task-history-title">
            <div className="sheet-header j-modal-header">
              <div>
                <h3 id="journal-task-history-title" className="j-modal-title">Task history</h3>
                <p className="j-modal-subtitle">{historyTask.title}</p>
              </div>
              <button ref={historyCloseRef} type="button" className="sheet-close j-modal-close" onClick={() => setHistoryTask(null)}>Close</button>
            </div>
            <TaskHistoryPanel taskId={Number(historyTask.id)} />
          </div>
        </>
      )}
    </section>
  )
})

function getTaskActionErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED') {
    return 'Completed tasks assigned to past days cannot be reopened.'
  }
  if (code === 'TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED') {
    return 'This task cannot be assigned to a past day.'
  }
  const blockMessage = getBlockErrorMessage(code)
  if (blockMessage) return blockMessage
  return 'Unable to save task changes. Please try again.'
}
