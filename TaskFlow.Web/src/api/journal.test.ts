import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client/client.gen', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { client } from './client/client.gen'
import { carryForwardJournalEntry, createJournalEntry, updateLogEntry } from './journal'

describe('journal api carry-forward (mocked client)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('carryForwardJournalEntry posts the offset to the carry-forward endpoint', () => {
    carryForwardJournalEntry(7, -300)

    expect(client.post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/v1/JournalEntries/{id}/carry-forward',
        path: { id: 7 },
        body: { timezoneOffsetMinutes: -300 },
      }),
    )
  })

  it('carryForwardJournalEntry sends an undefined offset when none is supplied', () => {
    carryForwardJournalEntry(7)

    const arg = vi.mocked(client.post).mock.calls[0][0] as { body: { timezoneOffsetMinutes?: number } }
    expect(arg.body.timezoneOffsetMinutes).toBeUndefined()
  })

  it('createJournalEntry forwards timezoneOffsetMinutes in the body', () => {
    createJournalEntry({ title: 't', date: '2026-06-10', timezoneOffsetMinutes: -300 })

    expect(client.post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/v1/JournalEntries',
        body: { title: 't', date: '2026-06-10', timezoneOffsetMinutes: -300 },
      }),
    )
  })
})

describe('journal api updateLogEntry (mocked client)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('PUTs the content and a null taskItemId to the log entry endpoint', () => {
    updateLogEntry(10, 5, 'edited text', null)

    expect(client.put).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/v1/JournalEntries/{entryId}/logs/{id}',
        path: { entryId: 10, id: 5 },
        body: { content: 'edited text', taskItemId: null },
      }),
    )
  })

  it('PUTs a linked taskItemId', () => {
    updateLogEntry(10, 5, 'edited text', 42)

    const arg = vi.mocked(client.put).mock.calls[0][0] as { body: { taskItemId?: number | null } }
    expect(arg.body.taskItemId).toBe(42)
  })
})
