import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { JournalEntryResponseDto } from '@/api/journal'

vi.mock('@/api/journal')
vi.mock('@/api/client/sdk.gen')
vi.mock('./TaskTypeahead', () => ({
  TaskTypeahead: ({ onChange }: { onChange: (id: number | null) => void }) => (
    <button type="button" data-testid="task-typeahead" onClick={() => onChange(99)}>link-task</button>
  ),
}))

import * as journalApi from '@/api/journal'
import { journalKeys } from '@/hooks/useJournal'
import { DailyLogSection } from './DailyLogSection'

const entry = {
  id: 10,
  title: 't',
  date: '2026-05-28',
  createdAt: '',
  todoTaskItemIds: [],
  movedCount: 0,
  movedTaskItemIds: [],
  logEntries: [
    { id: 1, content: 'Fixed the bug', journalEntryId: 10, createdAt: '2026-05-28T09:00:00Z', linkedTaskDeleted: false, taskItemId: 7, linkedTaskTitle: 'Old' },
  ],
} as unknown as JournalEntryResponseDto

// Feeds the section from the query cache, as the page does, so optimistic patches flow back as props.
// Refetching is off so the settle invalidation cannot restore the seeded entry.
function CachedSection() {
  const { data } = useQuery({ queryKey: journalKeys.all, queryFn: () => ({ data: [entry] }), enabled: false })
  return <DailyLogSection entryId={10} logEntries={data?.data?.[0].logEntries ?? []} />
}

describe('DailyLogSection with the real update mutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('edit then relink: the second PUT carries the committed content', async () => {
    vi.mocked(journalApi.updateLogEntry).mockResolvedValue({ data: {} } as never)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(journalKeys.all, { data: [entry] })
    render(
      <QueryClientProvider client={queryClient}>
        <CachedSection />
      </QueryClientProvider>,
    )
    await userEvent.dblClick(screen.getByRole('button', { name: 'Fixed the bug' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit log entry' }), '!')
    // Focusing the typeahead blurs the edit input, which commits the text.
    fireEvent.blur(screen.getByRole('textbox', { name: 'Edit log entry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fixed the bug!' })).toBeInTheDocument())
    await userEvent.click(screen.getAllByTestId('task-typeahead')[0])
    await waitFor(() => expect(journalApi.updateLogEntry).toHaveBeenCalledTimes(2))
    expect(journalApi.updateLogEntry).toHaveBeenNthCalledWith(1, 10, 1, 'Fixed the bug!', 7)
    expect(journalApi.updateLogEntry).toHaveBeenNthCalledWith(2, 10, 1, 'Fixed the bug!', 99)
  })
})
