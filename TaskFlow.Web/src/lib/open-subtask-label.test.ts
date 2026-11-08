import { describe, it, expect } from 'vitest'
import { formatOpenSubtaskLabel } from './open-subtask-label'

describe('formatOpenSubtaskLabel', () => {
  it.each([
    [1, '1', '1 open subtask'],
    [2, '2', '2 open subtasks'],
    [99, '99', '99 open subtasks'],
    [100, '99+', '100 open subtasks'],
    [250, '99+', '250 open subtasks'],
  ])('count %i gives text %s and label "%s"', (count, text, label) => {
    expect(formatOpenSubtaskLabel(count)).toEqual({ text, label })
  })
})
