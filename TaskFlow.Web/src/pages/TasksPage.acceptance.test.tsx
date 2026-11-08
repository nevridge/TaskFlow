import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { Layout } from '@/components/Layout'
import { __resetCoarsePointerCache } from '@/lib/pointer'
import { TasksPage } from './TasksPage'

// Real hooks (including the real update mutation) over a mocked SDK, so a failed status cycle exercises real behaviour.
vi.mock('@/api/client/sdk.gen', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client/sdk.gen')>()
  return {
    ...actual,
    getApiV1TaskItems: vi.fn(),
    putApiV1TaskItemsById: vi.fn(),
    patchApiV1TaskItemsById: vi.fn(),
    postApiV1TaskItems: vi.fn(),
  }
})
vi.mock('@/api/tasks', () => ({ getTaskHistory: vi.fn().mockResolvedValue({ data: [] }) }))
vi.mock('@/hooks/useProjects', () => ({
  useProjectsQuery: vi.fn(() => ({ data: { data: [] }, isSuccess: true })),
  useChangeTaskProject: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false })),
}))
vi.mock('@/components/Nav', () => ({ Nav: () => <nav aria-label="Main" /> }))
vi.mock('@/components/SettingsDrawer', () => ({ SettingsDrawer: () => null }))

import { getApiV1TaskItems, putApiV1TaskItemsById, patchApiV1TaskItemsById, postApiV1TaskItems } from '@/api/client/sdk.gen'
import { COLLAPSED_GROUPS_KEY } from '@/hooks/useCollapsedGroups'

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
const tasks = [
  { ...base, id: 1, title: 'Alpha task', status: 'Todo', priority: 'High' },
  { ...base, id: 2, title: 'Bravo task', status: 'Todo', priority: 'High' },
]

function LocationProbe() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

function renderPage(initial = '/tasks') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PrefsProvider>
        <MemoryRouter initialEntries={[initial]}>
          <LocationProbe />
          <Routes>
            <Route element={<Layout />}>
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/journal/:date" element={<div>journal stub</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </PrefsProvider>
    </QueryClientProvider>,
  )
}

