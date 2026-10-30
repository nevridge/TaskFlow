import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { client } from '@/api/client/client.gen'
import type { JournalLogEntryResponseDto, JournalNoteResponseDto } from '@/api/journal'
import { ToastProvider } from '@/context/ToastContext'
import { NotesSection } from './NotesSection'
import { DailyLogSection } from './DailyLogSection'
import { TodosSection } from './TodosSection'

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(() => ({ autoCompleteParentWhenChildrenDone: false })),
}))
vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => null }))
vi.mock('./TaskTypeahead', () => ({ TaskTypeahead: () => null }))

// Real hooks + real client + mocked fetch. Covers (#232) how journal sections react to real 404/500 responses.
const note: JournalNoteResponseDto = { id: 1, content: 'A note', journalEntryId: 10, createdAt: '2026-05-28T09:00:00Z' }
const log: JournalLogEntryResponseDto = {
  id: 7, content: 'A log', journalEntryId: 10, createdAt: '2026-05-28T09:00:00Z', linkedTaskDeleted: false,
}
const todo = { id: 1, title: 'Write tests', status: 'Todo', priority: 'Low', description: null, dueDate: null }

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('journal sections against real HTTP errors (#232)', () => {
  const fetchMock = vi.fn()
  // What every non-GET request answers with; GETs return the seeded lists.
  let mutationStatus = 500

  const sentMethods = () => fetchMock.mock.calls.map(([r]) => (r as Request).method)

  beforeEach(() => {
    vi.clearAllMocks()
    mutationStatus = 500
    fetchMock.mockImplementation((req: Request) => {
      if (req.method === 'GET') {
        return Promise.resolve(jsonResponse(200, req.url.includes('/notes') ? [note] : req.url.includes('/todos') ? [todo] : []))
      }
      return Promise.resolve(jsonResponse(mutationStatus, { message: 'boom' }))
    })
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    vi.useRealTimers()
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  function renderWith(ui: React.ReactElement) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>,
    )
  }

  // Runs the 6s undo window on fake timers, then returns to real timers so the real fetch can resolve.
  function clickAndExpireUndo(button: HTMLElement) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(button)
    act(() => { vi.advanceTimersByTime(6000) })
    vi.useRealTimers()
  }

  describe('undo-delete commit that the server answers with 404', () => {
    // FINDING: with throwOnError on, a 404 rejects, so the journal deletes show the generic error toast and
    // restore the row (they do not treat 404 as "already deleted" the way task / task-note deletes do).
    it('note: 404 shows the error alert and keeps the note', async () => {
      mutationStatus = 404
      renderWith(<NotesSection entryId={10} />)
      await screen.findByText('A note')
      clickAndExpireUndo(screen.getByRole('button', { name: 'Delete note' }))
      const alert = await screen.findByRole('alert')
      expect(sentMethods()).toContain('DELETE')
      expect(alert).toHaveTextContent("Couldn't delete. Restored.")
      expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument()
    })

    it('log: 404 shows the error alert and keeps the entry', async () => {
      mutationStatus = 404
      renderWith(<DailyLogSection entryId={10} logEntries={[log]} />)
      clickAndExpireUndo(screen.getByRole('button', { name: 'Delete entry' }))
      const alert = await screen.findByRole('alert')
      expect(sentMethods()).toContain('DELETE')
      expect(alert).toHaveTextContent("Couldn't delete. Restored.")
      expect(screen.getByRole('button', { name: 'Delete entry' })).toBeInTheDocument()
    })

    it('todo (remove from day): 404 shows the error alert and keeps the row', async () => {
      mutationStatus = 404
      renderWith(<TodosSection entryId={10} isoDate="2099-01-01" sort="manual" />)
      await screen.findByText('Write tests')
      clickAndExpireUndo(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
      const alert = await screen.findByRole('alert')
      expect(sentMethods()).toContain('DELETE')
      expect(alert).toHaveTextContent("Couldn't remove from day. Restored.")
      expect(screen.getByText('Write tests')).toBeInTheDocument()
    })
  })

  describe('edit failures (HTTP 500): typed text is kept or the original restored', () => {
    it('todo edit: shows the error and re-opens the editor with the typed title', async () => {
      renderWith(<TodosSection entryId={10} isoDate="2099-01-01" sort="manual" />)
      await screen.findByText('Write tests')
      await userEvent.dblClick(screen.getByText('Write tests'))
      const input = screen.getByDisplayValue('Write tests')
      fireEvent.change(input, { target: { value: 'Write more tests' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(sentMethods()).toContain('PATCH'))
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save task changes')
      expect(screen.getByDisplayValue('Write more tests')).toBeInTheDocument()
    })

    it('note edit: re-opens the editor with the typed text and keeps the saved note', async () => {
      renderWith(<NotesSection entryId={10} />)
      await userEvent.dblClick(await screen.findByText('A note'))
      const input = screen.getByRole('textbox', { name: 'Edit note' })
      fireEvent.change(input, { target: { value: 'An edited note' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(sentMethods()).toContain('PUT'))
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Edit note' })).toHaveValue('An edited note'))
    })

    it('log edit: the saved entry text is shown again after the failed update', async () => {
      renderWith(<DailyLogSection entryId={10} logEntries={[log]} />)
      await userEvent.dblClick(screen.getByText('A log'))
      const input = screen.getByRole('textbox', { name: 'Edit log entry' })
      fireEvent.change(input, { target: { value: 'An edited log' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(sentMethods()).toContain('PUT'))
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })
      expect(screen.queryByRole('textbox', { name: 'Edit log entry' })).not.toBeInTheDocument()
      expect(screen.getByText('A log')).toBeInTheDocument()
    })
  })

  describe('create failures (HTTP 500): typed text and focus', () => {
    it('todo create: shows an error and keeps the typed text in the input', async () => {
      renderWith(<TodosSection entryId={10} isoDate="2099-01-01" sort="manual" />)
      await screen.findByText('Write tests')
      const input = screen.getByPlaceholderText('Add a TODO and press Enter')
      fireEvent.change(input, { target: { value: 'New todo' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => expect(sentMethods()).toContain('POST'))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      await waitFor(() => expect(input).not.toBeDisabled())
      expect(input).toHaveValue('New todo')
    })

    it('todo create: focus is on the input after the failed save', async () => {
      renderWith(<TodosSection entryId={10} isoDate="2099-01-01" sort="manual" />)
      await screen.findByText('Write tests')
      const input = screen.getByPlaceholderText('Add a TODO and press Enter')
      input.focus()
      fireEvent.change(input, { target: { value: 'New todo' } })
      fireEvent.submit(input.closest('form')!)

      await screen.findByRole('alert')
      await waitFor(() => expect(input).not.toBeDisabled())
      expect(input).toHaveFocus()
    })

    it('note create: restores the draft text after the failed save', async () => {
      renderWith(<NotesSection entryId={10} />)
      await screen.findByText('A note')
      const input = screen.getByPlaceholderText(/Add a note/)
      fireEvent.change(input, { target: { value: 'Draft note' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => expect(sentMethods()).toContain('POST'))
      await waitFor(() => expect(input).toHaveValue('Draft note'))
    })

    it('log add: the typed text is kept after the failed save', async () => {
      renderWith(<DailyLogSection entryId={10} logEntries={[]} />)
      const input = screen.getByPlaceholderText(/What did you just work on/)
      fireEvent.change(input, { target: { value: 'Did a thing' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => expect(sentMethods()).toContain('POST'))
      // Let the rejected mutation settle before reading the field.
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })
      expect(input).toHaveValue('Did a thing')
    })
  })
})
