import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TasksPage } from './TasksPage'

vi.mock('@/hooks/useTasks', () => ({
  useTasksQuery: vi.fn(),
  useTaskCountQuery: vi.fn(),
  useCreateTaskMutation: vi.fn(),
  useUpdateTaskMutation: vi.fn(),
  useDeleteTaskMutation: vi.fn(),
}))

vi.mock('@/hooks/useJournal', () => ({
  useJournalEntries: vi.fn(),
}))

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(),
}))

import { useTasksQuery, useTaskCountQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '@/hooks/useTasks'
import { useJournalEntries } from '@/hooks/useJournal'
import { usePrefs } from '@/context/usePrefs'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

const taskMutations = {
  mutate: vi.fn(),
  isPending: false,
}

describe('TasksPage', () => {
  beforeEach(() => {
    const mockPrefs: PrefsContextValue = {
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
      weekdaysOnly: false,
      setWeekdaysOnly: vi.fn(),
    }

    vi.mocked(usePrefs).mockReturnValue(mockPrefs)

    vi.mocked(useCreateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useUpdateTaskMutation).mockReturnValue(taskMutations as never)
    vi.mocked(useDeleteTaskMutation).mockReturnValue(taskMutations as never)

    vi.mocked(useJournalEntries).mockReturnValue({
      data: {
        data: [{ id: 10, date: '2026-05-16', todoTaskItemIds: [1, 2] }],
      },
      isLoading: false,
      error: null,
    } as never)

    vi.mocked(useTaskCountQuery).mockReturnValue({ data: undefined, isLoading: true, error: null } as never)

    vi.mocked(useTasksQuery).mockReturnValue({
      data: {
        data: [
          {
            id: 1,
            title: 'Parent task',
            description: null,
            status: 'Todo',
            priority: 'Low',
            isComplete: false,
            dueDate: null,
            parentTaskItemId: null,
            childTaskCount: 1,
            currentJournalDate: '2026-05-16',
            moveCount: 0,
            daysTagged: 1,
          },
          {
            id: 2,
            title: 'Child task',
            description: null,
            status: 'Todo',
            priority: 'Low',
            isComplete: false,
            dueDate: null,
            parentTaskItemId: 1,
            childTaskCount: 0,
            currentJournalDate: '2026-05-16',
            moveCount: 0,
            daysTagged: 1,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders hierarchical tasks without maximum update depth warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Parent task')).toBeInTheDocument()
    expect(screen.getByText('Child task')).toBeInTheDocument()

    const maxDepthWarningSeen = errorSpy.mock.calls.some(call =>
      call.some(arg => String(arg).includes('Maximum update depth exceeded')),
    )
    expect(maxDepthWarningSeen).toBe(false)

    errorSpy.mockRestore()
  })

  describe('task count label', () => {
    function renderPage() {
      render(
        <MemoryRouter>
          <TasksPage />
        </MemoryRouter>,
      )
    }

    function mockCount(count: number | string | undefined) {
      vi.mocked(useTaskCountQuery).mockReturnValue({
        data: { data: { count } },
        isLoading: false,
        error: null,
      } as never)
    }

    it('shows "5 tasks" next to the heading, not wrapping the New Task button', () => {
      mockCount(5)
      renderPage()
      const label = screen.getByTestId('task-count')
      expect(label).toHaveTextContent(/^5 tasks$/)
      const heading = screen.getByRole('heading', { name: 'Tasks' })
      expect(label.parentElement).toBe(heading.parentElement)
      expect(label.parentElement).not.toContainElement(screen.getByRole('button', { name: 'New Task' }))
    })

    it('shows "0 tasks" when the count is zero', () => {
      mockCount(0)
      renderPage()
      expect(screen.getByTestId('task-count')).toHaveTextContent(/^0 tasks$/)
    })

    it('shows "1 task" when the count is one', () => {
      mockCount(1)
      renderPage()
      expect(screen.getByTestId('task-count')).toHaveTextContent(/^1 task$/)
    })

    it('handles a string-typed count from the generated type', () => {
      mockCount('7')
      renderPage()
      expect(screen.getByTestId('task-count')).toHaveTextContent(/^7 tasks$/)
    })

    it('renders heading and list with no label while the count is loading', () => {
      renderPage()
      expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
      expect(screen.getByText('Parent task')).toBeInTheDocument()
      expect(screen.queryByTestId('task-count')).toBeNull()
    })

    it('renders heading and list with no label when the count request failed', () => {
      vi.mocked(useTaskCountQuery).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('boom'),
      } as never)
      renderPage()
      expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
      expect(screen.getByText('Parent task')).toBeInTheDocument()
      expect(screen.queryByTestId('task-count')).toBeNull()
      expect(screen.queryByText(/boom|failed/i)).toBeNull()
    })
  })

  it('toggles subtask visibility when parent row is collapsed and expanded', async () => {
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Child task')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hide subtasks' }))
    expect(screen.queryByText('Child task')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show subtasks' }))
    expect(screen.getByText('Child task')).toBeInTheDocument()
  })
})