describe('TasksPage acceptance (#317)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn(() => ({ matches: false })),
      configurable: true,
      writable: true,
    })
    __resetCoarsePointerCache()
    vi.mocked(getApiV1TaskItems).mockResolvedValue({ data: tasks } as never)
    vi.mocked(putApiV1TaskItemsById).mockResolvedValue({ data: {} } as never)
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    document.body.style.overflow = ''
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('is-dark')
    localStorage.clear()
  })

  describe('desktop global shortcuts still work on /tasks (AC40)', () => {
    it('opens the shortcuts help with ?', async () => {
      renderPage()
      await screen.findByText('Alpha task')
      await userEvent.keyboard('?')
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })

    it('navigates with the g then h chord to Home and stays put on an unknown second key', async () => {
      renderPage()
      await screen.findByText('Alpha task')
      await userEvent.keyboard('gx')
      expect(screen.getByTestId('path')).toHaveTextContent('/tasks')
      await userEvent.keyboard('gh')
      await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/journal/'))
    })

    it('g t keeps the user on /tasks', async () => {
      renderPage()
      await screen.findByText('Alpha task')
      await userEvent.keyboard('gt')
      expect(screen.getByTestId('path')).toHaveTextContent('/tasks')
      expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    })

    it('does not fire shortcuts while typing in the search box', async () => {
      renderPage()
      await screen.findByText('Alpha task')
      await userEvent.type(screen.getByPlaceholderText(/Search title or #id/), '?')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('status cycle with real mutation hooks (AC14, rollback edge case)', () => {
    it('sends the PascalCase-safe request and cycles once per Enter and per Space', async () => {
      renderPage()
      const row = (await screen.findByText('Alpha task')).closest('tr') as HTMLElement
      const control = within(row).getByRole('button', { name: /^Status: To-do/ })
      control.focus()
      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(putApiV1TaskItemsById).toHaveBeenCalledTimes(1))
      expect(vi.mocked(putApiV1TaskItemsById).mock.calls[0][0]).toMatchObject({
        path: { id: 1 },
        body: { title: 'Alpha task', status: 'inProgress' },
      })
      await userEvent.keyboard(' ')
      await waitFor(() => expect(putApiV1TaskItemsById).toHaveBeenCalledTimes(2))
    })

    it('leaves the row unchanged, shows the error and keeps the 44px control when the save fails', async () => {
      vi.mocked(putApiV1TaskItemsById).mockRejectedValue(new Error('network'))
      renderPage()
      const row = (await screen.findByText('Alpha task')).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('button', { name: /^Status: To-do/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes')
      const after = (screen.getByText('Alpha task').closest('tr')) as HTMLElement
      const control = within(after).getByRole('button', { name: /^Status: To-do/ })
      expect(control).toHaveClass('tap-target')
    })
  })

  describe('status cycle due date wire format (#238)', () => {
    it('sends dueDate null for a task with no due date', async () => {
      renderPage()
      const row = (await screen.findByText('Alpha task')).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('button', { name: /^Status: To-do/ }))
      await waitFor(() => expect(putApiV1TaskItemsById).toHaveBeenCalledTimes(1))
      const body = vi.mocked(putApiV1TaskItemsById).mock.calls[0][0].body as Record<string, unknown>
      expect(body).toHaveProperty('dueDate', null)
    })

    it('sends the unchanged YYYY-MM-DD dueDate for a task with a due date', async () => {
      vi.mocked(getApiV1TaskItems).mockResolvedValue({
        data: [{ ...base, id: 5, title: 'Dated task', status: 'Todo', priority: 'High', dueDate: '2026-05-01' }],
      } as never)
      renderPage()
      const row = (await screen.findByText('Dated task')).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('button', { name: /^Status: To-do/ }))
      await waitFor(() => expect(putApiV1TaskItemsById).toHaveBeenCalledTimes(1))
      expect(vi.mocked(putApiV1TaskItemsById).mock.calls[0][0]).toMatchObject({
        path: { id: 5 },
        body: { dueDate: '2026-05-01' },
      })
    })

    it('rolls the row back to its previous status and surfaces the error when the API answers 400', async () => {
      vi.mocked(putApiV1TaskItemsById).mockRejectedValue({ status: 400, title: 'One or more validation errors occurred.' })
      renderPage()
      const row = (await screen.findByText('Alpha task')).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('button', { name: /^Status: To-do/ }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      const after = screen.getByText('Alpha task').closest('tr') as HTMLElement
      expect(within(after).getByRole('button', { name: /^Status: To-do/ })).toBeInTheDocument()
      expect(within(after).queryByRole('button', { name: /^Status: In Progress/ })).not.toBeInTheDocument()
    })
  })

  describe('TASK_PARENT_COMPLETED_NOT_ALLOWED through the form (#368)', () => {
    const MESSAGE = "A completed task can't have open subtasks. Reopen the parent first, or keep this subtask completed."

    it('status cycle: a rejected reopen of a Completed subtask reverts the row and shows the mapped message', async () => {
      vi.mocked(getApiV1TaskItems).mockResolvedValue({
        data: [
          { ...base, id: 10, title: 'Shipped parent', status: 'Completed', priority: 'High', childTaskCount: 1 },
          { ...base, id: 11, title: 'Done child', status: 'Completed', priority: 'High', parentTaskItemId: 10 },
        ],
      } as never)
      vi.mocked(putApiV1TaskItemsById).mockRejectedValue({ code: 'TASK_PARENT_COMPLETED_NOT_ALLOWED' })
      renderPage()
      await waitFor(() => expect(document.querySelector('[data-section-toggle="completed"]')).not.toBeNull())
      const toggle = document.querySelector<HTMLElement>('[data-section-toggle="completed"]') as HTMLElement
      if (toggle.getAttribute('aria-expanded') !== 'true') await userEvent.click(toggle)
      const row = (await screen.findByText('Done child')).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('button', { name: /^Status: Completed/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE)
      expect(vi.mocked(putApiV1TaskItemsById).mock.calls[0][0]).toMatchObject({ path: { id: 11 }, body: { status: 'draft' } })
      const after = screen.getByText('Done child').closest('tr') as HTMLElement
      expect(within(after).getByRole('button', { name: /^Status: Completed/ })).toBeInTheDocument()
    })

    it('create: shows the mapped message once, keeps the typed values, and clears it when the parent changes', async () => {
      vi.mocked(postApiV1TaskItems).mockRejectedValue({ code: 'TASK_PARENT_COMPLETED_NOT_ALLOWED' })
      renderPage()
      await screen.findByText('Alpha task')
      await userEvent.click(screen.getByRole('button', { name: 'New Task' }))
      await userEvent.type(screen.getByLabelText(/^title/i), 'Late subtask')
      await userEvent.selectOptions(screen.getByLabelText('Parent Task'), 'Alpha task')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      const alerts = await screen.findAllByRole('alert')
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent(MESSAGE)
      expect(screen.getByLabelText(/^title/i)).toHaveValue('Late subtask')
      expect(screen.getByLabelText('Parent Task')).toHaveValue('1')
      expect(vi.mocked(postApiV1TaskItems).mock.calls[0][0]).toMatchObject({ body: { parentTaskItemId: 1 } })

      await userEvent.selectOptions(screen.getByLabelText('Parent Task'), 'None')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('history sheet focus trap edges (AC35-36)', () => {
    it('wraps Tab from the last control to the first and Shift+Tab from the first to the last', async () => {
      renderPage()
      await screen.findByText('Alpha task')
      await userEvent.click(screen.getAllByRole('button', { name: 'Task history' })[0])
      const dialog = screen.getByRole('dialog', { name: 'Task history' })
      const close = within(dialog).getByRole('button', { name: 'Close' })
      expect(close).toHaveFocus()

      // Close is the only focusable control when the history is empty; Tab and Shift+Tab must never leave the dialog.
      for (let i = 0; i < 3; i++) {
        await userEvent.tab()
        expect(dialog.contains(document.activeElement)).toBe(true)
      }
      await userEvent.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
      expect(document.activeElement).not.toBe(document.body)
    })

    it('returns focus to the History trigger after Escape and releases the scroll lock', async () => {
      renderPage()
      await screen.findByText('Alpha task')
      const trigger = screen.getAllByRole('button', { name: 'Task history' })[0]
      await userEvent.click(trigger)
      expect(document.body.style.overflow).toBe('hidden')
      await act(async () => {
        await userEvent.keyboard('{Escape}')
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
      expect(document.body.style.overflow).toBe('')
    })
  })

  describe('sort preference persistence with the real PrefsProvider (AC21)', () => {
    it('stores key and direction under taskflow_journal_prefs_v1 and restores them after remount', async () => {
      const first = renderPage()
      await screen.findByText('Alpha task')
      await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'status')
      await userEvent.click(screen.getByRole('button', { name: 'Sort descending' }))
      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem('taskflow_journal_prefs_v1') ?? '{}')
        expect(saved).toMatchObject({ taskSortKey: 'status', taskSortDir: 'desc' })
      })
      first.unmount()

      renderPage()
      await screen.findByText('Alpha task')
      expect(screen.getByLabelText('Sort by')).toHaveValue('status')
      expect(screen.getByRole('button', { name: 'Status ↓' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sort ascending' })).toBeInTheDocument()
    })
  })

  describe('sections and status-change focus with real mutation hooks (#384)', () => {
    const rows = [
      { ...base, id: 1, title: 'Alpha task', status: 'Todo', priority: 'High' },
      { ...base, id: 2, title: 'Bravo task', status: 'InProgress', priority: 'Medium' },
      { ...base, id: 3, title: 'Stuck task', status: 'Blocked', priority: 'High', previousStatus: 'Todo', blockedReason: 'Waiting' },
    ]
    const statusControl = (id: number) => document.querySelector<HTMLElement>(`[data-task-status-id="${id}"]`)
    const toggle = (name: RegExp) => screen.getByRole('button', { name })

    function deferredPut() {
      let resolve: (v: unknown) => void = () => {}
      let reject: (e: unknown) => void = () => {}
      vi.mocked(putApiV1TaskItemsById).mockImplementation((() =>
        new Promise((res, rej) => { resolve = res; reject = rej })) as never)
      return { resolve: () => resolve({ data: {} }), reject: (e: unknown) => reject(e) }
    }

    beforeEach(() => {
      vi.mocked(getApiV1TaskItems).mockResolvedValue({ data: rows } as never)
    })

    it.each([['Enter', '{Enter}'], ['Space', ' ']])(
      'moves the row to its new section at once and keeps focus on its status control (%s)',
      async (_label, key) => {
        const put = deferredPut()
        renderPage()
        await screen.findByText('Alpha task')
        expect(toggle(/^In Progress · 1 task/)).toBeInTheDocument()
        statusControl(1)?.focus()
        await userEvent.keyboard(key)
        // The request has not resolved yet: the move is optimistic.
        await waitFor(() => expect(toggle(/^In Progress · 2 tasks/)).toBeInTheDocument())
        expect(putApiV1TaskItemsById).toHaveBeenCalledTimes(1)
        expect(statusControl(1)).toHaveFocus()
        expect(screen.getByRole('status')).toHaveTextContent('Moved to In Progress')
        await act(async () => { put.resolve() })
        expect(statusControl(1)).toHaveFocus()
      },
    )

    it('moves focus to the collapsed Completed toggle without expanding it or writing storage', async () => {
      deferredPut()
      renderPage()
      await screen.findByText('Bravo task')
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      statusControl(2)?.focus()
      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(toggle(/^Completed · 1 task/)).toHaveFocus())
      expect(toggle(/^Completed · 1 task/)).toHaveAttribute('aria-expanded', 'false')
      expect(statusControl(2)).toBeNull()
      expect(setItem.mock.calls.some(([key]) => key === COLLAPSED_GROUPS_KEY)).toBe(false)
      expect(screen.getByRole('status')).toHaveTextContent('Moved to Completed')
      setItem.mockRestore()
    })

    it('returns the row to its section on failure, shows the error and keeps focus on the status control', async () => {
      const put = deferredPut()
      renderPage()
      await screen.findByText('Alpha task')
      statusControl(1)?.focus()
      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(toggle(/^In Progress · 2 tasks/)).toBeInTheDocument())
      await act(async () => { put.reject(new Error('network')) })
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes')
      expect(toggle(/^In Progress · 1 task/)).toBeInTheDocument()
      expect(toggle(/^High Priority · 1 task/)).toBeInTheDocument()
      await waitFor(() => expect(statusControl(1)).toHaveFocus())
    })

    it('keeps focus on the moved row after Unblock', async () => {
      vi.mocked(patchApiV1TaskItemsById).mockImplementation((() => new Promise(() => {})) as never)
      renderPage()
      await screen.findByText('Alpha task')
      await userEvent.click(toggle(/^Blocked · 1 task/))
      await userEvent.click(screen.getByRole('button', { name: 'Unblock task: Stuck task' }))
      await waitFor(() => expect(toggle(/^High Priority · 2 tasks/)).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /^Blocked ·/ })).not.toBeInTheDocument()
      expect(statusControl(3)).toHaveFocus()
    })
  })
})
