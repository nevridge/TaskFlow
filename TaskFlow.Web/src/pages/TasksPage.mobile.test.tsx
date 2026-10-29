import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { COLLAPSED_GROUPS_KEY } from '@/hooks/useCollapsedGroups'
import { __resetCoarsePointerCache } from '@/lib/pointer'
import { TasksPage } from './TasksPage'

// Real PrefsProvider and real hooks except the API-backed ones.
vi.mock('@/hooks/useTasks', () => ({
  useTasksQuery: vi.fn(),
  useCreateTaskMutation: vi.fn(),
  useUpdateTaskMutation: vi.fn(),
  useDeleteTaskMutation: vi.fn(),
  useBlockTaskMutation: vi.fn(),
  useUnblockTaskMutation: vi.fn(),
  useEditBlockedReasonMutation: vi.fn(),
  useTaskHistoryQuery: vi.fn(),
  taskKeys: {
    all: ['tasks'],
    detail: (id: number) => ['tasks', id],
    history: (id: number) => ['tasks', id, 'history'],
  },
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjectsQuery: vi.fn(),
  useChangeTaskProject: vi.fn(),
}))

import {
  useTasksQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useBlockTaskMutation,
  useUnblockTaskMutation,
  useEditBlockedReasonMutation,
  useTaskHistoryQuery,
} from '@/hooks/useTasks'
import { useProjectsQuery, useChangeTaskProject } from '@/hooks/useProjects'

const PREFS_KEY = 'taskflow_journal_prefs_v1'

const base = {
  description: null,
  dueDate: null,
  parentTaskItemId: null,
  childTaskCount: 0,
  moveCount: 0,
  daysTagged: 1,
  projectId: null,
  projectName: null,
  currentJournalDate: null,
}

interface TaskRow {
  id: number
  title: string
  status: string
  priority: string
  description: string | null
  dueDate: string | null
  parentTaskItemId: number | null
  childTaskCount: number
  moveCount: number
  daysTagged: number
  projectId: number | null
  projectName: string | null
  currentJournalDate: string | null
}

function makeTasks(): TaskRow[] {
  return [
    { ...base, id: 1, title: 'Bravo task', status: 'Todo', priority: 'High', dueDate: '2030-01-03T00:00:00Z' },
    { ...base, id: 2, title: 'Alpha task', status: 'Todo', priority: 'High' },
    { ...base, id: 3, title: 'Charlie task', status: 'Todo', priority: 'Medium', projectId: 1, projectName: 'Alpha' },
    { ...base, id: 4, title: 'Delta draft', status: 'Draft', priority: 'Low' },
  ]
}

let tasks: TaskRow[]
let queryResult: { data: { data: TaskRow[] }; isLoading: false; error: null }
function setTasks(next: TaskRow[]) {
  tasks = next
  queryResult = { data: { data: tasks }, isLoading: false, error: null }
}

const updateMutate = vi.fn()
const updateAsync = vi.fn()
const createMutate = vi.fn()
const deleteMutate = vi.fn()

let narrow = true
const scrollIntoView = vi.fn()

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (
    <QueryClientProvider client={client}>
      <PrefsProvider>
        <MemoryRouter>
          <TasksPage />
        </MemoryRouter>
      </PrefsProvider>
    </QueryClientProvider>
  )
  return render(ui)
}

const titles = () => Array.from(document.querySelectorAll('.t-task-link')).map(a => a.textContent)
const groupHeader = (name: RegExp) => screen.getByRole('button', { name })
const editButton = (id: number) => document.querySelector<HTMLElement>(`[data-task-edit-id="${id}"]`) as HTMLElement
const filtersToggle = () => screen.getByRole('button', { name: /^Filters/ })

