import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { client } from '@/api/client/client.gen'
import { ToastProvider } from '@/context/ToastContext'
import { journalKeys } from '@/hooks/journalKeys'
import { __resetCoarsePointerCache } from '@/lib/pointer'
import { TodosSection } from './TodosSection'

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(() => ({ autoCompleteParentWhenChildrenDone: false })),
}))
vi.mock('@/lib/journal-utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/journal-utils')>()),
  todayISO: vi.fn(() => '2026-11-07'),
}))
vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => null }))

// Real hooks + real client + mocked fetch: touch tap behavior and optimistic completion before opening details (#404).
const todo = { id: 5, title: 'Write tests', status: 'Todo', priority: 'Low', description: null, dueDate: null }
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const seen: { pathname: string; search: string; state: unknown } = { pathname: '', search: '', state: null }
function Probe() {
  const l = useLocation()
  useEffect(() => {
    seen.pathname = l.pathname
    seen.search = l.search
    seen.state = l.state
  })
  return null
}

describe('TodosSection details link, touch and optimistic flows (#404)', () => {
  const fetchMock = vi.fn()
  let holdPatch: (() => void) | null = null
  const sentMethods = () => fetchMock.mock.calls.map(([r]) => (r as Request).method)

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation((req: Request) => {
      if (req.method === 'GET') return Promise.resolve(jsonResponse(200, req.url.includes('/todos') ? [todo] : []))
      // A mutation that never answers within the test, so only the optimistic state is visible.
      return new Promise<Response>(resolve => { holdPatch = () => resolve(jsonResponse(200, { ...todo, status: 'Completed' })) })
    })
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    holdPatch?.()
    holdPatch = null
    client.setConfig({ baseUrl: '', fetch: undefined })
    vi.unstubAllGlobals()
    __resetCoarsePointerCache()
  })

  function renderSection() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/journal/11-07-2026']}>
            <Probe />
            <Routes>
              <Route path="/journal/:date" element={<TodosSection entryId={10} isoDate="2026-11-07" sort="manual" />} />
              <Route path="*" element={null} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    return qc
  }

  it('touch: a single tap on the title opens inline edit and does not navigate', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
    }))
    __resetCoarsePointerCache()
    renderSection()
    const title = await screen.findByRole('button', { name: 'Write tests' })
    fireEvent.pointerDown(title, { pointerType: 'touch' })
    fireEvent.click(title, { detail: 1 })
    expect(document.querySelector('input.todo-edit')).not.toBeNull()
    expect(seen.pathname).toBe('/journal/11-07-2026')
  })

  it('touch: tapping the details link navigates', async () => {
    renderSection()
    const link = await screen.findByRole('link', { name: 'Edit details: Write tests' })
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    fireEvent.pointerUp(link, { pointerType: 'touch' })
    fireEvent.click(link, { detail: 1 })
    expect(seen.pathname).toBe('/tasks/5')
    expect(seen.search).toBe('?edit=1')
    expect(seen.state).toEqual({ from: '/journal/11-07-2026', focusTaskId: 5 })
  })

  it('opening details after an optimistic completion shows the completed state and sends no extra request', async () => {
    const qc = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark done' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark not done' })).toBeInTheDocument())
    expect(sentMethods().filter(m => m !== 'GET')).toEqual(['PATCH'])

    fireEvent.click(screen.getByRole('link', { name: 'Edit details: Write tests' }))
    expect(seen.pathname).toBe('/tasks/5')
    expect(seen.search).toBe('?edit=1')
    expect(seen.state).toEqual({ from: '/journal/11-07-2026', focusTaskId: 5 })
    // The link adds no task-changing call, and the cache the detail page reads from holds the optimistic state.
    expect(sentMethods().filter(m => m !== 'GET')).toEqual(['PATCH'])
    const cached = qc.getQueryData<{ data: Array<{ status: string }> }>(journalKeys.todos(10))
    expect(cached?.data[0].status).toBe('Completed')
  })
})
