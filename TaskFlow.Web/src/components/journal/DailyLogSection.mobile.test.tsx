import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JournalLogEntryResponseDto } from '@/api/journal'
import { __resetCoarsePointerCache } from '@/lib/pointer'

const addLogMutate = vi.fn()
const updateLogMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useAddLogEntryMutation: vi.fn(() => ({ mutate: addLogMutate, isPending: false })),
  useDeleteLogEntryMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateLogEntryMutation: vi.fn(() => ({ mutate: updateLogMutate, isPending: false })),
}))

vi.mock('./TaskTypeahead', () => ({
  TaskTypeahead: () => <input data-testid="task-typeahead" aria-label="Link to task" />,
}))

import { useAddLogEntryMutation } from '@/hooks/useJournal'
import { DailyLogSection } from './DailyLogSection'

const entry: JournalLogEntryResponseDto = {
  id: 1,
  content: 'Fixed the bug',
  journalEntryId: 10,
  createdAt: '2026-05-28T09:00:00Z',
  linkedTaskDeleted: false,
  taskItemId: 7,
  linkedTaskTitle: 'Build the feature',
}

function setTouch(touch: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: touch }),
    configurable: true,
    writable: true,
  })
  __resetCoarsePointerCache()
}

const addInput = () => screen.getByPlaceholderText(/what did you just work on/i)

describe('DailyLogSection on touch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAddLogEntryMutation).mockReturnValue({ mutate: addLogMutate, isPending: false } as never)
    setTouch(true)
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    document.body.innerHTML = ''
  })

  it('a single tap on the log text edits it in place', async () => {
    render(<DailyLogSection entryId={10} logEntries={[entry]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fixed the bug' }))
    expect(screen.getByRole('textbox', { name: 'Edit log entry' })).toHaveValue('Fixed the bug')
  })

  it('tapping the chip does not edit', async () => {
    render(<DailyLogSection entryId={10} logEntries={[entry]} />)
    await userEvent.click(screen.getByText('Build the feature'))
    expect(screen.queryByRole('textbox', { name: 'Edit log entry' })).not.toBeInTheDocument()
  })

  it('tapping delete does not edit', async () => {
    render(<DailyLogSection entryId={10} logEntries={[entry]} />)
    await userEvent.click(screen.getByRole('button', { name: /delete entry/i }))
    expect(screen.queryByRole('textbox', { name: 'Edit log entry' })).not.toBeInTheDocument()
  })

  it('the Add button is disabled when empty, then submits the trimmed text', async () => {
    render(<DailyLogSection entryId={10} logEntries={[]} />)
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    await userEvent.type(addInput(), ' tapped ')
    await userEvent.click(add)
    expect(addLogMutate).toHaveBeenCalledTimes(1)
    expect(addLogMutate).toHaveBeenCalledWith({ content: 'tapped', taskItemId: null }, expect.any(Object))
    expect(addInput()).toHaveValue('')
  })

  it('Enter still submits', async () => {
    render(<DailyLogSection entryId={10} logEntries={[]} />)
    await userEvent.type(addInput(), 'enter works{Enter}')
    expect(addLogMutate).toHaveBeenCalledTimes(1)
  })

  it('does not disable the add input while saving, so the keyboard stays open', async () => {
    vi.mocked(useAddLogEntryMutation).mockReturnValue({ mutate: addLogMutate, isPending: true } as never)
    render(<DailyLogSection entryId={10} logEntries={[]} />)
    expect(addInput()).toBeEnabled()
    await userEvent.click(addInput())
    expect(document.activeElement).toBe(addInput())
  })
})
