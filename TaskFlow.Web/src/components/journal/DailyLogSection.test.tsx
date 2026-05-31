import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import type { DailyLogSectionHandle } from './DailyLogSection'

const addLogMutate = vi.fn()
const deleteLogMutate = vi.fn()
const updateLogMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useAddLogEntryMutation: vi.fn(() => ({ mutate: addLogMutate, isPending: false })),
  useDeleteLogEntryMutation: vi.fn(() => ({ mutate: deleteLogMutate, isPending: false })),
  useUpdateLogEntryMutation: vi.fn(() => ({ mutate: updateLogMutate, isPending: false })),
}))

vi.mock('./TaskTypeahead', () => ({
  TaskTypeahead: vi.fn(() => null),
}))

import { DailyLogSection } from './DailyLogSection'
import type { JournalLogEntryResponseDto } from '@/api/journal'

const baseEntry: JournalLogEntryResponseDto = {
  id: 1,
  content: 'Fixed the bug',
  journalEntryId: 10,
  createdAt: '2026-05-28T09:00:00Z',
  linkedTaskDeleted: false,
}

const secondEntry: JournalLogEntryResponseDto = {
  id: 2,
  content: 'Reviewed PR',
  journalEntryId: 10,
  createdAt: '2026-05-28T10:00:00Z',
  linkedTaskDeleted: false,
}

function renderSection(logEntries: JournalLogEntryResponseDto[] = [], ref?: React.Ref<DailyLogSectionHandle>) {
  return render(<DailyLogSection ref={ref} entryId={10} logEntries={logEntries} />)
}

describe('DailyLogSection', () => {
  beforeEach(() => {
    addLogMutate.mockReset()
    deleteLogMutate.mockReset()
    updateLogMutate.mockReset()
  })

  it('shows empty state when no log entries', () => {
    renderSection([])
    expect(screen.getByText(/no log entries yet/i)).toBeInTheDocument()
  })

  it('renders two log entries', () => {
    renderSection([baseEntry, secondEntry])
    expect(screen.getByText('Fixed the bug')).toBeInTheDocument()
    expect(screen.getByText('Reviewed PR')).toBeInTheDocument()
  })

  it('header shows "2 entries" for two entries', () => {
    renderSection([baseEntry, secondEntry])
    expect(screen.getByText('2 entries')).toBeInTheDocument()
  })

  it('header shows "1 entry" for one entry', () => {
    renderSection([baseEntry])
    expect(screen.getByText('1 entry')).toBeInTheDocument()
  })

  it('submitting trimmed text calls addLog.mutate and clears input', async () => {
    renderSection([])
    const input = screen.getByRole('textbox')
    await userEvent.type(input, '  Working on tests  ')
    await userEvent.keyboard('{Enter}')
    expect(addLogMutate).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Working on tests' }),
      expect.any(Object),
    )
    expect(input).toHaveValue('')
  })

  it('pressing Escape clears the input', async () => {
    renderSection([])
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'some work')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('clicking delete button calls deleteLog.mutate with entry id', async () => {
    renderSection([baseEntry])
    await userEvent.click(screen.getByRole('button', { name: /delete entry/i }))
    expect(deleteLogMutate).toHaveBeenCalledWith(1)
  })

  it('focusDraftInput() via ref focuses the input', () => {
    const ref = createRef<DailyLogSectionHandle>()
    renderSection([], ref)
    ref.current?.focusDraftInput()
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  // ─── Task association display ────────────────────────────────────────────────

  it('renders linked task title chip when linkedTaskTitle is set and linkedTaskDeleted is false', () => {
    const entry: JournalLogEntryResponseDto = {
      ...baseEntry,
      taskItemId: 7,
      linkedTaskTitle: 'Build the feature',
      linkedTaskDeleted: false,
    }
    renderSection([entry])
    expect(screen.getByText('Build the feature')).toBeInTheDocument()
  })

  it('renders muted deleted badge when linkedTaskDeleted is true', () => {
    const entry: JournalLogEntryResponseDto = {
      ...baseEntry,
      taskItemId: null,
      linkedTaskTitle: 'Old deleted task',
      linkedTaskDeleted: true,
    }
    renderSection([entry])
    expect(screen.getByText('Old deleted task (deleted)')).toBeInTheDocument()
  })

  it('renders nothing for task when no taskItemId and no linkedTaskTitle', () => {
    const entry: JournalLogEntryResponseDto = {
      ...baseEntry,
      taskItemId: null,
      linkedTaskTitle: null,
      linkedTaskDeleted: false,
    }
    renderSection([entry])
    expect(screen.queryByText(/deleted/i)).not.toBeInTheDocument()
    // chip text should not appear
    expect(screen.queryByText('Build the feature')).not.toBeInTheDocument()
  })
})
