import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import * as api from '@/api/areas'
import { areaKeys } from './areaKeys'
import { projectKeys } from './projectKeys'
import { useCreateAreaMutation, useDeleteAreaMutation, useRenameAreaMutation } from './useAreas'

vi.mock('@/api/areas', () => ({
  getAreas: vi.fn(),
  createArea: vi.fn(),
  renameArea: vi.fn(),
  reorderAreas: vi.fn(),
  deleteArea: vi.fn(),
}))

const area = (id: number, name: string) => ({ id, name, displayOrder: id, projectCount: 0 })

function setup<T>(useHook: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(areaKeys.all, { data: [area(1, 'Work'), area(2, 'Home')] })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const { result } = renderHook(useHook, {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  })
  return {
    result,
    invalidated: () => invalidate.mock.calls.map(c => c[0]?.queryKey),
    names: () => qc.getQueryData<{ data: Array<{ name: string }> }>(areaKeys.all)?.data.map(a => a.name),
  }
}

describe('area mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('create appends the new area to the cached list before any refetch', async () => {
    vi.mocked(api.createArea).mockResolvedValue({ data: area(3, 'Health') } as never)
    const { result, names, invalidated } = setup(useCreateAreaMutation)
    await result.current.mutateAsync('Health')
    expect(names()).toEqual(['Work', 'Home', 'Health'])
    expect(invalidated()).toEqual([areaKeys.all])
  })

  // Projects carry areaName, and a failed rename can mean the area changed elsewhere.
  it.each([
    ['success', () => vi.mocked(api.renameArea).mockResolvedValue({ data: area(1, 'Job') } as never)],
    ['failure', () => vi.mocked(api.renameArea).mockRejectedValue({ message: 'dup' })],
  ])('rename reloads areas and projects on %s', async (_label, arrange) => {
    arrange()
    const { result, invalidated } = setup(useRenameAreaMutation)
    result.current.mutate({ id: 1, name: 'Job' })
    await waitFor(() => expect(result.current.isIdle || result.current.isPending).toBe(false))
    expect(invalidated()).toEqual([areaKeys.all, projectKeys.all])
  })

  it('delete drops the area from the cache and reloads areas and projects', async () => {
    vi.mocked(api.deleteArea).mockResolvedValue({} as never)
    const { result, names, invalidated } = setup(useDeleteAreaMutation)
    await result.current.mutateAsync({ id: 1, choice: { noArea: true } })
    expect(api.deleteArea).toHaveBeenCalledWith(1, { noArea: true })
    expect(names()).toEqual(['Home'])
    expect(invalidated()).toEqual([areaKeys.all, projectKeys.all])
  })

  it('a failed delete keeps the area and reloads both', async () => {
    vi.mocked(api.deleteArea).mockRejectedValue({ message: 'has projects' })
    const { result, names, invalidated } = setup(useDeleteAreaMutation)
    await expect(result.current.mutateAsync({ id: 1 })).rejects.toBeDefined()
    expect(names()).toEqual(['Work', 'Home'])
    expect(invalidated()).toEqual([areaKeys.all, projectKeys.all])
  })
})
