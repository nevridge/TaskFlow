import { useState, useMemo } from 'react'
import type { TaskItemResponseDto } from '@/api/journal'
import {
  useJournalTodos,
  useCreateTodoMutation,
  useToggleTodoMutation,
  useEditTodoMutation,
  useRemoveTodoMutation,
  useCarryOverMutation,
  openTodoCount,
  yesterdayOf,
} from '@/hooks/useJournal'
import { todayISO } from '@/lib/journal-utils'

type SortMode = 'manual' | 'open first' | 'done last'

interface Props {
  entryId: number
  isoDate: string
  sort: SortMode
  /** Today's entry ID — needed for carry-forward from past days */
  todayEntryId: number | undefined
  /** Today's current todos — used for deduplication during carry-over */
  todayTodos: TaskItemResponseDto[]
}

export function TodosSection({ entryId, isoDate, sort, todayEntryId, todayTodos }: Props) {
  const { data: todosData, isLoading } = useJournalTodos(entryId)
  const todos: TaskItemResponseDto[] = (todosData?.data as TaskItemResponseDto[] | undefined) ?? []

  const createTodo = useCreateTodoMutation(entryId)
  const toggleTodo = useToggleTodoMutation(entryId)
  const editTodo = useEditTodoMutation(entryId)
  const removeTodo = useRemoveTodoMutation(entryId)
  const carryOver = useCarryOverMutation()

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')

  const today = todayISO()
  const isToday = isoDate === today
  const yesterday = yesterdayOf(isoDate)

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
    const text = draft.trim()
    if (!text) return
    createTodo.mutate(text)
    setDraft('')
  }

  function toggle(todo: TaskItemResponseDto) {
    const isDone = todo.status === 'Completed' || !!todo.isComplete
    toggleTodo.mutate({ id: Number(todo.id), title: todo.title, done: !isDone })
  }

  function commitEdit() {
    if (editingId == null) return
    const text = editingText.trim()
    if (text) editTodo.mutate({ id: editingId, title: text })
    setEditingId(null)
    setEditingText('')
  }

  function handleCarryOver() {
    if (isToday) {
      // Pull from yesterday into today
      carryOver.mutate({ fromIsoDate: yesterday, toEntryId: entryId, toExistingTodos: todos })
    } else if (todayEntryId != null) {
      // Push this day's open todos into today
      carryOver.mutate({ fromIsoDate: isoDate, toEntryId: todayEntryId, toExistingTodos: todayTodos })
    }
  }

  const canCarryForward = !isToday && remaining > 0 && todayEntryId != null

  return (
    <section className="card todos">
      <div className="card-hdr">
        <h2 className="card-title">TODOs</h2>
        <div className="card-meta">
          <span className="todo-count">{total - remaining}/{total}</span>
          {isToday && (
            <button className="link-btn" onClick={handleCarryOver} disabled={carryOver.isPending}>
              ← Pull from yesterday
            </button>
          )}
          {canCarryForward && (
            <button className="link-btn" onClick={handleCarryOver} disabled={carryOver.isPending}>
              Carry over to today →
            </button>
          )}
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

      <form className="add-row" onSubmit={addTodo}>
        <span className="add-plus">+</span>
        <input
          className="add-input"
          placeholder="Add a TODO and press Enter"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={createTodo.isPending}
        />
      </form>
    </section>
  )
}
