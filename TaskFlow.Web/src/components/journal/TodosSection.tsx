import { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { removeJournalTodo } from '@/api/journal'
import type { TaskItemResponseDto } from '@/api/journal'
import type { SortMode } from '@/lib/prefs'
import { BlockIcon, BlockReasonInput, BlockedReasonText } from '@/components/BlockControls'
import {
  canBlock as canBlockStatus,
  formatSubtasksComplete,
  getBlockErrorMessage,
  getStatusLabel,
  hasOpenChildren,
  journalSortTier,
} from '@/lib/task-status'
import { buildJournalBlocks } from '@/lib/journal-rows'
import type { JournalHeaderData } from '@/lib/journal-rows'
import { TaskHistoryPanel } from '@/components/TaskHistoryPanel'
import {
  useJournalTodos,
  useCreateTodoMutation,
  useToggleTodoMutation,
  useBlockTodoMutation,
  useUnblockTodoMutation,
  useEditBlockedReasonTodoMutation,
  openTodoCount,
  blockedTodoCount,
  journalKeys,
} from '@/hooks/useJournal'
import { useUndoableDelete } from '@/hooks/useUndoableDelete'
import { TodoBadges } from '@/components/journal/TodoBadges'
import { journalOriginPath, readFocusTaskId, stateWithoutFocusTaskId, taskEditPath } from '@/lib/task-origin'
import { getErrorCode, PARENT_COMPLETED_MESSAGE } from '@/lib/task-errors'
import {
  todayISO,
  formatMonthDay,
  formatStartedAt,
  getTimezoneOffsetMinutes,
  isCompletedHere,
  isReopenBlocked,
} from '@/lib/journal-utils'

const REOPEN_BLOCKED_TEXT = 'Completed tasks on past days cannot be reopened'

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

const ChevronSvg = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <polyline points="9 6 15 12 9 18"/>
  </svg>
)

const MAX_TOAST_TITLE = 30

function truncateTitle(title: string): string {
  return title.length > MAX_TOAST_TITLE ? `${title.slice(0, MAX_TOAST_TITLE)}…` : title
}

// A click on any of these acts for itself and never opens the todo.
const ROW_CONTROLS = 'button, a, input, textarea, select, [data-row-no-nav]'

const todoKey = (entryId: number, id: number | string | undefined) => `todo:${entryId}:${id}`

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

/** The todo methods return whether they acted, so the keyboard hook only swallows keys that did something. */
export interface TodosSectionHandle {
  focusDraftInput: () => void
  focusFirstTodo: () => boolean
  focusLastTodo: () => boolean
  focusAdjacentTodo: (dir: 'next' | 'prev') => boolean
  openFocusedTodo: () => boolean
  toggleFocusedTodo: () => boolean
}

