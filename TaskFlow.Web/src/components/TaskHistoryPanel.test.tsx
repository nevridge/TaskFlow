import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TaskItemEventResponseDto } from '@/api/tasks'

vi.mock('@/hooks/useTasks', () => ({
  useTaskHistoryQuery: vi.fn(),
}))

import { useTaskHistoryQuery } from '@/hooks/useTasks'
import { TaskHistoryPanel } from './TaskHistoryPanel'

function makeEvent(overrides: Partial<TaskItemEventResponseDto>): TaskItemEventResponseDto {
  return {
    id: 1,
    taskItemId: 42,
    eventType: 'StatusChanged',
    occurredAtUtc: '2026-05-28T09:00:00Z',
    changeSummary: null,
    fromJournalDate: null,
    toJournalDate: null,
    ...overrides,
  }
}

describe('TaskHistoryPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading indicator when isLoading is true', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: undefined, isLoading: true } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText(/loading history/i)).toBeInTheDocument()
  })

  it('shows default empty text when history is empty', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText('No history yet.')).toBeInTheDocument()
  })

  it('shows custom emptyText when provided', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    render(<TaskHistoryPanel taskId={1} emptyText="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('renders changeSummary when present', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ changeSummary: 'Did something' })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText('Did something')).toBeInTheDocument()
  })

  it('renders "Task was created" for TaskCreated event type', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'TaskCreated', changeSummary: null })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText('Task was created')).toBeInTheDocument()
  })

  it('renders "Marked complete" for Completed event type', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'Completed', changeSummary: null })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText('Marked complete')).toBeInTheDocument()
  })

  it('renders the long migration changeSummary for a Completed event, not the "Marked complete" fallback', () => {
    const summary = 'Marked complete by a data migration that merged the separate completion flag into Status. Recorded when the migration ran, not when the task was completed.'
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'Completed', changeSummary: summary })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText(summary)).toBeInTheDocument()
    expect(screen.queryByText('Marked complete')).not.toBeInTheDocument()
  })

  it('renders "Assigned to" for AssignedToJournalDay with toJournalDate', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'AssignedToJournalDay', toJournalDate: '2026-05-28', changeSummary: null })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText(/assigned to/i)).toBeInTheDocument()
  })

  it('renders "Moved from" when both fromJournalDate and toJournalDate are present', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: {
        data: [makeEvent({
          eventType: 'ReassignedToJournalDay',
          fromJournalDate: '2026-05-27',
          toJournalDate: '2026-05-28',
          changeSummary: null,
        })],
      },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText(/moved from/i)).toBeInTheDocument()
  })

  it('renders "Removed from" when only fromJournalDate is present', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: {
        data: [makeEvent({
          eventType: 'RemovedFromJournalDay',
          fromJournalDate: '2026-05-27',
          toJournalDate: null,
          changeSummary: null,
        })],
      },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText(/removed from/i)).toBeInTheDocument()
  })

  it('renders the raw eventType for unknown event types', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'CustomEvent', changeSummary: null })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText('CustomEvent')).toBeInTheDocument()
  })

  it('shows the changeSummary for a ProjectChanged event', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'ProjectChanged', changeSummary: "Assigned to project 'Alpha'." })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText("Assigned to project 'Alpha'.")).toBeInTheDocument()
    expect(screen.queryByText('ProjectChanged')).not.toBeInTheDocument()
  })

  it.each([null, ''])('shows "Project changed" for a ProjectChanged event with summary %j', summary => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'ProjectChanged', changeSummary: summary })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText('Project changed')).toBeInTheDocument()
    expect(screen.queryByText('ProjectChanged')).not.toBeInTheDocument()
  })

  it.each([
    ['Blocked', 'Blocked'],
    ['Unblocked', 'Unblocked'],
    ['BlockedReasonChanged', 'Blocked reason updated'],
  ])('falls back to a readable label for %s events without a summary', (eventType, label) => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType, changeSummary: null })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('Status changed')).not.toBeInTheDocument()
  })

  it('prefers the server change summary for blocked events', () => {
    vi.mocked(useTaskHistoryQuery).mockReturnValue({
      data: { data: [makeEvent({ eventType: 'Blocked', changeSummary: 'Blocked: Waiting on Sam.' })] },
      isLoading: false,
    } as never)
    render(<TaskHistoryPanel taskId={1} />)
    expect(screen.getByText('Blocked: Waiting on Sam.')).toBeInTheDocument()
  })
})
