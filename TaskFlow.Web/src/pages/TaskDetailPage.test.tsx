import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

vi.mock('@/hooks/useTasks', () => ({
  useTaskQuery: vi.fn(),
  useTasksQuery: vi.fn(),
  useUpdateTaskMutation: vi.fn(),
  useDeleteTaskMutation: vi.fn(),
  useTaskHistoryQuery: vi.fn(),
}))

vi.mock('@/hooks/useNotes', () => ({
  useNotesQuery: vi.fn(),
  useCreateNoteMutation: vi.fn(),
  useUpdateNoteMutation: vi.fn(),
  useDeleteNoteMutation: vi.fn(),
}))

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

import { useTaskQuery, useTasksQuery, useUpdateTaskMutation, useDeleteTaskMutation, useTaskHistoryQuery } from '@/hooks/useTasks'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation } from '@/hooks/useNotes'
import { usePrefs } from '@/context/usePrefs'
import { TaskDetailPage } from './TaskDetailPage'

const task = {
  id: 1,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  status: 'Todo',
  priority: 'Low',
  isComplete: false,
  dueDate: null,
  parentTaskItemId: null,
  childTaskCount: 0,
  currentJournalDate: null,
  moveCount: 0,
  daysTagged: 0,
}

function makePrefs(overrides?: Partial<PrefsContextValue>): PrefsContextValue {
  return {
    isDark: false,
    setIsDark: vi.fn(),
    theme: 'default',
    setTheme: vi.fn(),
    headerStyle: 'stat',
    setHeaderStyle: vi.fn(),
    todoSort: 'manual',
    setTodoSort: vi.fn(),
    projectStart: '2026-05-09',
    setProjectStart: vi.fn(),
    taskSortKey: 'title',
    setTaskSortKey: vi.fn(),
    taskSortDir: 'asc',
    setTaskSortDir: vi.fn(),
    autoCompleteParentWhenChildrenDone: false,
    setAutoCompleteParentWhenChildrenDone: vi.fn(),
    ...overrides,
  }
}

function renderPage(path = '/tasks/1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

let confirmSpy: ReturnType<typeof vi.spyOn>

describe('TaskDetailPage', () => {
  beforeEach(() => {
    vi.mocked(usePrefs).mockReturnValue(makePrefs())

    vi.mocked(useTaskQuery).mockReturnValue({ data: { data: task }, isLoading: false, error: null } as never)
    vi.mocked(useTasksQuery).mockReturnValue({ data: { data: [task] }, isLoading: false } as never)
    vi.mocked(useNotesQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)

    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useDeleteTaskMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useCreateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useUpdateNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useDeleteNoteMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)

    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    confirmSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('shows loading state', () => {
    vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: true, error: null } as never)
    renderPage()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error state when task fetch fails', () => {
    vi.mocked(useTaskQuery).mockReturnValue({ data: undefined, isLoading: false, error: new Error('not found') } as never)
    renderPage()
    expect(screen.getByText(/task not found/i)).toBeInTheDocument()
  })

  it('shows Task not found for non-numeric id', () => {
    renderPage('/tasks/abc')
    expect(screen.getByText(/task not found/i)).toBeInTheDocument()
  })

  it('renders task title', () => {
    renderPage()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
  })

  it('status badge shows lowercased status', () => {
    renderPage()
    expect(screen.getByText('todo')).toBeInTheDocument()
  })

  it('priority badge shows lowercased priority', () => {
    renderPage()
    expect(screen.getByText('low')).toBeInTheDocument()
  })

  it('description text is visible when present', () => {
    renderPage()
    expect(screen.getByText('Users cannot log in')).toBeInTheDocument()
  })

  it('description is absent when null', () => {
    vi.mocked(useTaskQuery).mockReturnValue({ data: { data: { ...task, description: null } }, isLoading: false, error: null } as never)
    renderPage()
    expect(screen.queryByText('Users cannot log in')).not.toBeInTheDocument()
  })

  it('renders history panel', () => {
    renderPage()
    expect(screen.getByTestId('history-panel')).toBeInTheDocument()
  })

  it('renders back link', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /back to tasks/i })).toBeInTheDocument()
  })

  it('edit button renders TaskForm with pre-populated title', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement
    expect(titleInput).toBeInTheDocument()
    expect(titleInput.value).toBe('Fix login bug')
  })

  it('cancel in edit form returns to view mode', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
  })

  it('submitting edit form calls updateTask.mutate', async () => {
    const updateMutate = vi.fn()
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: updateMutate, isPending: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, data: expect.objectContaining({ title: 'Fix login bug' }) }),
      expect.any(Object)
    )
  })

  it('delete with confirm=true calls deleteTask.mutate', async () => {
    const deleteMutate = vi.fn()
    vi.mocked(useDeleteTaskMutation).mockReturnValue({ mutate: deleteMutate, isPending: false } as never)
    confirmSpy.mockReturnValue(true)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(deleteMutate).toHaveBeenCalledWith(1, expect.any(Object))
  })

  it('delete with confirm=false does not call deleteTask.mutate', async () => {
    const deleteMutate = vi.fn()
    vi.mocked(useDeleteTaskMutation).mockReturnValue({ mutate: deleteMutate, isPending: false } as never)
    confirmSpy.mockReturnValue(false)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(deleteMutate).not.toHaveBeenCalled()
  })

  it('shows "No notes yet" when notes are empty', () => {
    renderPage()
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
  })

  it('Add Note button shows NoteForm', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /add note/i }))
    // NoteForm renders a textarea or input for note content
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('TASK_REOPEN_PAST_DAY_NOT_ALLOWED error shows proper message', async () => {
    const updateMutate = vi.fn((_payload, { onError }: { onError: (e: unknown) => void }) => {
      onError({ code: 'TASK_REOPEN_PAST_DAY_NOT_ALLOWED' })
    })
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: updateMutate, isPending: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/completed tasks assigned to past days cannot be reopened/i)).toBeInTheDocument()
  })

  it('TASK_PARENT_CYCLE_NOT_ALLOWED error shows proper message', async () => {
    const updateMutate = vi.fn((_payload, { onError }: { onError: (e: unknown) => void }) => {
      onError({ code: 'TASK_PARENT_CYCLE_NOT_ALLOWED' })
    })
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: updateMutate, isPending: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/cycle/i)).toBeInTheDocument()
  })

  it('unknown mutation error shows generic message', async () => {
    const updateMutate = vi.fn((_payload, { onError }: { onError: (e: unknown) => void }) => {
      onError({ code: 'UNKNOWN_ERROR' })
    })
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: updateMutate, isPending: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/unable to save task changes/i)).toBeInTheDocument()
  })
})
