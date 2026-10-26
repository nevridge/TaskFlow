import { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
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
  useRemoveTodoMutation,
  useBlockTodoMutation,
  useUnblockTodoMutation,
  useEditBlockedReasonTodoMutation,
  openTodoCount,
  blockedTodoCount,
} from '@/hooks/useJournal'
import { TodoBadges } from '@/components/journal/TodoBadges'
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

const DeleteSvg = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>
)

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
  const todos = useMemo<TaskItemResponseDto[]>(
    () => (todosData?.data as TaskItemResponseDto[] | undefined) ?? [],
    [todosData],
  )

  const createTodo = useCreateTodoMutation(entryId, isoDate)
  const toggleTodo = useToggleTodoMutation(entryId)
  const editTodo = useEditTodoMutation(entryId)
  const removeTodo = useRemoveTodoMutation(entryId)
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
  const pendingFocus = useRef<{ id: number; kind: 'check' | 'block' | 'reason' } | null>(null)

  const [, setFocusTick] = useState(0)

  // Applied after every render while pending, because the optimistic update can re-sort the list a
  // moment after the action (and a moved row may lose focus). The request expires after 100ms.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    sectionRef.current?.querySelector<HTMLElement>(`[data-todo-${target.kind}="${target.id}"]`)?.focus()
  })

  function requestFocus(id: number, kind: 'check' | 'block' | 'reason') {
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
  const draftInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focusDraftInput: () => draftInputRef.current?.focus(),
  }))

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

  function commitEdit() {
    if (editingId == null) return
    const text = editingText.trim()
    if (text) {
      editTodo.mutate({ id: editingId, title: text })
    }
    setEditingId(null)
    setEditingText('')
  }

  /** Controls shared by top-level todos and subtasks. */
  function renderRow(td: TaskItemResponseDto, isChild: boolean) {
    const id = Number(td.id)
    const isDone = td.status === 'Completed'
    const isBlocked = td.status === 'Blocked'
    const canBlock = td.status === 'Todo'
    const childIsFuture = isChild && !!td.currentJournalDate && td.currentJournalDate > isoDate
    const startEdit = () => {
      setEditingId(id)
      setEditingText(td.title ?? '')
    }
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
            onChange={e => setEditingText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') { setEditingId(null); setEditingText('') }
            }}
          />
        ) : (
          <span className="todo-text" onDoubleClick={startEdit}>
            {td.title}
          </span>
        )}

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
            aria-label="Unblock"
            title="Unblock"
            onClick={() => unblock(td)}
          >
            <BlockIcon size={11} />
            <span className="todo-blocked-badge-text">Blocked</span>
          </button>
        )}

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
            onClick={() => removeTodo.mutate(id)}
            aria-label={isChild ? 'Remove from day' : 'Delete'}
          >
            <DeleteSvg />
          </button>
        )}

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
                {renderRow(td, false)}

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
                          {renderRow(child, true)}
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
          <div className="j-modal-backdrop" onClick={() => setHistoryTask(null)} aria-hidden="true" />
          <div className="j-modal" role="dialog" aria-modal="true" aria-labelledby="journal-task-history-title">
            <div className="j-modal-header">
              <div>
                <h3 id="journal-task-history-title" className="j-modal-title">Task history</h3>
                <p className="j-modal-subtitle">{historyTask.title}</p>
              </div>
              <button ref={historyCloseRef} className="j-modal-close" onClick={() => setHistoryTask(null)}>Close</button>
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

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}