describe('TasksPage on mobile (#317)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    narrow = true
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn((query: string) => ({ matches: query.includes('820') ? narrow : false })),
      configurable: true,
      writable: true,
    })
    __resetCoarsePointerCache()
    Element.prototype.scrollIntoView = scrollIntoView

    setTasks(makeTasks())
    vi.mocked(useTasksQuery).mockImplementation(() => queryResult as never)
    updateMutate.mockReset()
    updateAsync.mockReset().mockResolvedValue({})
    createMutate.mockReset()
    deleteMutate.mockReset()
    vi.mocked(useUpdateTaskMutation).mockReturnValue({ mutate: updateMutate, mutateAsync: updateAsync, isPending: false } as never)
    vi.mocked(useCreateTaskMutation).mockReturnValue({ mutate: createMutate, mutateAsync: vi.fn(), isPending: false } as never)
    vi.mocked(useDeleteTaskMutation).mockReturnValue({ mutate: deleteMutate, isPending: false } as never)
    vi.mocked(useBlockTaskMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.mocked(useUnblockTaskMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useEditBlockedReasonMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useProjectsQuery).mockReturnValue({
      data: { data: [{ id: 1, name: 'Alpha', isArchived: false }, { id: 2, name: 'Beta', isArchived: false }] },
      isSuccess: true,
    } as never)
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    __resetCoarsePointerCache()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('is-dark')
    document.body.style.overflow = ''
    localStorage.clear()
  })

  describe('sort control (AC19-21)', () => {
    it('lists Title, Status, Priority, Due Date and re-sorts immediately', async () => {
      renderPage()
      const select = screen.getByLabelText('Sort by')
      expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['Title', 'Status', 'Priority', 'Due Date'])
      expect(titles()).toEqual(['Alpha task', 'Bravo task', 'Charlie task', 'Delta draft'])
      await userEvent.selectOptions(select, 'dueDate')
      expect(titles().slice(0, 2)).toEqual(['Bravo task', 'Alpha task'])
    })

    it('flips the direction label and reverses the order; the header button follows', async () => {
      renderPage()
      const toggle = screen.getByRole('button', { name: 'Sort descending' })
      expect(screen.getByRole('button', { name: 'Title ↑' })).toBeInTheDocument()
      await userEvent.click(toggle)
      expect(screen.getByRole('button', { name: 'Sort ascending' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Sort descending' })).not.toBeInTheDocument()
      expect(titles().slice(0, 2)).toEqual(['Bravo task', 'Alpha task'])
      expect(screen.getByRole('button', { name: 'Title ↓' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Sort ascending' }))
      expect(titles().slice(0, 2)).toEqual(['Alpha task', 'Bravo task'])
    })

    it('stays in sync with a header click', async () => {
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'Title ↑' }))
      expect(screen.getByRole('button', { name: 'Sort ascending' })).toBeInTheDocument()
    })

    it('persists the sort and restores it after a remount', async () => {
      const first = renderPage()
      await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'priority')
      await userEvent.click(screen.getByRole('button', { name: 'Sort descending' }))
      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
        expect(saved.taskSortKey).toBe('priority')
        expect(saved.taskSortDir).toBe('desc')
      })
      first.unmount()

      renderPage()
      expect(screen.getByLabelText('Sort by')).toHaveValue('priority')
      expect(screen.getByRole('button', { name: 'Sort ascending' })).toBeInTheDocument()
    })

    it('does not toggle a collapsed group when the sort changes', async () => {
      renderPage()
      await userEvent.click(groupHeader(/High Priority/))
      expect(groupHeader(/High Priority/)).toHaveAttribute('aria-expanded', 'false')
      await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'priority')
      expect(groupHeader(/High Priority/)).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Alpha task')).not.toBeInTheDocument()
    })
  })

  describe('group headers (AC23-24)', () => {
    it('is a single button with name, count and aria-expanded that toggles once', async () => {
      renderPage()
      const header = groupHeader(/High Priority/)
      expect(header).toHaveAccessibleName('High Priority · 2 tasks')
      expect(header).toHaveAttribute('aria-expanded', 'true')
      await userEvent.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Alpha task')).not.toBeInTheDocument()
      header.focus()
      await userEvent.keyboard('{Enter}')
      expect(header).toHaveAttribute('aria-expanded', 'true')
      await userEvent.keyboard(' ')
      expect(header).toHaveAttribute('aria-expanded', 'false')
    })

    it('keeps a collapsed group collapsed after a remount (AC24)', async () => {
      const first = renderPage()
      await userEvent.click(groupHeader(/Medium Priority/))
      expect(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '[]')).toEqual(['medium'])
      first.unmount()
      renderPage()
      expect(groupHeader(/Medium Priority/)).toHaveAttribute('aria-expanded', 'false')
      expect(groupHeader(/High Priority/)).toHaveAttribute('aria-expanded', 'true')
      expect(screen.queryByText('Charlie task')).not.toBeInTheDocument()
    })

    it('survives corrupt stored collapsed groups', () => {
      localStorage.setItem(COLLAPSED_GROUPS_KEY, '}{not json')
      renderPage()
      expect(groupHeader(/High Priority/)).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('Filters toggle (AC27-28)', () => {
    it('starts collapsed with aria-controls pointing at an existing element', () => {
      renderPage()
      const toggle = filtersToggle()
      expect(toggle).toHaveAccessibleName('Filters')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
      expect(panel).not.toBeNull()
      expect(panel).toHaveAttribute('data-collapsed', 'true')
    })

    it('opens on click and counts non-default status and project (AC27)', async () => {
      renderPage()
      await userEvent.click(filtersToggle())
      expect(filtersToggle()).toHaveAttribute('aria-expanded', 'true')
      expect(document.getElementById('t-filter-fields')).toHaveAttribute('data-collapsed', 'false')

      await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
      expect(filtersToggle()).toHaveAccessibleName('Filters (1)')

      await userEvent.selectOptions(screen.getByLabelText('Project'), '1')
      expect(filtersToggle()).toHaveAccessibleName('Filters (2)')
      // Still open: changing a filter inside never auto-closes the panel.
      expect(filtersToggle()).toHaveAttribute('aria-expanded', 'true')

      await userEvent.click(screen.getByRole('checkbox', { name: 'Draft' }))
      await userEvent.selectOptions(screen.getByLabelText('Project'), 'all')
      expect(filtersToggle()).toHaveAccessibleName('Filters')
      expect(filtersToggle()).toHaveAttribute('aria-expanded', 'true')
    })

    it('counts project-only as 1 and ignores search text and view chips', async () => {
      renderPage()
      await userEvent.selectOptions(screen.getByLabelText('Project'), 'none')
      expect(filtersToggle()).toHaveAccessibleName('Filters (1)')
      await userEvent.type(screen.getByPlaceholderText('Search tasks...'), 'alp')
      await userEvent.click(screen.getByRole('button', { name: 'Active today' }))
      expect(filtersToggle()).toHaveAccessibleName('Filters (1)')
    })

    it('shows only the count as a cue when the panel is collapsed with an active filter', async () => {
      renderPage()
      await userEvent.click(filtersToggle())
      await userEvent.click(screen.getByRole('checkbox', { name: 'Blocked (0)' }))
      await userEvent.click(filtersToggle())
      expect(filtersToggle()).toHaveAttribute('aria-expanded', 'false')
      expect(filtersToggle()).toHaveAccessibleName('Filters (1)')
      expect(document.getElementById('t-filter-fields')).toHaveAttribute('data-collapsed', 'true')
    })
  })

  describe('edit and new panel (AC32-34)', () => {
    it('scrolls the panel into view and focuses the title at <=820px', async () => {
      renderPage()
      await userEvent.click(within(screen.getByText('Alpha task').closest('tr') as HTMLElement).getByRole('button', { name: 'Edit' }))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus()
    })

    it('does not scroll above 820px (AC33)', async () => {
      narrow = false
      renderPage()
      await userEvent.click(editButton(2))
      expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeInTheDocument()
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveFocus()
    })

    it('evaluates the viewport at click time', async () => {
      narrow = false
      renderPage()
      await userEvent.click(editButton(2))
      expect(scrollIntoView).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      narrow = true
      await userEvent.click(editButton(2))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })

    it('scrolls and focuses for New Task too', async () => {
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus()
    })

    it('keeps the open panel when the viewport crosses a breakpoint mid-edit', async () => {
      renderPage()
      await userEvent.click(editButton(2))
      narrow = false
      expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeInTheDocument()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })

    it('returns focus to the Edit button after Save (AC34)', async () => {
      renderPage()
      await userEvent.click(editButton(2))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(editButton(2)).toHaveFocus())
    })

    it('returns focus to the Edit button after Cancel', async () => {
      renderPage()
      await userEvent.click(editButton(1))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(editButton(1)).toHaveFocus()
    })

    it('finds the Edit button after a priority change remounts the row', async () => {
      updateAsync.mockImplementation(async () => {
        setTasks(tasks.map(t => (t.id === 2 ? { ...t, priority: 'Low' } : t)))
        return {}
      })
      renderPage()
      const before = editButton(2)
      await userEvent.click(before)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Task' })).not.toBeInTheDocument())
      expect(editButton(2)).not.toBe(before)
      expect(editButton(2)).toHaveFocus()
    })

    it('restores focus to the new Edit button when the refetch remounts the row after the panel closed', async () => {
      const listeners = new Set<() => void>()
      vi.mocked(useTasksQuery).mockImplementation((() => {
        useSyncExternalStore(
          cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
          () => queryResult,
        )
        return queryResult
      }) as never)
      renderPage()
      const before = editButton(2)
      await userEvent.click(before)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Task' })).not.toBeInTheDocument())
      expect(editButton(2)).toHaveFocus()

      // The refetch lands after the panel closed and moves the task to another group.
      act(() => {
        setTasks(tasks.map(t => (t.id === 2 ? { ...t, priority: 'Low' } : t)))
        listeners.forEach(l => l())
      })
      const after = editButton(2)
      expect(after).not.toBe(before)
      expect(document.activeElement).toBe(after)
      expect(after).toHaveAttribute('data-task-edit-id', '2')
    })

    it('does not steal focus on a later refetch once the user moved focus', async () => {
      const listeners = new Set<() => void>()
      vi.mocked(useTasksQuery).mockImplementation((() => {
        useSyncExternalStore(
          cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
          () => queryResult,
        )
        return queryResult
      }) as never)
      renderPage()
      await userEvent.click(editButton(2))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(editButton(2)).toHaveFocus())
      await userEvent.click(document.body)
      expect(document.activeElement).toBe(document.body)
      act(() => {
        setTasks(tasks.map(t => (t.id === 2 ? { ...t, priority: 'Low' } : t)))
        listeners.forEach(l => l())
      })
      expect(document.activeElement).toBe(document.body)
    })

    it('keeps the panel open and does not steal focus when the save fails', async () => {
      updateAsync.mockRejectedValue(new Error('boom'))
      renderPage()
      await userEvent.click(editButton(2))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes')
      expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeInTheDocument()
      expect(editButton(2)).not.toHaveFocus()
    })

    it('skips focus return silently when the row is gone', async () => {
      renderPage()
      await userEvent.click(editButton(4))
      setTasks(tasks.filter(t => t.id !== 4))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('heading', { name: 'Edit Task' })).not.toBeInTheDocument()
      expect(document.querySelector('[data-task-edit-id="4"]')).toBeNull()
    })

    it('returns focus to New Task after Save and Cancel', async () => {
      createMutate.mockImplementation((_data, opts: { onSuccess?: () => void }) => opts.onSuccess?.())
      renderPage()
      const newTask = screen.getByRole('button', { name: 'New Task' })
      await userEvent.click(newTask)
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(newTask).toHaveFocus()

      await userEvent.click(newTask)
      await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Fresh')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(createMutate).toHaveBeenCalled()
      await waitFor(() => expect(newTask).toHaveFocus())
    })
  })

  describe('history sheet (AC35-36)', () => {
    it('is a labelled modal dialog with focus on Close', async () => {
      renderPage()
      await userEvent.click(screen.getAllByRole('button', { name: 'Task history' })[0])
      const dialog = screen.getByRole('dialog', { name: 'Task history' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveClass('sheet')
      expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
      expect(document.body.style.overflow).toBe('hidden')
    })

    it('keeps Tab inside the dialog', async () => {
      renderPage()
      await userEvent.click(screen.getAllByRole('button', { name: 'Task history' })[0])
      const dialog = screen.getByRole('dialog')
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
      await userEvent.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it.each([
      ['Escape', async () => { await userEvent.keyboard('{Escape}') }],
      ['the Close button', async () => { await userEvent.click(screen.getByRole('button', { name: 'Close' })) }],
      ['the backdrop', async () => { await userEvent.click(document.querySelector('.sheet-backdrop') as HTMLElement) }],
    ])('closes on %s, returns focus to the trigger and releases the scroll lock', async (_label, close) => {
      renderPage()
      const trigger = screen.getAllByRole('button', { name: 'Task history' })[0]
      await userEvent.click(trigger)
      await close()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
      expect(document.body.style.overflow).toBe('')
    })
  })

  describe('desktop behaviour (AC40)', () => {
    beforeEach(() => {
      narrow = false
    })

    it('keeps header sort, inline filter fields and status cycling', async () => {
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: 'Title ↑' }))
      expect(titles().slice(0, 2)).toEqual(['Bravo task', 'Alpha task'])
      // Filter fields are rendered (hidden only by the <=480 stylesheet rule), never with the `hidden` attribute.
      expect(screen.getByRole('checkbox', { name: 'To-do' })).toBeInTheDocument()
      expect(document.getElementById('t-filter-fields')?.hasAttribute('hidden')).toBe(false)
    })

    it('cycles status on Enter and Space with PascalCase-safe payloads (AC14)', async () => {
      renderPage()
      const control = within(screen.getByText('Alpha task').closest('tr') as HTMLElement).getByRole('button', { name: /^Status: todo/ })
      control.focus()
      await userEvent.keyboard('{Enter}')
      expect(updateMutate).toHaveBeenCalledTimes(1)
      expect(updateMutate.mock.calls[0][0].data.status).toBe('completed')
      await userEvent.keyboard(' ')
      expect(updateMutate).toHaveBeenCalledTimes(2)
    })
  })

  describe('status cycle failure and delete', () => {
    it('shows the error and keeps the 44px control after a failed cycle', async () => {
      updateMutate.mockImplementation((_vars, opts: { onError?: (e: unknown) => void }) => opts.onError?.(new Error('x')))
      renderPage()
      const row = screen.getByText('Alpha task').closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('button', { name: /^Status: todo/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes')
      expect(within(row).getByRole('button', { name: /^Status: todo/ })).toHaveClass('tap-target')
    })

    it('asks for confirmation and does not delete when cancelled (AC42)', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderPage()
      await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
      expect(confirm).toHaveBeenCalledWith('Delete "Alpha task"?')
      expect(deleteMutate).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
      expect(deleteMutate).toHaveBeenCalledTimes(1)
      expect(deleteMutate.mock.calls[0][0]).toBe(2)
      confirm.mockRestore()
    })
  })

  describe('table semantics (AC11)', () => {
    it('exposes the table, row groups, rows, cells and column headers', () => {
      renderPage()
      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getAllByRole('rowgroup')).toHaveLength(2)
      expect(screen.getAllByRole('columnheader').length).toBe(5)
      expect(screen.getAllByRole('row').length).toBeGreaterThan(4)
    })
  })

  it('does not write to localStorage collapsed groups while rendering', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderPage()
    expect(setItem.mock.calls.some(([key]) => key === COLLAPSED_GROUPS_KEY)).toBe(false)
    setItem.mockRestore()
  })
})
