import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { makeProviders } from '@/test/renderWithToast'
import { useJournalTodos } from './useJournal'
import { useDeleteTaskUndoable } from './useDeleteTaskUndoable'
import { TaskTypeahead } from '@/components/journal/TaskTypeahead'

// Real ToastProvider, real hooks and QueryClient. Only the network layer is mocked.
vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
}))
vi.mock('@/api/journal', () => ({ getJournalTodos: vi.fn() }))
vi.mock('@/context/usePrefs', () => ({ usePrefs: vi.fn() }))

import * as sdk from '@/api/client/sdk.gen'
import { getJournalTodos } from '@/api/journal'

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

function TodoList() {
  const { data } = useJournalTodos(1)
  const del = useDeleteTaskUndoable()
  const todos = (data?.data ?? []) as Array<{ id: number; title: string }>
  return (
    <ul>
      {todos.map(t => (
        <li key={t.id}>
          {t.title}
          <button onClick={() => del({ id: t.id, title: t.title })}>{`remove ${t.title}`}</button>
        </li>
      ))}
    </ul>
  )
}

function TypeaheadWithDelete() {
  const del = useDeleteTaskUndoable()
  return (
    <>
      <button onClick={() => del({ id: 2, title: 'Write tests' })}>remove 2</button>
      <TaskTypeahead value={null} onChange={() => undefined} />
    </>
  )
}

describe('pending task delete across other consumers (#321 AC11, AC13)', () => {
  let qc: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(getJournalTodos).mockResolvedValue({
      data: [{ id: 1, title: 'Alpha todo', children: [] }, { id: 2, title: 'Bravo todo', children: [] }],
    } as never)
    vi.mocked(sdk.getApiV1TaskItems).mockResolvedValue({
      data: [{ id: 1, title: 'Fix login bug', status: 'Todo' }, { id: 2, title: 'Write tests', status: 'Todo' }],
    } as never)
    vi.mocked(sdk.deleteApiV1TaskItemsById).mockResolvedValue({ response: { ok: true, status: 200 } } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  async function mount(ui: React.ReactElement, ready: string) {
    const Providers = makeProviders(qc)
    render(<Providers>{ui}</Providers>)
    await screen.findByText(ready)
    vi.useFakeTimers()
  }

  it('hides a pending task from journal todos and Undo restores it without sending a DELETE', async () => {
    await mount(<TodoList />, 'Alpha todo')
    fireEvent.click(screen.getByRole('button', { name: 'remove Bravo todo' }))
    expect(screen.queryByText('Bravo todo')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha todo')).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('region', { name: 'Notifications' })).getByRole('button', { name: 'Undo' }))
    await advance(50)
    expect(screen.getByText('Bravo todo')).toBeInTheDocument()
    await advance(11000)
    expect(sdk.deleteApiV1TaskItemsById).not.toHaveBeenCalled()
  })

  it('commit sends one DELETE and invalidates the journal prefix so todos refetch', async () => {
    await mount(<TodoList />, 'Alpha todo')
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const callsBefore = vi.mocked(getJournalTodos).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'remove Bravo todo' }))
    await advance(10100)
    expect(sdk.deleteApiV1TaskItemsById).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['journal'] })
    expect(vi.mocked(getJournalTodos).mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('hides a pending task from the TaskTypeahead options', async () => {
    const Providers = makeProviders(qc)
    render(<Providers><TypeaheadWithDelete /></Providers>)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: /Write tests/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'remove 2' }))
    expect(screen.queryByRole('option', { name: /Write tests/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Fix login bug/ })).toBeInTheDocument()
  })
})
