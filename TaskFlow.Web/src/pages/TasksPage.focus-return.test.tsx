import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { makeProviders } from '@/test/renderWithToast'
import { TasksPage } from './TasksPage'

// Real hooks and QueryClient; only the network layer is mocked (same shape as TasksPage.delete.test).
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

const json = (status: number) => new Response(null, { status })

const COLLAPSE_KEY = 'taskflow_tasks_section_collapse_v2'

let server: Row[]
let locationSeen: { pathname: string; search: string; state: unknown }

function LocationProbe() {
  const location = useLocation()
  useEffect(() => {
    locationSeen = { pathname: location.pathname, search: location.search, state: location.state }
  })
  return null
}

function renderPage(state: unknown, search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Providers = makeProviders(qc)
  return render(
    <Providers>
      <PrefsProvider>
        <MemoryRouter initialEntries={[{ pathname: '/tasks', search, state }]}>
          <LocationProbe />
          <Routes>
            <Route path="/tasks" element={<TasksPage />} />
          </Routes>
        </MemoryRouter>
      </PrefsProvider>
    </Providers>,
  )
}

const editButton = (title: string) => screen.findByRole('button', { name: `Edit ${title}` })

describe('TasksPage focuses the edited row on return (#479)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    server = [row(1, 'Alpha task'), row(2, 'Bravo task'), row(3, 'Charlie task')]
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() =>
      Promise.resolve({ data: structuredClone(server), response: json(200) })) as never)
    vi.mocked(getProjects).mockResolvedValue({ data: [] } as never)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the Edit button of the returned-to row, then clears only focusTaskId from the entry', async () => {
    renderPage({ from: '/tasks?q=task', focusTaskId: 2 }, '?q=task')
    const edit = await editButton('Bravo task')
    await waitFor(() => expect(edit).toHaveFocus())
    await waitFor(() => expect(locationSeen.state).toEqual({ from: '/tasks?q=task' }))
    expect(locationSeen.search).toBe('?q=task')
  })

  it('focuses the parent link of a context header when the parent has no row of its own', async () => {
    server = [row(10, 'Parent task'), row(11, 'Child task', { parentTaskItemId: 10 })]
    renderPage({ from: '/tasks', focusTaskId: 10 })
    const link = await screen.findByRole('link', { name: 'Parent task' })
    await waitFor(() => expect(link).toHaveFocus())
  })

  it('focuses the section toggle of a collapsed section without expanding it, until the user does', async () => {
    server = [row(1, 'Alpha task'), row(2, 'Held task', { status: 'Blocked' })]
    renderPage({ from: '/tasks', focusTaskId: 2 })
    const toggle = await screen.findByRole('button', { name: /Blocked/ })
    await waitFor(() => expect(toggle).toHaveFocus())
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem(COLLAPSE_KEY)).toBeNull()

    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveFocus()
    expect(localStorage.getItem(COLLAPSE_KEY)).not.toBeNull()
  })

  it('waits for the list to load before focusing', async () => {
    let release: () => void = () => {}
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() =>
      new Promise(resolve => {
        release = () => resolve({ data: structuredClone(server), response: json(200) })
      })) as never)
    renderPage({ from: '/tasks', focusTaskId: 3 })
    await screen.findByText('Loading tasks...')
    expect(locationSeen.state).toEqual({ from: '/tasks', focusTaskId: 3 })
    release()
    const edit = await editButton('Charlie task')
    await waitFor(() => expect(edit).toHaveFocus())
  })

  it('abandons silently when the task is no longer listed, and still clears the id', async () => {
    renderPage({ from: '/tasks', focusTaskId: 99 })
    await editButton('Alpha task')
    await waitFor(() => expect(locationSeen.state).toEqual({ from: '/tasks' }))
    expect(document.body).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the id and focuses nothing when the list fails to load', async () => {
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() => Promise.reject(new Error('boom'))) as never)
    renderPage({ from: '/tasks', focusTaskId: 1 })
    await screen.findByText('Failed to load tasks.')
    await waitFor(() => expect(locationSeen.state).toEqual({ from: '/tasks' }))
    expect(document.body).toHaveFocus()
  })

  it('does nothing without a focusTaskId (direct load, Nav link, g t)', async () => {
    renderPage(null)
    await editButton('Alpha task')
    expect(document.body).toHaveFocus()
    expect(locationSeen.state).toBeNull()
  })

  it('leaves focus where the user put it, and still clears the id', async () => {
    let release: () => void = () => {}
    vi.mocked(sdk.getApiV1TaskItems).mockImplementation((() =>
      new Promise(resolve => {
        release = () => resolve({ data: structuredClone(server), response: json(200) })
      })) as never)
    renderPage({ from: '/tasks', focusTaskId: 2 })
    await screen.findByText('Loading tasks...')
    // Focus something outside the list while it loads (the user started typing elsewhere).
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    release()
    await editButton('Bravo task')
    await waitFor(() => expect(locationSeen.state).toEqual({ from: '/tasks' }))
    expect(outside).toHaveFocus()
  })

  it('does not trap Tab: the next Tab leaves the focused Edit button', async () => {
    renderPage({ from: '/tasks', focusTaskId: 1 })
    const edit = await editButton('Alpha task')
    await waitFor(() => expect(edit).toHaveFocus())
    await userEvent.tab()
    expect(edit).not.toHaveFocus()
  })
})
