import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { Layout } from './Layout'

vi.mock('@/api/areas', () => ({
  getAreas: vi.fn(async () => ({ data: [{ id: 1, name: 'Work', displayOrder: 0, projectCount: 1 }] })),
}))
vi.mock('@/api/projects', () => ({
  getProjects: vi.fn(async () => ({ data: [{ id: 9, name: 'Site', areaId: 1, isArchived: false }] })),
}))

// Real Layout, drawer and delete dialog: shortcut suppression is decided between them.
describe('Layout shortcuts around the delete-area dialog', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    document.documentElement.classList.remove('drawer-open', 'is-dark')
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })

  it('keeps shortcuts suppressed while the dialog is open', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PrefsProvider>
            <Layout />
          </PrefsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const shortcutsHelp = () => screen.queryByRole('dialog', { name: /keyboard shortcuts/i })

    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    await user.click(await screen.findByRole('button', { name: 'Delete Work' }))
    // A button, not a field: single-key shortcuts are already ignored while typing in one.
    screen.getByRole('button', { name: 'Cancel' }).focus()
    await user.keyboard('?')
    expect(shortcutsHelp()).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Delete the “Work” area?' })).toBeInTheDocument()

    // Positive control: the same key works once the dialog and the drawer are closed.
    await user.keyboard('{Escape}{Escape}')
    await user.keyboard('?')
    expect(shortcutsHelp()).toBeInTheDocument()
  })
})
