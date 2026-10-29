import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { makeProviders } from '@/test/renderWithToast'
import { TaskDetailPage } from './TaskDetailPage'
import { TasksPage } from './TasksPage'

// Real ToastProvider, hooks and routing. Only the network layer is mocked.
vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  patchApiV1TaskItemsById: vi.fn(),
  getTaskV1: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
  getApiV1TaskItemsByTaskIdNotes: vi.fn(),
  postApiV1TaskItemsByTaskIdNotes: vi.fn(),
  putApiV1TaskItemsByTaskIdNotesById: vi.fn(),
  deleteApiV1TaskItemsByTaskIdNotesById: vi.fn(),
}))

vi.mock('@/api/projects', () => ({
  getProjects: vi.fn(),
  getProject: vi.fn(),
  getProjectTasks: vi.fn(),
}))

vi.mock('@/api/tasks', () => ({ getTaskHistory: vi.fn() }))

import * as sdk from '@/api/client/sdk.gen'
import { getProjects } from '@/api/projects'
import { getTaskHistory } from '@/api/tasks'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })

interface Task {
  id: number
  title: string
  status: string
  priority: string
  parentTaskItemId: number | null
  childTaskCount: number
}
interface Note {
  id: number
  content: string
  taskItemId: number
}

let tasks: Task[]
let notes: Note[]
let locationSeen: { pathname: string; state: unknown }

function LocationProbe() {
  const location = useLocation()
  useEffect(() => {
    locationSeen = { pathname: location.pathname, state: location.state }
  })
  return null
}

function GoToTask() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/tasks/1')}>Go to task 1</button>
}

