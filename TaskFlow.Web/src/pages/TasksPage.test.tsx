import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TasksPage } from './TasksPage'

vi.mock('@/hooks/useTasks', () => ({
  useTasksQuery: vi.fn(),
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

import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '@/hooks/useTasks'
import { useJournalEntries } from '@/hooks/useJournal'
import { usePrefs } from '@/context/usePrefs'

const taskMutations = {
  mutate: vi.fn(),
  isPending: false,
}

describe('TasksPage', () => {
  beforeEach(() => {
    vi.mocked(usePrefs).mockReturnValue({
      taskSortKey: 'title',
      setTaskSortKey: vi.fn(),
      taskSortDir: 'asc',
      setTaskSortDir: vi.fn(),
      autoCompleteParentWhenChildrenDone: false,
    })

    vi.mocked(useCreateTaskMutation).mockReturnValue(taskMutations)
    vi.mocked(useUpdateTaskMutation).mockReturnValue(taskMutations)
    vi.mocked(useDeleteTaskMutation).mockReturnValue(taskMutations)

    vi.mocked(useJournalEntries).mockReturnValue({
      data: {
        data: [{ id: 10, date: '2026-05-16', todoTaskItemIds: [1, 2] }],
      },
      isLoading: false,
      error: null,
    } as never)

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
