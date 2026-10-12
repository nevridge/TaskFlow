import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { client } from './client/client.gen'
import { createProject, getProject } from './projects'
import { getApiErrorMessage } from '@/lib/api-error'

// Uses the REAL client with a mocked fetch to prove HTTP errors reject end to end.
describe('projects api (real client, mocked fetch)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    client.setConfig({ baseUrl: 'http://localhost', fetch: fetchMock as unknown as typeof fetch })
  })

  afterEach(() => {
    client.setConfig({ baseUrl: '', fetch: undefined })
  })

  it('rejects with the API message body on 409', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'A project with that name already exists.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const err = await createProject({ name: 'Dup' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toEqual({ message: 'A project with that name already exists.' })
    expect(getApiErrorMessage(err, 'fb')).toBe('A project with that name already exists.')
  })

  it('rejects on a bare 404', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    await expect(getProject(99)).rejects.toBeDefined()
  })

  it('resolves with data on success', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: 'P' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const res = await getProject(1)
    expect(res.data).toEqual({ id: 1, name: 'P' })
  })
})
