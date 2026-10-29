import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { makeProviders } from '@/test/renderWithToast'
import { TasksPage } from './TasksPage'

// Real ToastProvider, real hooks and a real QueryClient. Only the network layer is mocked.
vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  patchApiV1TaskItemsById: vi.fn(),
  getTaskV1: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
}))

vi.mock('@/api/projects', () => ({
  getProjects: vi.fn(),
  getProject: vi.fn(),
  getProjectTasks: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'
import { getProjects } from '@/api/projects'

interface Row {
  id: number
  title: string
  status: string
  priority: string
  parentTaskItemId: number | null
  childTaskCount: number
}

const row = (id: number, title: string, priority = 'High', extra: Partial<Row> = {}): Row => ({
  id,
  title,
  status: 'Todo',
  priority,
  parentTaskItemId: null,
  childTaskCount: 0,
  ...extra,
})

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })

let server: Row[]
let qc: QueryClient
let locationSeen: { pathname: string; state: unknown }

function LocationProbe() {
  const location = useLocation()
  useEffect(() => {
    locationSeen = { pathname: location.pathname, state: location.state }
  })
  return null
}

function renderPage(initialEntry: string | { pathname: string; state: unknown } = '/tasks') {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Providers = makeProviders(qc)
  return render(
    <Providers>
      <PrefsProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <Routes>
            <Route path="/tasks" element={<TasksPage />} />
          </Routes>
        </MemoryRouter>
      </PrefsProvider>
    </Providers>,
  )
}

const deleteButton = (title: string) => screen.getByRole('button', { name: `Delete task: ${title}` })
const deleteButtons = () => screen.getAllByRole('button', { name: /^Delete task: / })
const deleteCalls = () => vi.mocked(sdk.deleteApiV1TaskItemsById).mock.calls
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const toastRegion = () => screen.getByRole('region', { name: 'Notifications' })

/** Loads the page on real timers, then switches to fake ones for the undo window. */
async function loadPage(entry?: Parameters<typeof renderPage>[0]) {
  renderPage(entry)
  await screen.findByRole('heading', { name: 'Tasks' })
  await waitFor(() => expect(screen.queryByText('Loading tasks...')).not.toBeInTheDocument())
  vi.useFakeTimers()
}

describe('TasksPage undoable delete (#321)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    server = [row(1, 'Alpha task'), row(2, 'Bravo task'), row(3, 'Charlie task')]
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() =>
      Promise.resolve({ data: structuredClone(server), response: json(200) })) as never)
    vi.mocked(getProjects).mockResolvedValue({ data: [] } as never)
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockImplementation(((opts: { path: { id: number } }) => {
      server = server.filter(t => t.id !== opts.path.id)
      return Promise.resolve({ response: json(200) })
    }) as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  describe('click', () => {
    it('removes the row at once with no confirm and shows the Undo toast (AC4)', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      await loadPage()
      fireEvent.click(deleteButton('Bravo task'))
      expect(confirm).not.toHaveBeenCalled()
      expect(screen.queryByText('Bravo task')).not.toBeInTheDocument()
      const toast = within(toastRegion()).getByRole('status')
      expect(toast).toHaveTextContent('Task deleted: "Bravo task"')
      expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      expect(deleteCalls()).toHaveLength(0)
      confirm.mockRestore()
    })

    it('does not truncate a long title in the toast message', async () => {
      const long = 'L'.repeat(120)
      server = [row(1, long)]
      await loadPage()
      fireEvent.click(deleteButton(long))
      expect(within(toastRegion()).getByRole('status')).toHaveTextContent(`Task deleted: "${long}"`)
    })
  })

  describe('focus (AC5)', () => {
    it('moves focus to the next row Delete synchronously', async () => {
      await loadPage()
      const [first, second] = deleteButtons()
      fireEvent.click(first)
      // Immediately after the click, before any timers or effects.
      expect(second).toHaveFocus()
    })

    it('moves focus to the previous row Delete when the last row is deleted', async () => {
      await loadPage()
      const all = deleteButtons()
      fireEvent.click(all[2])
      expect(all[1]).toHaveFocus()
    })

    it('moves focus to New Task when the list becomes empty', async () => {
      server = [row(1, 'Only task')]
      await loadPage()
      fireEvent.click(deleteButton('Only task'))
      expect(screen.getByRole('button', { name: 'New Task' })).toHaveFocus()
    })

    it('skips group headers: the last High row focuses the first Medium row Delete', async () => {
      server = [row(1, 'High one'), row(2, 'Medium one', 'Medium')]
      await loadPage()
      fireEvent.click(deleteButton('High one'))
      expect(deleteButton('Medium one')).toHaveFocus()
    })

    it('skips a collapsed group', async () => {
      server = [row(1, 'High one'), row(2, 'Medium one', 'Medium'), row(3, 'Low one', 'Low')]
      await loadPage()
      fireEvent.click(screen.getByRole('button', { name: /Medium Priority/ }))
      expect(screen.queryByText('Medium one')).not.toBeInTheDocument()
      fireEvent.click(deleteButton('High one'))
      expect(deleteButton('Low one')).toHaveFocus()
    })

    it('closes the edit panel when the edited task is deleted', async () => {
      await loadPage()
      fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
      expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeInTheDocument()
      fireEvent.click(deleteButton('Bravo task'))
      expect(screen.queryByRole('heading', { name: 'Edit Task' })).not.toBeInTheDocument()
    })

    it('closes the add-subtask editor opened for the deleted task', async () => {
      await loadPage()
      fireEvent.click(screen.getAllByRole('button', { name: 'Add subtask' })[0])
      expect(screen.getByPlaceholderText('Enter subtask title')).toBeInTheDocument()
      fireEvent.click(deleteButton('Alpha task'))
      expect(screen.queryByPlaceholderText('Enter subtask title')).not.toBeInTheDocument()
    })
  })

  describe('Undo (AC6)', () => {
    it('the Undo button restores the row, focuses its Delete and sends no DELETE', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Bravo task'))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await advance(20)
      expect(screen.getByText('Bravo task')).toBeInTheDocument()
      expect(deleteButton('Bravo task')).toHaveFocus()
      await advance(10000)
      expect(deleteCalls()).toHaveLength(0)
    })

    it('Ctrl+Z restores the latest delete', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Bravo task'))
      // Focus sits on the next row after a delete, which is not a text field.
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'z', ctrlKey: true })
      expect(screen.getByText('Bravo task')).toBeInTheDocument()
      await advance(10000)
      expect(deleteCalls()).toHaveLength(0)
    })

    it('"u" with focus on another row restores but leaves focus where it is', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Alpha task'))
      const focused = deleteButton('Bravo task')
      expect(focused).toHaveFocus()
      fireEvent.keyDown(focused, { key: 'u' })
      await advance(20)
      expect(screen.getByText('Alpha task')).toBeInTheDocument()
      expect(focused).toHaveFocus()
    })

    it('"u" with focus on the body restores focus to the restored row', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Alpha task'))
      act(() => (document.activeElement as HTMLElement | null)?.blur())
      fireEvent.keyDown(document.body, { key: 'u' })
      await advance(20)
      expect(deleteButton('Alpha task')).toHaveFocus()
    })

    it('Ctrl+Z and "u" are ignored while typing in the search field', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Alpha task'))
      const search = screen.getByPlaceholderText('Search tasks...')
      act(() => search.focus())
      fireEvent.keyDown(search, { key: 'u' })
      fireEvent.keyDown(search, { key: 'z', ctrlKey: true })
      expect(screen.queryByText('Alpha task')).not.toBeInTheDocument()
    })

    it('Undo after the row no longer exists is a no-op', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Alpha task'))
      // The row is hidden by a search filter when Undo runs.
      fireEvent.change(screen.getByPlaceholderText('Search tasks...'), { target: { value: 'Charlie' } })
      await advance(250)
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await advance(20)
      expect(screen.queryByText('Alpha task')).not.toBeInTheDocument()
      expect(screen.getByText('Charlie task')).toBeInTheDocument()
    })
  })

  describe('commit (AC7)', () => {
    it('sends one DELETE after 10s, not before, then cleans up the caches in order', async () => {
      await loadPage()
      const order: string[] = []
      vi.spyOn(qc, 'removeQueries').mockImplementation(f => { order.push('remove:' + JSON.stringify(f?.queryKey)); return undefined })
      const invalidate = qc.invalidateQueries.bind(qc)
      vi.spyOn(qc, 'invalidateQueries').mockImplementation(f => { order.push('invalidate:' + JSON.stringify(f?.queryKey)); return invalidate(f) })
      fireEvent.click(deleteButton('Bravo task'))
      await advance(9900)
      expect(deleteCalls()).toHaveLength(0)
      await advance(200)
      expect(deleteCalls()).toHaveLength(1)
      expect(deleteCalls()[0][0]).toEqual({ path: { id: 2 } })
      expect(order).toEqual(['remove:["tasks",2]', 'invalidate:["tasks"]', 'invalidate:["projects"]', 'invalidate:["journal"]'])
      expect(screen.queryByText('Bravo task')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('treats 404 as success: no rollback and no error toast (AC21)', async () => {
      vi.mocked(sdk.deleteApiV1TaskItemsById).mockImplementation(((opts: { path: { id: number } }) => {
        server = server.filter(t => t.id !== opts.path.id)
        return Promise.resolve({ error: {}, response: json(404) })
      }) as never)
      await loadPage()
      fireEvent.click(deleteButton('Bravo task'))
      await advance(10100)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText('Bravo task')).not.toBeInTheDocument()
    })

    it('restores the row with the subtasks error on a 422 and keeps the alert until dismissed (AC22)', async () => {
      vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({
        error: { code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' },
        response: json(422),
      } as never)
      await loadPage()
      fireEvent.click(deleteButton('Bravo task'))
      await advance(10100)
      const alert = within(toastRegion()).getByRole('alert')
      expect(alert).toHaveTextContent("Can't delete: this task has subtasks.")
      expect(screen.getByText('Bravo task')).toBeInTheDocument()
      await advance(30000)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      fireEvent.click(within(alert).getByRole('button', { name: /dismiss/i }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('restores the row with the generic message on any other failure (AC22)', async () => {
      vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({ error: { message: 'boom' }, response: json(500) } as never)
      await loadPage()
      fireEvent.click(deleteButton('Bravo task'))
      await advance(10100)
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't delete the task. Restored.")
      expect(screen.getByText('Bravo task')).toBeInTheDocument()
    })

    it('a fourth pending delete hides the oldest Undo but every delete still commits on time', async () => {
      server = [row(1, 'T1'), row(2, 'T2'), row(3, 'T3'), row(4, 'T4'), row(5, 'T5')]
      await loadPage()
      for (const title of ['T1', 'T2', 'T3', 'T4']) fireEvent.click(deleteButton(title))
      expect(within(toastRegion()).getAllByRole('button', { name: 'Undo' })).toHaveLength(3)
      expect(within(toastRegion()).queryByText('Task deleted: "T1"')).not.toBeInTheDocument()
      await advance(10100)
      expect(deleteCalls().map(c => (c[0] as { path: { id: number } }).path.id)).toEqual([1, 2, 3, 4])
    })

    it('"u" undoes the latest delete first', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Alpha task'))
      fireEvent.click(deleteButton('Bravo task'))
      fireEvent.keyDown(document.body, { key: 'u' })
      await advance(20)
      expect(screen.getByText('Bravo task')).toBeInTheDocument()
      expect(screen.queryByText('Alpha task')).not.toBeInTheDocument()
    })
  })

  describe('parents with subtasks (AC14, AC15)', () => {
    beforeEach(() => {
      server = [
        row(1, 'Parent task', 'High', { childTaskCount: 2 }),
        row(2, 'Child one', 'High', { parentTaskItemId: 1 }),
        row(3, 'Child two', 'High', { parentTaskItemId: 1 }),
      ]
    })

    it('Delete is aria-disabled, tabbable, and click schedules nothing', async () => {
      await loadPage()
      const btn = deleteButton('Parent task')
      expect(btn).toHaveAttribute('aria-disabled', 'true')
      expect(btn).not.toBeDisabled()
      expect(btn).toHaveAccessibleDescription('Delete subtasks first (2)')
      expect(btn).toHaveAttribute('title', 'Delete subtasks first (2)')
      fireEvent.click(btn)
      act(() => btn.focus())
      fireEvent.keyDown(btn, { key: 'Enter' })
      expect(within(toastRegion()).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
      await advance(11000)
      expect(deleteCalls()).toHaveLength(0)
    })

    it('N excludes pending children and the parent Delete enables after the last child is pending', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Child one'))
      expect(deleteButton('Parent task')).toHaveAccessibleDescription('Delete subtasks first (1)')
      fireEvent.click(deleteButton('Child two'))
      const parentDelete = deleteButton('Parent task')
      expect(parentDelete).not.toHaveAttribute('aria-disabled')
      fireEvent.click(parentDelete)
      expect(within(toastRegion()).getByText('Task deleted: "Parent task"')).toBeInTheDocument()
      await advance(10100)
      // Subtasks were scheduled first, so they commit before the parent.
      expect(deleteCalls().map(c => (c[0] as { path: { id: number } }).path.id)).toEqual([2, 3, 1])
    })

    it('a subtask undone while the parent is pending turns the parent commit into a 422 rollback', async () => {
      await loadPage()
      fireEvent.click(deleteButton('Child one'))
      fireEvent.click(deleteButton('Child two'))
      fireEvent.click(deleteButton('Parent task'))
      // The server still has the undone subtask, so it refuses the parent.
      vi.mocked(sdk.deleteApiV1TaskItemsById).mockImplementation(((opts: { path: { id: number } }) => {
        if (opts.path.id === 1) {
          return Promise.resolve({ error: { code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN' }, response: json(422) })
        }
        server = server.filter(t => t.id !== opts.path.id)
        return Promise.resolve({ response: json(200) })
      }) as never)
      // Undo the latest (parent) is not wanted here: undo the child via its own toast instead.
      const undoButtons = within(toastRegion()).getAllByRole('button', { name: 'Undo' })
      expect(undoButtons).toHaveLength(3)
      fireEvent.click(undoButtons[1])
      await advance(11000)
      expect(screen.getByRole('alert')).toHaveTextContent("Can't delete: this task has subtasks.")
      expect(screen.getByText('Parent task')).toBeInTheDocument()
    })
  })

  describe('arriving after a detail-page delete (AC10)', () => {
    it('focuses New Task once and clears the navigation state', async () => {
      renderPage({ pathname: '/tasks', state: { focusNewTask: true } })
      const newTask = await screen.findByRole('button', { name: 'New Task' })
      await waitFor(() => expect(newTask).toHaveFocus())
      await waitFor(() => expect(locationSeen.state).toBeNull())
    })

    it('does not focus New Task on a plain visit', async () => {
      renderPage('/tasks')
      const newTask = await screen.findByRole('button', { name: 'New Task' })
      expect(newTask).not.toHaveFocus()
      expect(locationSeen.state).toBeNull()
    })
  })
})
