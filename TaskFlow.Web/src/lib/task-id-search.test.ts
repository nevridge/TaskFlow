import { describe, it, expect } from 'vitest'
import { parseTaskId, MAX_TASK_ID } from './task-id-search'

describe('parseTaskId', () => {
  it.each([
    ['42', 42],
    ['#42', 42],
    [' 42 ', 42],
    ['042', 42],
    [' #042 ', 42],
    ['1', 1],
    ['2147483647', MAX_TASK_ID],
  ])('parses %j as %d', (input, expected) => {
    expect(parseTaskId(input)).toBe(expected)
  })

  it.each(['0', '00', '#0', '', '   ', '#', '4a2', '-5', '4.2', '#4 2', '##4', '2147483648', '99999999999999999999'])(
    'returns null for %j',
    input => {
      expect(parseTaskId(input)).toBeNull()
    },
  )
})
