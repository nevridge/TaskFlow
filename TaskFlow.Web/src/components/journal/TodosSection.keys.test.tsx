import { createRef, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import { useLocation } from 'react-router-dom'
import type { TaskItemResponseDto } from '@/api/journal'

const toggleTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: { all: ['journal'], todos: (id: number) => ['journal', id, 'todos'], notes: (id: number) => ['journal', id, 'notes'] },
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))
vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => null }))

import { useJournalTodos } from '@/hooks/useJournal'
import { TodosSection } from './TodosSection'
import type { TodosSectionHandle } from './TodosSection'

function row(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Task', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}
function load(rows: TaskItemResponseDto[]) {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
}

let path = ''
function Probe() {
  const l = useLocation()
  useEffect(() => { path = l.pathname + l.search })
  return null
}

const ISO = new Date().toISOString().slice(0, 10)
function setup() {
  const ref = createRef<TodosSectionHandle>()
  render(
    <>
      <Probe />
      <button type="button" data-testid="outside">outside</button>
      <TodosSection ref={ref} entryId={10} isoDate={ISO} sort="manual" />
    </>,
  )
  return ref
}
const title = (id: number) => document.querySelector(`[data-todo-title="${id}"]`) as HTMLElement
const check = (id: number) => document.querySelector(`[data-todo-check="${id}"]`) as HTMLElement

describe('TodosSection keyboard handle (#468)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    path = ''
    load([row({ id: 1, title: 'A' }), row({ id: 2, title: 'B' }), row({ id: 3, title: 'C' })])
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('with focus outside the list, next goes to the first title and prev to the last', () => {
    const ref = setup()
    screen.getByTestId('outside').focus()
    act(() => { expect(ref.current?.focusAdjacentTodo('next')).toBe(true) })
    expect(title(1)).toHaveFocus()
    screen.getByTestId('outside').focus()
    act(() => { expect(ref.current?.focusAdjacentTodo('prev')).toBe(true) })
    expect(title(3)).toHaveFocus()
  })

  it('moves one row per call, relative to the focused row, and clamps at both ends', () => {
    const ref = setup()
    check(2).focus()
    act(() => { ref.current?.focusAdjacentTodo('next') })
    expect(title(3)).toHaveFocus()
    act(() => { expect(ref.current?.focusAdjacentTodo('next')).toBe(true) })
    expect(title(3)).toHaveFocus()
    act(() => { ref.current?.focusAdjacentTodo('prev') })
    act(() => { ref.current?.focusAdjacentTodo('prev') })
    expect(title(1)).toHaveFocus()
    act(() => { ref.current?.focusAdjacentTodo('prev') })
    expect(title(1)).toHaveFocus()
  })

  it('reports it did nothing when there are no todos', () => {
    load([])
    const ref = setup()
    expect(ref.current?.focusAdjacentTodo('next')).toBe(false)
    expect(ref.current?.focusFirstTodo()).toBe(false)
    expect(ref.current?.focusLastTodo()).toBe(false)
    expect(ref.current?.openFocusedTodo()).toBe(false)
    expect(ref.current?.toggleFocusedTodo()).toBe(false)
  })

  it('moves relative to a context header link and skips the header', () => {
    load([row({ id: 1, title: 'Solo' }), row({ id: 2, title: 'Kid 1', parentTaskItemId: 9, parentTitle: 'Parent' }), row({ id: 3, title: 'Kid 2', parentTaskItemId: 9, parentTitle: 'Parent' })])
    const ref = setup()
    const header = screen.getByRole('link', { name: /^Parent task/ })
    header.focus()
    act(() => { ref.current?.focusAdjacentTodo('next') })
    expect(title(2)).toHaveFocus()
    header.focus()
    act(() => { ref.current?.focusAdjacentTodo('prev') })
    expect(title(1)).toHaveFocus()
  })

  it('e acts only on the row that has focus', () => {
    const ref = setup()
    screen.getByTestId('outside').focus()
    expect(ref.current?.openFocusedTodo()).toBe(false)
    expect(path).toBe('/')
    title(2).focus()
    act(() => { expect(ref.current?.openFocusedTodo()).toBe(true) })
    expect(path).toMatch(/^\/tasks\/2/)
  })

  it('c clicks the focused row check and keeps focus on the same control', () => {
    const ref = setup()
    title(2).focus()
    act(() => { expect(ref.current?.toggleFocusedTodo()).toBe(true) })
    expect(toggleTodoMutate).toHaveBeenCalledWith({ id: 2, done: true }, expect.any(Object))
    expect(title(2)).toHaveFocus()
    expect(ref.current?.toggleFocusedTodo()).toBe(true)
  })

  it('c does nothing on a reopen-blocked completed row', () => {
    load([row({ id: 1, title: 'Old', status: 'Completed', completedAt: '2020-01-01T12:00:00Z' } as Partial<TaskItemResponseDto>)])
    const ref = setup()
    title(1).focus()
    expect(ref.current?.toggleFocusedTodo()).toBe(false)
    expect(toggleTodoMutate).not.toHaveBeenCalled()
  })

  it('c on a blocked row takes the same path as the check button', () => {
    load([row({ id: 1, title: 'Stuck', status: 'Blocked', blockedReason: 'r' })])
    const ref = setup()
    title(1).focus()
    act(() => { ref.current?.toggleFocusedTodo() })
    expect(toggleTodoMutate).toHaveBeenCalledWith({ id: 1, done: true }, expect.any(Object))
  })
})
