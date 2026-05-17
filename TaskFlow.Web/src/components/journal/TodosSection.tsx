import { useState, useMemo } from 'react'
import type { TaskItemResponseDto } from '@/api/journal'
import {
  useJournalTodos,
  useCreateTodoMutation,
  useToggleTodoMutation,
  useEditTodoMutation,
  useRemoveTodoMutation,
  openTodoCount,
} from '@/hooks/useJournal'
import { todayISO } from '@/lib/journal-utils'

type SortMode = 'manual' | 'open first' | 'done last'

interface Props {
  entryId: number
  isoDate: string
  sort: SortMode
}

export function TodosSection({ entryId, isoDate, sort }: Props) {
  const { data: todosData, isLoading } = useJournalTodos(entryId)
  const todos = useMemo<TaskItemResponseDto[]>(
    () => (todosData?.data as TaskItemResponseDto[] | undefined) ?? [],
    [todosData],
  )

  const createTodo = useCreateTodoMutation(entryId)
  const toggleTodo = useToggleTodoMutation(entryId)
  const editTodo = useEditTodoMutation(entryId)
  const removeTodo = useRemoveTodoMutation(entryId)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const today = todayISO()
  const isPastDay = isoDate < today

  const sorted = useMemo(() => {
    const arr = [...todos]
    if (sort === 'open first' || sort === 'done last') {
      arr.sort((a, b) => {
        const aDone = a.status === 'Completed' || !!a.isComplete ? 1 : 0
        const bDone = b.status === 'Completed' || !!b.isComplete ? 1 : 0
        return aDone - bDone
      })
    }
    return arr
  }, [todos, sort])

  const remaining = openTodoCount(todos)
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
    const isDone = todo.status === 'Completed' || !!todo.isComplete
    toggleTodo.mutate(
      { id: Number(todo.id), title: todo.title, done: !isDone },
      { onError: err => setActionError(getTaskActionErrorMessage(err)) }
    )
  }

  function commitEdit() {
    if (editingId == null) return
    const text = editingText.trim()
    if (text) editTodo.mutate({ id: editingId, title: text })
    setEditingId(null)
    setEditingText('')
  }

  return (
    <section className="card todos">
      <div className="card-hdr">
        <h2 className="card-title">TODOs</h2>
        <div className="card-meta">
          <span className="todo-count">{total - remaining}/{total}</span>
        </div>
      </div>

      {isLoading ? (
        <p className="j-empty">Loading…</p>
      ) : (
        <ul className="todo-list">
          {sorted.length === 0 && (
            <li className="j-empty">No TODOs yet — add one below.</li>
          )}
          {sorted.map(td => {
            const isDone = td.status === 'Completed' || !!td.isComplete
            return (
              <li key={td.id} className={'todo' + (isDone ? ' is-done' : '')}>
                <button
                  className="todo-check"
                  onClick={() => toggle(td)}
                  aria-label={isDone ? 'Mark not done' : 'Mark done'}
                >
                  {isDone && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>

                {editingId === Number(td.id) ? (
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
                  <span
                    className="todo-text"
                    onDoubleClick={() => {
                      setEditingId(Number(td.id))
                      setEditingText(td.title)
                    }}
                  >
                    {td.title}
                  </span>
                )}

                <button
                  className="todo-x"
                  onClick={() => removeTodo.mutate(Number(td.id))}
                  aria-label="Delete"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {actionError && <p className="todo-error">{actionError}</p>}

      {isPastDay && (
        <p className="todo-helper">Cannot add tasks to past days. Completed tasks remain as history for this date.</p>
      )}

      <form className="add-row" onSubmit={addTodo}>
        <span className="add-plus">+</span>
        <input
          className="add-input"
          placeholder={isPastDay ? 'Adding tasks is disabled for past dates' : 'Add a TODO and press Enter'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={createTodo.isPending || isPastDay}
        />
      </form>
    </section>
  )
}

function getTaskActionErrorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED') {
    return 'Completed tasks assigned to past days cannot be reopened.'
  }
  if (code === 'TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED') {
    return 'This task cannot be assigned to a past day.'
  }
  return 'Unable to save task changes. Please try again.'
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'string' ? maybeCode : null
}
