import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

// Uses the REAL useUpdateTaskMutation and mocks only the SDK, behaving like the generated client:
// an HTTP error rejects only when throwOnError is set, otherwise it resolves with { error }.
vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  getTaskV1: vi.fn(),
  postApiV1TaskItems: vi.fn(),
  putApiV1TaskItemsById: vi.fn(),
  deleteApiV1TaskItemsById: vi.fn(),
  patchApiV1TaskItemsById: vi.fn(),
}))

vi.mock('@/hooks/useProjects', () => ({
  useChangeTaskProject: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'
import { useChangeTaskProject } from '@/hooks/useProjects'
import { getTaskMutationErrorMessage } from '@/lib/task-errors'
import { useSaveTaskWithProject } from './useSaveTaskWithProject'

const changeAsync = vi.fn()

function setup() {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => useSaveTaskWithProject(getTaskMutationErrorMessage), { wrapper }).result
}

describe('useSaveTaskWithProject against an HTTP failing PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    changeAsync.mockReset().mockResolvedValue(undefined)
    vi.mocked(useChangeTaskProject).mockReturnValue({ mutateAsync: changeAsync } as never)
  })

  it('save() resolves false, sets the error and makes no project call when the PUT returns an HTTP error', async () => {
    const apiError = { code: 'TASK_PARENT_CYCLE_NOT_ALLOWED' }
    vi.mocked(sdk.putApiV1TaskItemsById).mockImplementation(((opts?: { throwOnError?: boolean }) =>
      opts?.throwOnError
        ? Promise.reject(apiError)
        : Promise.resolve({ error: apiError, response: new Response(null, { status: 422 }) })) as never)
    const result = setup()

    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5, projectId: 1 }, { title: 'T', projectId: 2 }, false) })

    expect(sdk.putApiV1TaskItemsById).toHaveBeenCalledWith(expect.objectContaining({ throwOnError: true }))
    expect(saved).toBe(false)
    expect(result.current.error).toBe('This parent assignment would create a cycle.')
    expect(changeAsync).not.toHaveBeenCalled()
  })

  it('a generic HTTP 500 falls back to the generic save message', async () => {
    vi.mocked(sdk.putApiV1TaskItemsById).mockImplementation(((opts?: { throwOnError?: boolean }) =>
      opts?.throwOnError ? Promise.reject('boom') : Promise.resolve({ response: new Response(null, { status: 500 }) })) as never)
    const result = setup()

    let saved = true
    await act(async () => { saved = await result.current.save({ id: 5 }, { title: 'T' }, false) })

    expect(saved).toBe(false)
    expect(result.current.error).toBe('Unable to save task changes. Please try again.')
  })
})
