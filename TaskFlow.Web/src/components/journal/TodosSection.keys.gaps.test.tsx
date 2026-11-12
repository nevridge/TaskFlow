import { createRef, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { render } from '@/test/renderWithToast'
import type { TaskItemResponseDto } from '@/api/journal'

const toggleTodoMutate = vi.fn()
const unblockMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: { all: ['journal'], todos: (id: number) => ['journal', id, 'todos'], notes: (id: number) => ['journal', id, 'notes'] },
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: unblockMutate, isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))
vi.mock('@/api/journal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/journal')>()),
  removeJournalTodo: vi.fn(() => Promise.resolve({})),
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
const visits: string[] = []
function Probe() {
  const l = useLocation()
  useEffect(() => { path = l.pathname + l.search; visits.push(path) })
  return null
}

const ISO = new Date().toISOString().slice(0, 10)
function setup() {
  const ref = createRef<TodosSectionHandle>()
  const ui = () => (
    <>
      <Probe />
      <TodosSection ref={ref} entryId={10} isoDate={ISO} sort="manual" />
    </>
  )
  const result = render(ui())
  return { ref, rerender: () => result.rerender(ui()) }
}
const title = (id: number) => document.querySelector(`[data-todo-title="${id}"]`) as HTMLElement

describe('TodosSection row-click and key gaps (#468)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    path = ''
    visits.length = 0
    load([row({ id: 1, title: 'A' }), row({ id: 2, title: 'B' }), row({ id: 3, title: 'C' })])
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('AC2: clicking the disabled check on a reopen-blocked row does not open the todo', () => {
    load([row({ id: 1, title: 'Old', status: 'Completed', completedAt: '2020-01-01T12:00:00Z' } as Partial<TaskItemResponseDto>)])
    setup()
    const check = document.querySelector('[data-todo-check="1"]') as HTMLButtonElement
    expect(check).toBeDisabled()
    fireEvent.click(check)
    expect(path).toBe('/')
    expect(toggleTodoMutate).not.toHaveBeenCalled()
  })

  it('AC2: Unblock and the block-reason text act for themselves and do not open the todo', async () => {
    load([row({ id: 1, title: 'Stuck', status: 'Blocked', blockedReason: 'Waiting on Sam' })])
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Unblock task' }))
    expect(unblockMutate).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByText('Waiting on Sam'))
    expect(path).toBe('/')
    await userEvent.dblClick(screen.getByText('Waiting on Sam'))
    expect(path).toBe('/')
    expect(document.querySelector('.todo-block-input')).not.toBeNull()
    await userEvent.click(document.querySelector('.todo-block-input') as HTMLElement)
    expect(path).toBe('/')
  })

  it('probe: j straight after c (pending focus request live) lands on the next title and stays there', () => {
    const { ref, rerender } = setup()
    title(1).focus()
    act(() => { ref.current?.toggleFocusedTodo() })
    act(() => { ref.current?.focusAdjacentTodo('next') })
    expect(title(2)).toHaveFocus()
    rerender()
    expect(title(2)).toHaveFocus()
  })

  it('probe: j from the details link right after returning from the edit page moves to the next title', () => {
    const { ref } = setup()
    ;(document.querySelector('[data-todo-details="1"]') as HTMLElement).focus()
    act(() => { expect(ref.current?.focusAdjacentTodo('next')).toBe(true) })
    expect(title(2)).toHaveFocus()
  })

  it('probe: e and c work from the details link', () => {
    const { ref } = setup()
    ;(document.querySelector('[data-todo-details="2"]') as HTMLElement).focus()
    act(() => { ref.current?.toggleFocusedTodo() })
    expect(toggleTodoMutate).toHaveBeenCalledWith({ id: 2, done: true }, expect.any(Object))
    act(() => { expect(ref.current?.openFocusedTodo()).toBe(true) })
    expect(visits).toContain('/tasks/2?edit=1')
  })

  it('probe: after delete moves focus to a neighbour, j and k still move between titles', async () => {
    const { ref } = setup()
    await userEvent.click(document.querySelector('[data-todo-x="1"]') as HTMLElement)
    expect(document.querySelector('[data-todo-title="1"]')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    act(() => { expect(ref.current?.focusAdjacentTodo('next')).toBe(true) })
    expect(document.activeElement).toBe(title(3))
    act(() => { ref.current?.focusAdjacentTodo('prev') })
    expect(document.activeElement).toBe(title(2))
  })
})
