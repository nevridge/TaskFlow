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
  }
})
vi.mock('@/api/tasks', () => ({ getTaskHistory: vi.fn().mockResolvedValue({ data: [] }) }))
vi.mock('@/hooks/useProjects', () => ({
  useProjectsQuery: vi.fn(() => ({ data: { data: [] }, isSuccess: true })),
  useChangeTaskProject: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false })),
}))
vi.mock('@/components/Nav', () => ({ Nav: () => <nav aria-label="Main" /> }))
vi.mock('@/components/SettingsDrawer', () => ({ SettingsDrawer: () => null }))

import { getApiV1TaskItems, putApiV1TaskItemsById } from '@/api/client/sdk.gen'

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
      await userEvent.type(screen.getByPlaceholderText('Search tasks...'), '?')
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
})
