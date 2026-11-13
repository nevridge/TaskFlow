import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { makeProviders } from '@/test/renderWithToast'
import { taskKeys } from '@/hooks/useTasks'
import { TasksPage } from './TasksPage'

// Gap tests for #479 (AC4 subtask, AC6 gates, AC11 history, parent in two sections, accessible names).
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

const row = (id: number, title: string, extra: Partial<Row> = {}): Row => ({
  id,
  title,
  status: 'Todo',
  priority: 'High',
  parentTaskItemId: null,
  childTaskCount: 0,
  ...extra,
})

const ok = () => new Response(null, { status: 200 })
const COLLAPSE_KEY = 'taskflow_tasks_section_collapse_v2'

let server: Row[]
let locationSeen: { pathname: string; search: string; state: unknown }
let nav: ReturnType<typeof useNavigate>

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    nav = navigate
    locationSeen = { pathname: location.pathname, search: location.search, state: location.state }
  })
  return null
}

function renderPage(state: unknown, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const Providers = makeProviders(qc)
  return render(
    <Providers>
      <PrefsProvider>
        <MemoryRouter initialEntries={[{ pathname: '/tasks', state }, '/elsewhere']} initialIndex={0}>
          <Probe />
          <Routes>
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/elsewhere" element={<p>elsewhere</p>} />
          </Routes>
        </MemoryRouter>
      </PrefsProvider>
    </Providers>,
  )
}

describe('TasksPage return focus: gap tests (#479)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    server = [row(1, 'Alpha task'), row(2, 'Bravo task')]
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() =>
      Promise.resolve({ data: structuredClone(server), response: ok() })) as never)
    vi.mocked(getProjects).mockResolvedValue({ data: [] } as never)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the header link in the first section when the parent is a header in two sections', async () => {
    server = [
      row(10, 'Parent task', { childTaskCount: 2 }),
      row(11, 'High child', { parentTaskItemId: 10, priority: 'High' }),
      row(12, 'Medium child', { parentTaskItemId: 10, priority: 'Medium' }),
    ]
    renderPage({ from: '/tasks', focusTaskId: 10 })
    const links = await screen.findAllByRole('link', { name: 'Parent task' })
    expect(links).toHaveLength(2)
    await waitFor(() => expect(links[0]).toHaveFocus())
    expect(links[1]).not.toHaveFocus()
  })

  it('focuses the toggle of the section holding a subtask whose group is collapsed, leaving storage unchanged', async () => {
    server = [
      row(10, 'Parent task', { childTaskCount: 1 }),
      row(11, 'Blocked child', { parentTaskItemId: 10, status: 'Blocked' }),
    ]
    renderPage({ from: '/tasks', focusTaskId: 11 })
    const toggle = await screen.findByRole('button', { name: /Blocked/ })
    await waitFor(() => expect(toggle).toHaveFocus())
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem(COLLAPSE_KEY)).toBeNull()
  })

  it('does not focus while a refetch of cached data is in flight, then focuses the final row once', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Stale cache: Bravo is still High in cache; the refetch will make it Blocked (collapsed section).
    qc.setQueryData(taskKeys.all, { data: structuredClone(server), response: ok() })
    let release: () => void = () => {}
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() =>
      new Promise(resolve => {
        release = () => resolve({ data: [row(1, 'Alpha task'), row(2, 'Bravo task', { status: 'Blocked' })], response: ok() })
      })) as never)
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    renderPage({ from: '/tasks', focusTaskId: 2 }, qc)

    const stale = await screen.findByRole('button', { name: 'Edit Bravo task' })
    expect(stale).not.toHaveFocus()
    expect(focusSpy).not.toHaveBeenCalled()
    expect(locationSeen.state).toEqual({ from: '/tasks', focusTaskId: 2 })

    await act(async () => {
      release()
    })
    const toggle = await screen.findByRole('button', { name: /Blocked/ })
    await waitFor(() => expect(toggle).toHaveFocus())
    expect(focusSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(locationSeen.state).toEqual({ from: '/tasks' }))
    focusSpy.mockRestore()
  })

  it('keeps unrelated state keys when clearing focusTaskId', async () => {
    renderPage({ from: '/tasks?q=a', other: 'keep', focusTaskId: 1 })
    await waitFor(() => expect(locationSeen.state).toEqual({ from: '/tasks?q=a', other: 'keep' }))
  })

  it('does not refocus when the history entry is revisited with go(-1) after the id was cleared', async () => {
    renderPage({ from: '/tasks', focusTaskId: 1 })
    const edit = await screen.findByRole('button', { name: 'Edit Alpha task' })
    await waitFor(() => expect(edit).toHaveFocus())
    await waitFor(() => expect(locationSeen.state).toEqual({ from: '/tasks' }))

    act(() => nav('/elsewhere'))
    await screen.findByText('elsewhere')
    act(() => nav(-1))
    const again = await screen.findByRole('button', { name: 'Edit Alpha task' })
    expect(again).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('exposes accessible names: Edit <title>, header link = parent title, toggle = label + count with aria-expanded', async () => {
    server = [
      row(10, 'Parent task', { childTaskCount: 1 }),
      row(11, 'Child task', { parentTaskItemId: 10 }),
      row(2, 'Held task', { status: 'Blocked', priority: 'Low' }),
    ]
    renderPage(null)
    expect(await screen.findByRole('button', { name: 'Edit Child task' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Parent task' })).toHaveAttribute('data-task-header-id', '10')
    const toggle = screen.getByRole('button', { name: /Blocked.*1 task/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