export const TodosSection = forwardRef<TodosSectionHandle, Props>(function TodosSection({ entryId, isoDate, sort }, ref) {
  const { data: todosData, isLoading } = useJournalTodos(entryId)
  const queryClient = useQueryClient()
  const { requestDelete, isHidden } = useUndoableDelete()
  // Deletes waiting out the undo window are filtered here (never written to the cache), before sort and counts.
  const todos = useMemo<TaskItemResponseDto[]>(() => {
    const all = (todosData?.data as TaskItemResponseDto[] | undefined) ?? []
    return all.filter(t => !isHidden(todoKey(entryId, t.id)))
  },[todosData, isHidden, entryId])

  const createTodo = useCreateTodoMutation(entryId, isoDate)
  const toggleTodo = useToggleTodoMutation(entryId, isoDate)
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

  // One-shot focus return from the task details page. Separate from pendingFocus: that one expires after 100ms
  // and is cleared by keydown/pointerdown, but rows may render later and a keyboard user is mid-interaction.
  const location = useLocation()
  const navigate = useNavigate()
  const returnFocusRef = useRef<number | null>(readFocusTaskId(location.state))
  const returnKeyRef = useRef(location.key)

  // The section can persist across an in-place navigation (the weekend-to-Friday redirect), so a new
  // location that carries a focus id is read once, as long as no earlier one is still waiting.
  useEffect(() => {
    if (returnKeyRef.current === location.key) return
    returnKeyRef.current = location.key
    if (returnFocusRef.current == null) returnFocusRef.current = readFocusTaskId(location.state)
  }, [location.key, location.state])

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
  const [actionError, setActionError] = useState<string | null>(null)
  const [historyTask, setHistoryTask] = useState<TaskItemResponseDto | null>(null)
  const historyCloseRef = useRef<HTMLButtonElement | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const draftInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focusDraftInput: () => draftInputRef.current?.focus(),
    focusFirstTodo: () => focusTitleAt('first'),
    focusLastTodo: () => focusTitleAt('last'),
    focusAdjacentTodo,
    openFocusedTodo: () => {
      const id = focusedRowId()
      if (id == null) return false
      // A key press is never a drag-select, so a page selection must not swallow it.
      goToTodo(id)
      return true
    },
    toggleFocusedTodo: () => {
      const row = focusedRow()
      const check = row?.querySelector<HTMLButtonElement>('[data-todo-check]')
      // A reopen-blocked check is disabled: it does nothing, same as clicking it.
      if (!row || !check || check.disabled) return false
      // Re-sorting a row can drop focus: ask for it back on the same control.
      const active = document.activeElement
      const id = Number(row.dataset.todoRow)
      if (active instanceof HTMLElement && active.hasAttribute('data-todo-title')) requestFocus(id, 'title')
      else if (active === check) requestFocus(id, 'check')
      check.click()
      return true
    },
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

  const offset = getTimezoneOffsetMinutes()
  const originPath = journalOriginPath(isoDate)

  // Rows are flat (roots and subtasks). Tiers (open, blocked, completed) apply only to the two tiered sort modes;
  // other modes keep server order. Context headers are placed by buildJournalBlocks, never sorted as todos.
  const blocks = useMemo(
    () =>
      buildJournalBlocks(
        todos,
        sort === 'open first' || sort === 'done last'
          ? (a, b) => journalSortTier(a.status) - journalSortTier(b.status)
          : () => 0,
      ),
    [todos, sort],
  )
  const workRows = useMemo(() => blocks.flatMap(b => b.rows), [blocks])

  // Runs on the render where loading ends. A row that is gone (completed, deleted, moved, other day) abandons the
  // request without forcing focus anywhere. Only the focus key is cleared so weekendRedirect survives a refresh.
  useEffect(() => {
    const id = returnFocusRef.current
    if (id == null || isLoading) return
    returnFocusRef.current = null
    sectionRef.current
      ?.querySelector<HTMLElement>(`[data-todo-details="${id}"]`)
      ?.focus({ preventScroll: false })
    if (readFocusTaskId(location.state) != null) {
      navigate(location.pathname, { replace: true, state: stateWithoutFocusTaskId(location.state) })
    }
  }, [workRows, isLoading, location.key, location.pathname, location.state, navigate])

  // Counts come from the rendered work rows; headers are never counted.
  const remaining = openTodoCount(workRows)
  const blockedCount = blockedTodoCount(workRows)
  const total = workRows.length

  const anyReopenBlocked = workRows.some(t => isReopenBlocked(t, offset))

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
    // The server would answer 422; a blocked reopen sends nothing and explains itself.
    if (isReopenBlocked(todo, offset)) {
      setLiveMessage(`${REOPEN_BLOCKED_TEXT}.`)
      return
    }
    setActionError(null)
    const isDone = todo.status === 'Completed'
    const isChild = todo.parentTaskItemId != null
    // Completing from a past day moves the row to today: keep focus on a surviving row and announce it.
    const leavesDay = !isDone && isoDate !== todayISO()
    if (leavesDay) {
      moveFocusAwayFrom(Number(todo.id))
      setLiveMessage('Completed. Moved to today.')
    }
    toggleTodo.mutate(
      {
        id: Number(todo.id),
        done: !isDone,
        // Subtask completion must never auto-complete the parent in the journal UI
        ...(isChild && { autoCompleteParentWhenChildrenDone: false }),
      },
      {
        onError: err => {
          if (leavesDay) setLiveMessage('')
          setActionError(getTaskActionErrorMessage(err))
        },
      }
    )
  }

  /** Opens the todo on its edit page, unless the user is selecting text (a drag-select must not navigate). */
  function openTodo(id: number) {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    goToTodo(id)
  }

  function goToTodo(id: number) {
    navigate(taskEditPath(id), { state: { from: originPath, focusTaskId: id } })
  }

  function focusedRow(): HTMLElement | null {
    const active = document.activeElement
    const section = sectionRef.current
    if (!(active instanceof HTMLElement) || !section) return null
    const row = active.closest<HTMLElement>('[data-todo-row]')
    return row && section.contains(row) ? row : null
  }

  function focusedRowId(): number | null {
    const row = focusedRow()
    return row ? Number(row.dataset.todoRow) : null
  }

  function titles(): HTMLElement[] {
    return Array.from(sectionRef.current?.querySelectorAll<HTMLElement>('[data-todo-title]') ?? [])
  }

  function focusTitle(el: HTMLElement): boolean {
    // A fast keypress supersedes a pending focus request (the section's capture handler only sees keys inside it).
    pendingFocus.current = null
    returnFocusRef.current = null
    el.focus()
    return true
  }

  function focusTitleAt(which: 'first' | 'last'): boolean {
    const all = titles()
    const target = which === 'first' ? all[0] : all[all.length - 1]
    return target ? focusTitle(target) : false
  }

  /** j / k: relative to the focused element. Rows' titles in DOM order, headers skipped, ends clamp. */
  function focusAdjacentTodo(dir: 'next' | 'prev'): boolean {
    const all = titles()
    if (all.length === 0) return false
    const active = document.activeElement
    const list = sectionRef.current?.querySelector('.todo-list')
    if (!(active instanceof HTMLElement) || !list || !list.contains(active)) {
      return focusTitleAt(dir === 'next' ? 'first' : 'last')
    }
    const own = focusedRow()?.querySelector<HTMLElement>('[data-todo-title]')
    let target: HTMLElement | undefined
    if (own) {
      target = all[all.indexOf(own) + (dir === 'next' ? 1 : -1)]
    } else if (dir === 'next') {
      target = all.find(t => active.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)
    } else {
      target = [...all].reverse().find(t => active.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)
    }
    // At either end there is nowhere to go: stay put.
    return target ? focusTitle(target) : true
  }

  /** If the row's check button or title has focus, hands it to the same control on the next row (previous, else the add input). */
  function moveFocusAwayFrom(id: number) {
    const section = sectionRef.current
    const kind = document.activeElement?.hasAttribute('data-todo-title') ? 'title' : 'check'
    const button = section?.querySelector<HTMLElement>(`[data-todo-${kind}="${id}"]`)
    if (!section || !button || document.activeElement !== button) return
    const row = button.closest('li')
    const checks = Array.from(section.querySelectorAll<HTMLElement>(`[data-todo-${kind}]`))
    const at = checks.indexOf(button)
    const usable = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && !row?.contains(el)
    const target =
      checks.slice(at + 1).find(usable) ??
      [...checks.slice(0, at)].reverse().find(usable) ??
      (draftInputRef.current && !draftInputRef.current.disabled ? draftInputRef.current : section)
    target.focus()
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

  /** Hides the row at once and removes it from the day after the undo window. */
  function removeFromDay(td: TaskItemResponseDto) {
    const id = Number(td.id)
    const isChild = td.parentTaskItemId != null
    setActionError(null)
    // Pick the focus target first: the next work row's delete button (headers are never targets), else the add input.
    const at = workRows.findIndex(s => s.id === td.id)
    const nextButton = workRows
      .slice(at + 1)
      .map(r => sectionRef.current?.querySelector<HTMLElement>(`[data-todo-x="${r.id}"]`))
      .find(el => el != null)
    ;(nextButton ?? draftInputRef.current)?.focus()
    const section = sectionRef.current
    requestDelete({
      key: todoKey(entryId, id),
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

  /** Controls shared by top-level todos and subtasks (both are flat work rows). */
  function renderRow(td: TaskItemResponseDto, headerParentId?: number) {
    const id = Number(td.id)
    const isChild = td.parentTaskItemId != null
    const isDone = td.status === 'Completed'
    const isBlocked = td.status === 'Blocked'
    const isInProgress = td.status === 'InProgress'
    // A parent with an open subtask has a derived status: no Block or Unblock in any form.
    const derivedParent = hasOpenChildren(td)
    const canBlock = canBlockStatus(td.status) && !derivedParent
    const reopenBlocked = isReopenBlocked(td, offset)
    const completedHere = isCompletedHere(td, isoDate, offset)
    // A completion-day row can be linked to another day: show that day (the viewed day is implied).
    const showLinkedDay =
      isDone && !!td.completedAt && !!td.currentJournalDate && td.currentJournalDate !== isoDate
    const reopenHintId = `todo-reopen-hint-${id}`
    return (
      <>
        <button
          className="todo-check"
          data-todo-check={id}
          onClick={() => toggle(td)}
          aria-label={isDone ? 'Mark not done' : isBlocked ? 'Mark done (blocked)' : 'Mark done'}
          {...(reopenBlocked
            ? {
                role: 'checkbox',
                'aria-checked': true,
                'aria-describedby': reopenHintId,
                title: REOPEN_BLOCKED_TEXT,
                disabled: true,
              }
            : {})}
        >
          {isDone && <CheckSvg />}
          {isBlocked && <BlockIcon size={isChild ? 9 : 11} />}
        </button>
        {reopenBlocked && <span id={reopenHintId} className="sr-only">{REOPEN_BLOCKED_TEXT}</span>}

        {td.id !== undefined && td.id !== null && (
          <span className="todo-id" aria-label={`Task ${td.id}`} role="img">#{td.id}</span>
        )}

        <button
          type="button"
          className="todo-text"
          data-todo-title={id}
          // detail 0 = Enter or Space, which is never a drag-select, so it skips the selection guard.
          onClick={e => (e.detail === 0 ? goToTodo(id) : openTodo(id))}
        >
          {td.title ?? ''}
        </button>

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

            {/* A completed row with a completion time is history for its day: it cannot be removed from it. */}
            {!(isDone && td.completedAt) && (
              <button
                className="todo-x"
                data-todo-x={id}
                onClick={() => removeFromDay(td)}
                aria-label={isChild ? 'Remove from day' : `Remove from day: ${td.title ?? ''}`}
                title={isChild ? undefined : `Remove from day: ${td.title ?? ''}`}
                // Subtask rows under a header are described by the parent title (disambiguates "Remove from day").
                aria-describedby={isChild && headerParentId !== undefined ? `todo-ctx-${headerParentId}` : undefined}
              >
                <DeleteSvg />
              </button>
            )}

            <Link
              to={taskEditPath(id)}
              state={{ from: originPath, focusTaskId: id }}
              className="todo-details-link"
              data-todo-details={id}
              aria-label={`Edit details: ${td.title ?? ''}`}
              title="Edit details"
            >
              <ChevronSvg />
            </Link>
          </div>

          <div className="todo-subline-meta">
            {completedHere && (
              <span className="todo-meta-label todo-completed-here">
                <span aria-hidden="true"><CheckSvg /></span> Completed here
              </span>
            )}

            {showLinkedDay && td.currentJournalDate && (
              <span className="todo-future-badge">{formatMonthDay(td.currentJournalDate)}</span>
            )}

            <TodoBadges priority={td.priority} projectName={td.projectName} />

            {isInProgress && (
              <span
                className="t-badge t-badge-inprogress todo-inprogress-badge"
                title={td.startedAt ? `Started ${formatStartedAt(td.startedAt)}` : undefined}
              >
                {getStatusLabel(td.status)}
              </span>
            )}

            {isBlocked && !derivedParent && (
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

  /** A parent shown as a group label over its subtask rows: one link, a progress count, no row actions. */
  function renderContextHeader(header: JournalHeaderData) {
    return (
      <li key={`ctx:${header.parentId}`} className="todo todo-context-header">
        <Link to={`/tasks/${header.parentId}`} state={{ from: originPath }} className="todo-context-link">
          <span className="sr-only">Parent task: </span>
          <span id={`todo-ctx-${header.parentId}`}>{header.title}</span>
        </Link>
        <span className="todo-context-progress">{formatSubtasksComplete(header.done, header.total)}</span>
      </li>
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
          {blocks.length === 0 && (
            <li className="j-empty">No TODOs yet — add one below.</li>
          )}
          {blocks.flatMap(block => [
            ...(block.header
              ? [renderContextHeader(block.header)]
              : []),
            ...block.rows.map(td => (
              // The whole row opens the todo on click. It is not focusable itself: the title button is the keyboard and
              // screen-reader equivalent, so a row role or tab stop would only duplicate it.
              <li
                key={td.id}
                data-todo-row={td.id}
                onClick={e => {
                  if (e.target instanceof Element && e.target.closest(ROW_CONTROLS)) return
                  openTodo(Number(td.id))
                }}
                className={
                  'todo' +
                  // Subtask rows keep the compact .todo-child sizing; .todo-in-group adds the indent and rule.
                  (block.header ? ' todo-child todo-in-group' : '') +
                  (td.status === 'Completed' ? ' is-done' : '') +
                  (td.status === 'Blocked' ? ' is-blocked' : '')
                }
              >
                {renderRow(td, block.header?.parentId)}
              </li>
            )),
          ])}
        </ul>
      )}

      {actionError && <p className="todo-error" role="alert">{actionError}</p>}

      {(isPastDay || anyReopenBlocked) && (
        <p className="todo-helper">
          {[
            isPastDay && 'Cannot add tasks to past days. Completed tasks remain as history for this date.',
            anyReopenBlocked && "Completed tasks on past days can't be reopened.",
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
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
    return 'Tasks completed on a past day cannot be reopened.'
  }
  if (code === 'TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED') {
    return 'This task cannot be assigned to a past day.'
  }
  if (code === 'TASK_PARENT_COMPLETED_NOT_ALLOWED') return PARENT_COMPLETED_MESSAGE
  // Keyed off the code only; the journal-date detail is not read. Checked before the block messages, which
  // also map TASK_PARENT_STATUS_DERIVED.
  if (code === 'TASK_PLAN_HAS_OPEN_SUBTASKS') return 'This task has open subtasks. Plan the subtasks instead.'
  if (code === 'TASK_PARENT_STATUS_DERIVED') return "This task's status follows its subtasks. Change a subtask instead."
  const blockMessage = getBlockErrorMessage(code)
  if (blockMessage) return blockMessage
  return 'Unable to save task changes. Please try again.'
}
