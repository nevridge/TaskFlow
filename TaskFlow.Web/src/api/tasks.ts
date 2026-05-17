import { client } from './client/client.gen'

export type TaskItemEventResponseDto = {
  id: number
  taskItemId: number
  eventType: string
  occurredAtUtc: string
  fromJournalEntryId?: number | null
  toJournalEntryId?: number | null
  fromJournalDate?: string | null
  toJournalDate?: string | null
  changeSummary?: string | null
}

export const getTaskHistory = (id: number) =>
  client.get<{ 200: TaskItemEventResponseDto[] }, unknown, true>(
    { url: '/api/v1/TaskItems/{id}/history', path: { id } },
  )
