import { describe, it, expect } from 'vitest'
import { getErrorCode, getPlanClearErrorMessage, getTaskMutationErrorMessage, getTaskPlanSaveErrorMessage } from './task-errors'
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
    ['TASK_REOPEN_PAST_DAY_NOT_ALLOWED', 'Tasks completed on a past day cannot be reopened.'],
    ['TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN', 'Parent tasks cannot be completed while child tasks are still open.'],
    ['TASK_PARENT_SELF_NOT_ALLOWED', 'A task cannot be set as its own parent.'],
    ['TASK_PARENT_DEPTH_NOT_ALLOWED', 'Only one subtask level is supported.'],
    ['TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN', 'This task has subtasks. Remove or reassign subtasks before deleting.'],
    ['TASK_PARENT_NOT_FOUND', 'The selected parent task was not found.'],
    ['TASK_CREATION_PAST_DAY_NOT_ALLOWED', 'You cannot create new tasks on a past journal day.'],
    ['TASK_PROJECT_NOT_FOUND', PROJECT_CREATE_NOT_FOUND_MESSAGE],
    ['TASK_PLAN_COMPLETED_NOT_ALLOWED', 'Completed tasks cannot be moved to another day. Reopen the task first.'],
    ['TASK_PARENT_STATUS_DERIVED', "This task's status follows its open subtasks. Complete or remove them to change it."],
    ['TASK_PARENT_COMPLETED_NOT_ALLOWED', "A completed task can't have open subtasks. Reopen the parent first, or keep this subtask completed."],
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

describe('getTaskPlanSaveErrorMessage', () => {
  it.each([
    ['TASK_CREATION_PAST_DAY_NOT_ALLOWED', 'You cannot plan a task on a past journal day. Nothing was saved.'],
    [
      'TASK_PLAN_HAS_OPEN_SUBTASKS',
      "A task with open subtasks can't be planned on a day. Plan its subtasks instead. Nothing was saved.",
    ],
    [
      'TASK_JOURNAL_ASSIGNMENT_CONFLICT',
      "Another tab or device just changed this task's planned day. Your other edits were not saved. We've refreshed it. Try again.",
    ],
    ['TASK_PLAN_COMPLETED_NOT_ALLOWED', 'Completed tasks cannot be moved to another day. Reopen the task first.'],
    ['TASK_PARENT_SELF_NOT_ALLOWED', 'A task cannot be set as its own parent.'],
  ])('maps %s', (code, message) => {
    expect(getTaskPlanSaveErrorMessage({ code })).toBe(message)
  })

  it('falls back to the generic save message', () => {
    expect(getTaskPlanSaveErrorMessage(new Error('x'))).toBe('Unable to save task changes. Please try again.')
  })

  it('leaves the shared mapper saying "create" for the past-day code', () => {
    expect(getTaskMutationErrorMessage({ code: 'TASK_CREATION_PAST_DAY_NOT_ALLOWED' }))
      .toBe('You cannot create new tasks on a past journal day.')
  })
})

describe('getPlanClearErrorMessage', () => {
  it('maps a 404 to the no-longer-on-that-day message', () => {
    expect(getPlanClearErrorMessage({ status: 404 })).toBe('The task is no longer on that day. Showing its current planned day.')
  })

  it('maps the completed code to the completed message', () => {
    expect(getPlanClearErrorMessage({ code: 'TASK_PLAN_COMPLETED_NOT_ALLOWED' }))
      .toBe('Completed tasks cannot be moved to another day. Reopen the task first.')
  })

  it.each([[{ status: 500 }], [new Error('boom')], [undefined]])('uses the generic message for %j', err => {
    expect(getPlanClearErrorMessage(err)).toBe('Unable to remove the planned day. Please try again.')
  })
})
