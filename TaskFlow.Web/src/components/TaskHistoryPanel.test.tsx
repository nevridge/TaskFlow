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
})
