import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { Layout } from './Layout'
import type { GlobalShortcutHandlers } from '@/hooks/useGlobalKeyboardShortcuts'

// Capture the handlers and options that Layout passes to the hook
let capturedHandlers: GlobalShortcutHandlers | null = null
let capturedDisabled: boolean | undefined = undefined

vi.mock('@/hooks/useGlobalKeyboardShortcuts', () => ({
  useGlobalKeyboardShortcuts: (
    handlers: GlobalShortcutHandlers,
    options?: { disabled?: boolean },
  ) => {
    capturedHandlers = handlers
    capturedDisabled = options?.disabled
  },
}))

// Mock child components that need complex context to render
vi.mock('@/components/Nav', () => ({
  Nav: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <nav data-testid="nav">
      <button onClick={onMenuClick}>Menu</button>
    </nav>
  ),
}))

vi.mock('@/components/SettingsDrawer', () => ({
  SettingsDrawer: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
    <div data-testid="settings-drawer" data-open={String(open)}>
      <button onClick={onClose}>Close Drawer</button>
    </div>
  ),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet" />,
  }
})

function renderLayout() {
  return render(
    <MemoryRouter>
      <PrefsProvider>
        <Layout />
      </PrefsProvider>
    </MemoryRouter>,
  )
}

describe('Layout', () => {
  beforeEach(() => {
    capturedHandlers = null
    capturedDisabled = undefined
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders Nav, SettingsDrawer, and Outlet', () => {
    renderLayout()
    expect(screen.getByTestId('nav')).toBeInTheDocument()
    expect(screen.getByTestId('settings-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('does not render KeyboardShortcutsModal by default', () => {
    renderLayout()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders KeyboardShortcutsModal when onShowHelp is triggered', () => {
    renderLayout()
    act(() => {
      capturedHandlers?.onShowHelp()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  it('hides KeyboardShortcutsModal when its onClose is called', async () => {
    renderLayout()
    act(() => {
      capturedHandlers?.onShowHelp()
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('passes disabled={true} to useGlobalKeyboardShortcuts when the drawer is open', async () => {
    renderLayout()
    // Initially closed
    expect(capturedDisabled).toBe(false)
    // Open the drawer
    await userEvent.click(screen.getByRole('button', { name: /menu/i }))
    expect(capturedDisabled).toBe(true)
  })

  it('passes disabled={false} to useGlobalKeyboardShortcuts when the drawer is closed', () => {
    renderLayout()
    expect(capturedDisabled).toBe(false)
  })

  it('closes KeyboardShortcutsModal when ? is pressed while modal is open', () => {
    renderLayout()
    act(() => {
      capturedHandlers?.onShowHelp()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
