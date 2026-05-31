import { client } from './client/client.gen'

export type JournalLogEntryResponseDto = {
  id: number
  content: string
  journalEntryId: number
  createdAt: string
  updatedAt?: string | null
  taskItemId?: number | null
  linkedTaskTitle?: string | null
  linkedTaskDeleted: boolean
}

export type JournalEntryResponseDto = {
  id: number
  title: string
  summary?: string | null
  date: string
  createdAt: string
  updatedAt?: string | null
  todoTaskItemIds: number[]
  logEntries: JournalLogEntryResponseDto[]
}

export type CreateJournalEntryDto = {
  title: string
  date: string
  summary?: string
}

export type UpdateJournalEntryDto = {
  title: string
  summary?: string | null
}

import type { TaskItemResponseDto as ClientTaskItemResponseDto } from './client/types.gen'
export type TaskItemResponseDto = ClientTaskItemResponseDto & {
  currentJournalDate?: string | null
  moveCount?: number
  daysTagged?: number
  parentTaskItemId?: number | null
}

const J = { 'Content-Type': 'application/json' }

export const getJournalEntries = () =>
  client.get<{ 200: JournalEntryResponseDto[] }, unknown, true>(
    { url: '/api/v1/JournalEntries' },
  )

export const createJournalEntry = (body: CreateJournalEntryDto) =>
  client.post<{ 201: JournalEntryResponseDto }, unknown, true>(
    { url: '/api/v1/JournalEntries', body, headers: J },
  )

export const updateJournalEntry = (id: number, body: UpdateJournalEntryDto) =>
  client.put<{ 200: JournalEntryResponseDto }, unknown, true>(
    { url: '/api/v1/JournalEntries/{id}', path: { id }, body, headers: J },
  )

export const getJournalTodos = (entryId: number) =>
  client.get<{ 200: TaskItemResponseDto[] }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/todos', path: { entryId } },
  )

export const addJournalTodo = (entryId: number, taskItemId: number) =>
  client.post<{ 204: unknown }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/todos', path: { entryId }, body: { taskItemId }, headers: J },
  )

export const removeJournalTodo = (entryId: number, taskItemId: number) =>
  client.delete<{ 204: unknown }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/todos/{taskItemId}', path: { entryId, taskItemId } },
  )

export const createLogEntry = (entryId: number, content: string, taskItemId?: number | null) =>
  client.post<{ 201: JournalLogEntryResponseDto }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/logs', path: { entryId }, body: { content, taskItemId }, headers: J },
  )

export async function updateLogEntry(
  entryId: number,
  logId: number,
  content: string,
  taskItemId?: number | null
): Promise<JournalLogEntryResponseDto> {
  const response = await client.put<{ 200: JournalLogEntryResponseDto }, unknown, true>({
    url: '/api/v1/JournalEntries/{entryId}/logs/{id}',
    path: { entryId, id: logId },
    body: { content, taskItemId },
    headers: J,
  })
  return response.data as JournalLogEntryResponseDto
}

export const deleteLogEntry = (entryId: number, logId: number) =>
  client.delete<{ 204: unknown }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/logs/{id}', path: { entryId, id: logId } },
  )

export type JournalNoteResponseDto = {
  id: number
  content: string
  journalEntryId: number
  createdAt: string
  updatedAt?: string | null
}

export const getJournalNotes = (entryId: number) =>
  client.get<{ 200: JournalNoteResponseDto[] }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/notes', path: { entryId } },
  )

export const createJournalNote = (entryId: number, content: string) =>
  client.post<{ 201: JournalNoteResponseDto }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/notes', path: { entryId }, body: { content }, headers: J },
  )

export const updateJournalNote = (entryId: number, id: number, content: string) =>
  client.put<{ 200: JournalNoteResponseDto }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/notes/{id}', path: { entryId, id }, body: { content }, headers: J },
  )

export const deleteJournalNote = (entryId: number, id: number) =>
  client.delete<{ 204: unknown }, unknown, true>(
    { url: '/api/v1/JournalEntries/{entryId}/notes/{id}', path: { entryId, id } },
  )
