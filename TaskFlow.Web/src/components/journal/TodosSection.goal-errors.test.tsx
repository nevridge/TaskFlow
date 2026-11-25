import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { client } from '@/api/client/client.gen'
import { render } from '@/test/renderWithToast'
import { todayISO } from '@/lib/journal-utils'
import { TodosSection } from './TodosSection'

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(() => ({ autoCompleteParentWhenChildrenDone: false })),
}))
vi.mock('@/components/TaskHistoryPanel', () => ({ TaskHistoryPanel: () => null }))

// Real hooks + real client + mocked fetch: a completion the goal rule refuses (#491).
const todos = [
  { id: 1, title: 'Refused task', status: 'Todo', priority: 'Low' },
  { id: 2, title: 'Other task', status: 'Todo', priority: 'Low' },
]
const MESSAGE =
  "This task's goal is not the current goal, so it can't be started or completed. Swap the goal to Now with the assistant first."

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('TodosSection completion refused by the goal rule', () => {
  let refuse: () => void

  beforeEach(() => {
    let patched = false
    const fetchMock = vi.fn((req: Request) => {
      if (req.method === 'GET') {
        // Refetches after the PATCH never answer, so only the rollback can restore the row.
        return patched ? new Promise<Response>(() => {}) : Promise.resolve(jsonResponse(200, todos))
      }
      patched = true
      return new Promise<Response>(resolve => {
        refuse = () => resolve(jsonResponse(422, { code: 'TASK_GOAL_NOT_NOW', message: 'server text' }))
      })
    })
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  async function completeFirstTask(isoDate: string) {
    render(<TodosSection entryId={10} isoDate={isoDate} sort="manual" />)
    await screen.findByText('Refused task')
    await userEvent.click(screen.getAllByRole('button', { name: 'Mark done' })[0])
  }

  it('shows the goal message and restores the row and counts', async () => {
    await completeFirstTask(todayISO())
    expect(await screen.findByText('1/2')).toBeInTheDocument()

    refuse()

    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE)
    await waitFor(() => expect(screen.getByText('0/2')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: 'Mark done' })).toHaveLength(2)
  })

  it('from another day, brings the row back and withdraws the move announcement', async () => {
    await completeFirstTask('2020-01-06')
    await waitFor(() => expect(screen.queryByText('Refused task')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Completed. Moved to today.')

    refuse()

    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE)
    expect(await screen.findByText('Refused task')).toBeInTheDocument()
    expect(screen.getByText('0/2')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
