import { describe, it, expect } from 'vitest'
import { getErrorCode, getTaskMutationErrorMessage } from './task-errors'
import { PROJECT_CREATE_NOT_FOUND_MESSAGE } from './project-errors'

describe('getErrorCode', () => {
  it('reads a string code from an object', () => {
    expect(getErrorCode({ code: 'X' })).toBe('X')
  })

  it('reads the code from a parsed API error body alongside other fields', () => {
    expect(getErrorCode({ code: 'TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN', message: 'm' })).toBe('TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN')
  })

  it('returns null for an error body without a code', () => {
    expect(getErrorCode({ message: 'boom' })).toBeNull()
  })

  it.each([null, undefined, 'text', 4, {}, { code: 5 }])('returns null for %j', value => {
    expect(getErrorCode(value)).toBeNull()
  })
})

describe('getTaskMutationErrorMessage', () => {
  it.each([
    ['TASK_REOPEN_PAST_DAY_NOT_ALLOWED', 'Completed tasks assigned to past days cannot be reopened.'],
    ['TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN', 'Parent tasks cannot be completed while child tasks are still open.'],
    ['TASK_PARENT_INCOMPLETE_CHILDREN', 'Parent tasks cannot be completed while child tasks are still open.'],
    ['TASK_PARENT_SELF_NOT_ALLOWED', 'A task cannot be set as its own parent.'],
    ['TASK_PARENT_CYCLE_NOT_ALLOWED', 'This parent assignment would create a cycle.'],
    ['TASK_PARENT_DEPTH_NOT_ALLOWED', 'Only one subtask level is supported.'],
    ['TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN', 'This task has subtasks. Remove or reassign subtasks before deleting.'],
    ['TASK_PARENT_NOT_FOUND', 'The selected parent task was not found.'],
    ['TASK_CREATION_PAST_DAY_NOT_ALLOWED', 'You cannot create new tasks on a past journal day.'],
    ['TASK_PROJECT_NOT_FOUND', PROJECT_CREATE_NOT_FOUND_MESSAGE],
  ])('maps %s', (code, message) => {
    expect(getTaskMutationErrorMessage({ code })).toBe(message)
  })

  it('falls back for unknown or missing codes', () => {
    expect(getTaskMutationErrorMessage({ code: 'SOMETHING_ELSE' })).toBe('Unable to save task changes. Please try again.')
    expect(getTaskMutationErrorMessage(new Error('boom'))).toBe('Unable to save task changes. Please try again.')
  })
})

describe('TASK_START_NOT_ALLOWED', () => {
  it('maps the 422 to the Set-to-Todo-first guidance', () => {
    expect(getTaskMutationErrorMessage({ code: 'TASK_START_NOT_ALLOWED' }))
      .toBe('Only Todo tasks can be moved to In Progress. Set it to Todo first.')
  })
})
