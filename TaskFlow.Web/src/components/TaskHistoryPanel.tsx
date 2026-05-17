import { useTaskHistoryQuery } from '@/hooks/useTasks'
import type { TaskItemEventResponseDto } from '@/api/tasks'
import { formatShort } from '@/lib/journal-utils'

interface Props {
  taskId: number
  emptyText?: string
}

export function TaskHistoryPanel({ taskId, emptyText = 'No history yet.' }: Props) {
  const { data, isLoading } = useTaskHistoryQuery(taskId)
  const history: TaskItemEventResponseDto[] = (data?.data as TaskItemEventResponseDto[] | undefined) ?? []

  if (isLoading) {
    return <p className="t-empty">Loading history…</p>
  }

  if (history.length === 0) {
    return <p className="t-empty">{emptyText}</p>
  }

  return (
    <div className="t-panel">
      <ol className="t-history-list">
        {history.map(event => (
          <li key={event.id} className="t-history-item">
            <div className="t-history-line">{describeEvent(event)}</div>
            <div className="t-history-time">{formatDateTime(event.occurredAtUtc)}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function describeEvent(event: TaskItemEventResponseDto): string {
  if (event.changeSummary) return event.changeSummary

  switch (event.eventType) {
    case 'TaskCreated':
      return 'Task was created'
    case 'AssignedToJournalDay':
      return event.toJournalDate ? `Assigned to ${formatShort(event.toJournalDate)}` : 'Assigned to a journal day'
    case 'ReassignedToJournalDay':
      return event.fromJournalDate && event.toJournalDate
        ? `Moved from ${formatShort(event.fromJournalDate)} to ${formatShort(event.toJournalDate)}`
        : 'Moved to a different journal day'
    case 'RemovedFromJournalDay':
      return event.fromJournalDate ? `Removed from ${formatShort(event.fromJournalDate)}` : 'Removed from a journal day'
    case 'Completed':
      return 'Marked complete'
    case 'Reopened':
      return 'Reopened'
    case 'TitleChanged':
      return 'Title updated'
    case 'PriorityChanged':
      return 'Priority changed'
    case 'StatusChanged':
      return 'Status changed'
    default:
      return event.eventType
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
