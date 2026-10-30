import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { client } from './client/client.gen'
import { configureApiClient } from './configure-client'
import { getApiV1TaskItems, postApiV1TaskItems, deleteApiV1TaskItemsById } from './client/sdk.gen'
import { getTaskHistory } from './tasks'
import { getProjects } from './projects'
import {
  getJournalEntries,
  getJournalTodos,
  addJournalTodo,
  createLogEntry,
  getJournalNotes,
  createJournalNote,
} from './journal'

// Real client, mocked fetch: proves HTTP errors reject for every app API call.
describe('configureApiClient (real client, mocked fetch)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    configureApiClient()
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('sets the runtime throwOnError flag, and a later shallow setConfig keeps it', () => {
    expect(client.getConfig().throwOnError).toBe(true)
  })

  const calls: [string, () => Promise<unknown>][] = [
    ['getTaskHistory', () => getTaskHistory(1)],
    ['getJournalEntries', () => getJournalEntries()],
    ['getJournalTodos', () => getJournalTodos(1)],
    ['addJournalTodo', () => addJournalTodo(1, 2)],
    ['createLogEntry', () => createLogEntry(1, 'x')],
    ['getJournalNotes', () => getJournalNotes(1)],
    ['createJournalNote', () => createJournalNote(1, 'x')],
    ['getProjects', () => getProjects()],
    ['getApiV1TaskItems', () => getApiV1TaskItems()],
    ['postApiV1TaskItems', () => postApiV1TaskItems({ body: { title: 't' } as never })],
  ]

  describe.each([500, 404])('HTTP %i', status => {
    it.each(calls)('%s rejects with the parsed body', async (_name, call) => {
      fetchMock.mockResolvedValue(json(status, { message: 'nope' }))
      await expect(call()).rejects.toEqual({ message: 'nope' })
    })
  })

  it('rejects on a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(getTaskHistory(1)).rejects.toBeInstanceOf(TypeError)
  })

  it('rejects with {} on an empty-body 500', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))
    await expect(getJournalEntries()).rejects.toEqual({})
  })

  it('a per-call throwOnError: false still returns { error, response }', async () => {
    fetchMock.mockResolvedValue(json(404, { message: 'gone' }))
    const result = await deleteApiV1TaskItemsById({ path: { id: 1 }, throwOnError: false })
    expect(result.response?.status).toBe(404)
    expect(result.error).toEqual({ message: 'gone' })
  })
})
