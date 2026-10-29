import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { useToast } from '@/context/useToast'
import { Layout } from './Layout'

vi.mock('@/components/Nav', () => ({ Nav: () => <nav data-testid="nav" /> }))
vi.mock('@/components/SettingsDrawer', () => ({ SettingsDrawer: () => null }))

let api: ReturnType<typeof useToast>

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    Outlet: function Outlet() {
      api = useToast()
      return <div data-testid="outlet" />
    },
  }
})

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function key(k: string) {
  act(() => { fireEvent.keyDown(document.body, { key: k }) })
}

describe('Layout with a pending-delete toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    render(
      <MemoryRouter initialEntries={['/journal/05-28-2026']}>
        <PrefsProvider>
          <Layout />
          <Location />
        </PrefsProvider>
      </MemoryRouter>,
    )
    act(() => api.schedule({
      id: 'a',
      keys: ['a'],
      message: 'Note deleted',
      errorMessage: 'x',
      commit: () => new Promise(() => undefined),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('is-dark')
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('mounts the Notifications region from the provider in Layout, after the page content', () => {
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(screen.getByTestId('outlet').compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(region).getByRole("status")).toHaveTextContent("Note deleted")
  })

  it('keeps ? working while a toast is showing', () => {
    key('?')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('keeps the g t chord working while a toast is showing', () => {
    key('g')
    key('t')
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks')
  })

  it('keeps the g h chord working while a toast is showing', () => {
    key('g')
    key('h')
    expect(screen.getByTestId('location').textContent).toMatch(/^\/journal\/\d\d-\d\d-\d{4}$/)
  })

  it('does not undo on Escape', () => {
    key('Escape')
    expect(api.isPending('a')).toBe(true)
  })
})