function renderApp(path = '/tasks/1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Providers = makeProviders(qc)
  const utils = render(
    <Providers>
      <PrefsProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <GoToTask />
          <Routes>
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
          </Routes>
        </MemoryRouter>
      </PrefsProvider>
    </Providers>,
  )
  return { ...utils, qc }
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const deleteTaskCalls = () => vi.mocked(sdk.deleteApiV1TaskItemsById).mock.calls
const deleteNoteCalls = () => vi.mocked(sdk.deleteApiV1TaskItemsByTaskIdNotesById).mock.calls

describe('TaskDetailPage undoable delete (#321)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    tasks = [
      { id: 1, title: 'Fix login bug', status: 'Todo', priority: 'High', parentTaskItemId: null, childTaskCount: 0 },
      { id: 2, title: 'Other task', status: 'Todo', priority: 'High', parentTaskItemId: null, childTaskCount: 0 },
    ]
    notes = [
      { id: 7, content: 'First note', taskItemId: 1 },
      { id: 8, content: 'Second note', taskItemId: 1 },
    ]
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() =>
      Promise.resolve({ data: structuredClone(tasks), response: json(200) })) as never)
    vi.mocked(sdk.getTaskV1).mockImplementation(((opts: { path: { id: number } }) => {
      const found = tasks.find(t => t.id === Number(opts.path.id))
      return Promise.resolve(found ? { data: structuredClone(found), response: json(200) } : { error: {}, response: json(404) })
    }) as never)
    vi.mocked(sdk.getApiV1TaskItemsByTaskIdNotes).mockImplementation((() =>
      Promise.resolve({ data: structuredClone(notes), response: json(200) })) as never)
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockImplementation(((opts: { path: { id: number } }) => {
      tasks = tasks.filter(t => t.id !== opts.path.id)
      return Promise.resolve({ response: json(200) })
    }) as never)
    vi.mocked(sdk.deleteApiV1TaskItemsByTaskIdNotesById).mockImplementation(((opts: { path: { id: number } }) => {
      notes = notes.filter(n => n.id !== opts.path.id)
      return Promise.resolve({ response: json(200) })
    }) as never)
    vi.mocked(getProjects).mockResolvedValue({ data: [] } as never)
    vi.mocked(getTaskHistory).mockResolvedValue({ data: [] } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  async function loadDetail(path?: string) {
    const utils = renderApp(path)
    await screen.findByRole('heading', { name: 'Fix login bug' })
    vi.useFakeTimers()
    return utils
  }

  describe('task delete', () => {
    it('navigates to /tasks at once with focusNewTask, with no confirm, spinner or Task-not-found frame', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      await loadDetail()
      const frames: string[] = []
      const observer = new MutationObserver(() => frames.push(document.body.textContent ?? ''))
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      fireEvent.click(screen.getByRole('button', { name: /delete task/i }))
      observer.disconnect()
      expect(confirm).not.toHaveBeenCalled()
      expect(locationSeen.pathname).toBe('/tasks')
      expect(frames.some(text => text.includes('Task not found'))).toBe(false)
      expect(screen.getByText('Task deleted: "Fix login bug"')).toBeInTheDocument()
      expect(deleteTaskCalls()).toHaveLength(0)
      confirm.mockRestore()
    })

    it('after navigating, Undo restores the task in the list and stays on /tasks', async () => {
      await loadDetail()
      fireEvent.click(screen.getByRole('button', { name: /delete task/i }))
      await advance(50)
      expect(screen.queryByText('Fix login bug', { selector: 'a' })).not.toBeInTheDocument()
      expect(screen.getByText('Other task')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await advance(50)
      expect(screen.getByText('Fix login bug', { selector: 'a' })).toBeInTheDocument()
      expect(locationSeen.pathname).toBe('/tasks')
      // Row Delete gets focus back once the list has rendered it.
      expect(screen.getByRole('button', { name: 'Delete task: Fix login bug' })).toHaveFocus()
      await advance(11000)
      expect(deleteTaskCalls()).toHaveLength(0)
    })

    it('lands on /tasks with New Task focused and the state cleared', async () => {
      await loadDetail()
      fireEvent.click(screen.getByRole('button', { name: /delete task/i }))
      await advance(50)
      expect(screen.getByRole('button', { name: 'New Task' })).toHaveFocus()
      expect(locationSeen.state).toBeNull()
    })

    it('the toast persists across the navigation and commits after 10s', async () => {
      await loadDetail()
      fireEvent.click(screen.getByRole('button', { name: /delete task/i }))
      await advance(9000)
      expect(deleteTaskCalls()).toHaveLength(0)
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      await advance(1100)
      expect(deleteTaskCalls()).toHaveLength(1)
      expect(screen.queryByText('Fix login bug', { selector: 'a' })).not.toBeInTheDocument()
    })

    it('a direct URL during the pending window shows "Task not found." and the task is back after Undo', async () => {
      await loadDetail()
      fireEvent.click(screen.getByRole('button', { name: /delete task/i }))
      await advance(50)
      fireEvent.click(screen.getByRole('button', { name: 'Go to task 1' }))
      await advance(50)
      expect(locationSeen.pathname).toBe('/tasks/1')
      expect(screen.getByText('Task not found.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await advance(50)
      expect(screen.getByRole('heading', { name: 'Fix login bug' })).toBeInTheDocument()
      expect(screen.queryByText('Task not found.')).not.toBeInTheDocument()
    })
  })

  describe('note delete', () => {
    it('hides the note, shows "Note deleted" and sends the DELETE after 6s', async () => {
      await loadDetail()
      const first = screen.getAllByRole('button', { name: 'Delete note' })
      fireEvent.click(first[0])
      expect(screen.queryByText('First note')).not.toBeInTheDocument()
      expect(first[1]).toHaveFocus()
      expect(screen.getByText('Note deleted')).toBeInTheDocument()
      await advance(5900)
      expect(deleteNoteCalls()).toHaveLength(0)
      await advance(200)
      expect(deleteNoteCalls()).toHaveLength(1)
      expect(deleteNoteCalls()[0][0]).toEqual({ path: { taskId: 1, id: 7 } })
    })

    it('Undo returns the note in its original server-sorted position and sends no DELETE', async () => {
      await loadDetail()
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete note' })[0])
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await advance(50)
      const contents = Array.from(document.querySelectorAll('.t-note-content')).map(n => n.textContent)
      expect(contents).toEqual(['First note', 'Second note'])
      await advance(7000)
      expect(deleteNoteCalls()).toHaveLength(0)
    })

    it('still commits after navigating away', async () => {
      await loadDetail()
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete note' })[0])
      fireEvent.click(screen.getByRole('link', { name: /back to tasks/i }))
      await advance(6100)
      expect(deleteNoteCalls()).toHaveLength(1)
    })

    it('a task and its note both pending: the note DELETE 404 after the cascade is not an error', async () => {
      vi.mocked(sdk.deleteApiV1TaskItemsByTaskIdNotesById).mockResolvedValue({ error: {}, response: json(404) } as never)
      await loadDetail()
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete note' })[0])
      await advance(1000)
      fireEvent.click(screen.getByRole('button', { name: /delete task/i }))
      await advance(11000)
      expect(deleteNoteCalls()).toHaveLength(1)
      expect(deleteTaskCalls()).toHaveLength(1)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('a failed note delete restores the note with an error toast', async () => {
      vi.mocked(sdk.deleteApiV1TaskItemsByTaskIdNotesById).mockResolvedValue({ error: {}, response: json(500) } as never)
      await loadDetail()
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete note' })[0])
      await advance(6100)
      expect(within(screen.getByRole('alert')).getByText("Couldn't delete the note. Restored.")).toBeInTheDocument()
      expect(screen.getByText('First note')).toBeInTheDocument()
    })
  })

  describe('parent with subtasks', () => {
    it('shows the inline hint and ignores clicks', async () => {
      tasks[0].childTaskCount = 1
      tasks.push({ id: 3, title: 'Child', status: 'Todo', priority: 'High', parentTaskItemId: 1, childTaskCount: 0 })
      await loadDetail()
      const del = screen.getByRole('button', { name: 'Delete task' })
      expect(del).toHaveAccessibleDescription('Delete subtasks first (1)')
      fireEvent.click(del)
      expect(locationSeen.pathname).toBe('/tasks/1')
      expect(screen.getByRole('button', { name: 'Delete task' })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText('Delete subtasks first (1)')).toBeVisible()
    })
  })
})
