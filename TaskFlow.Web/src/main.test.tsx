import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const calls = vi.hoisted(() => [] as string[])

vi.mock('@/api/configure-client', () => ({ configureApiClient: vi.fn(() => { calls.push('configure') }) }))
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: vi.fn(() => { calls.push('render') }) })),
}))
vi.mock('./App.tsx', () => ({ default: () => null }))
vi.mock('./index.css', () => ({}))

describe('main entry (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
    vi.resetModules()
    document.body.innerHTML = '<div id="root"></div>'
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('configures the API client once, before the app renders', async () => {
    const { configureApiClient } = await import('@/api/configure-client')
    await import('./main')

    expect(configureApiClient).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['configure', 'render'])
  })
})
