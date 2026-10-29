import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useNotesQuery, useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation } from './useNotes'

vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItemsByTaskIdNotes: vi.fn(),
  postApiV1TaskItemsByTaskIdNotes: vi.fn(),
  putApiV1TaskItemsByTaskIdNotesById: vi.fn(),
  deleteApiV1TaskItemsByTaskIdNotesById: vi.fn(),
}))

import * as sdk from '@/api/client/sdk.gen'

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useNotesQuery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls getApiV1TaskItemsByTaskIdNotes with taskId', async () => {
    vi.mocked(sdk.getApiV1TaskItemsByTaskIdNotes).mockResolvedValue({ data: [], response: new Response() } as never)
    const { result } = renderHook(() => useNotesQuery(3), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.getApiV1TaskItemsByTaskIdNotes).toHaveBeenCalledWith(expect.objectContaining({ path: { taskId: 3 } }))
  })
})

describe('useCreateNoteMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls postApiV1TaskItemsByTaskIdNotes', async () => {
    vi.mocked(sdk.postApiV1TaskItemsByTaskIdNotes).mockResolvedValue({ data: { id: 1, content: 'N' }, response: new Response() } as never)
    const { result } = renderHook(() => useCreateNoteMutation(3), { wrapper: makeWrapper() })
    result.current.mutate({ content: 'N' })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.postApiV1TaskItemsByTaskIdNotes).toHaveBeenCalledWith(
      expect.objectContaining({ path: { taskId: 3 }, body: { content: 'N' } })
    )
  })
})

describe('useUpdateNoteMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls putApiV1TaskItemsByTaskIdNotesById with taskId, id, and body', async () => {
    vi.mocked(sdk.putApiV1TaskItemsByTaskIdNotesById).mockResolvedValue({ data: { id: 7, content: 'U' }, response: new Response() } as never)
    const { result } = renderHook(() => useUpdateNoteMutation(3), { wrapper: makeWrapper() })
    result.current.mutate({ id: 7, data: { content: 'U' } })
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.putApiV1TaskItemsByTaskIdNotesById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { taskId: 3, id: 7 }, body: { content: 'U' } })
    )
  })
})

describe('useDeleteNoteMutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls deleteApiV1TaskItemsByTaskIdNotesById with taskId and noteId', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsByTaskIdNotesById).mockResolvedValue({ response: new Response() } as never)
    const { result } = renderHook(() => useDeleteNoteMutation(3), { wrapper: makeWrapper() })
    result.current.mutate(7)
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
    expect(sdk.deleteApiV1TaskItemsByTaskIdNotesById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { taskId: 3, id: 7 } })
    )
  })

  it('passes throwOnError per call so a non-2xx rejects the mutation', async () => {
    vi.mocked(sdk.deleteApiV1TaskItemsByTaskIdNotesById).mockResolvedValue({ response: new Response() } as never)
    const { result } = renderHook(() => useDeleteNoteMutation(3), { wrapper: makeWrapper() })
    result.current.mutate(7)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sdk.deleteApiV1TaskItemsByTaskIdNotesById).toHaveBeenCalledWith({
      path: { taskId: 3, id: 7 },
      throwOnError: true,
    })
  })
})
