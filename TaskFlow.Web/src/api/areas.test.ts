import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { client } from './client/client.gen'
import { createArea, deleteArea, renameArea, reorderAreas, type AreaDeleteChoice } from './areas'

// The real client with a mocked fetch, so the assertions are about what goes over the wire.
describe('areas api', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  const sent = () => fetchMock.mock.calls[0][0] as Request

  it.each<[string, () => Promise<unknown>, string, string, unknown]>([
    ['create', () => createArea('Home'), 'POST', '/api/v1/Areas', { name: 'Home' }],
    ['rename', () => renameArea(4, 'Work'), 'PUT', '/api/v1/Areas/4', { name: 'Work' }],
    ['reorder', () => reorderAreas([2, 1]), 'PUT', '/api/v1/Areas/order', { areaIds: [2, 1] }],
  ])('%s sends its method, URL and body', async (_name, call, method, path, body) => {
    await call()
    expect(sent().method).toBe(method)
    expect(new URL(sent().url).pathname).toBe(path)
    expect(await sent().json()).toEqual(body)
  })

  // The server rejects more than one choice, and a missing one when the area has projects.
  it.each<[AreaDeleteChoice | undefined, string]>([
    [{ moveToAreaId: 2 }, '?moveToAreaId=2'],
    [{ newAreaName: 'Home & garden' }, '?newAreaName=Home%20%26%20garden'],
    [{ noArea: true }, '?noArea=true'],
    [undefined, ''],
  ])('delete with %j sends exactly that query', async (choice, query) => {
    await deleteArea(7, choice)
    expect(sent().method).toBe('DELETE')
    const url = new URL(sent().url)
    expect(url.pathname).toBe('/api/v1/Areas/7')
    expect(url.search).toBe(query)
  })
})
