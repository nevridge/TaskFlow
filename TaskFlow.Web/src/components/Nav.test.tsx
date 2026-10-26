import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Nav } from './Nav'

function renderNav(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Nav onMenuClick={vi.fn()} />
    </MemoryRouter>
  )
}

describe('Nav', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires onMenuClick when the hamburger is clicked', async () => {
    const onMenuClick = vi.fn()
    render(
      <MemoryRouter>
        <Nav onMenuClick={onMenuClick} />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: /open settings/i }))
    expect(onMenuClick).toHaveBeenCalledOnce()
  })

  it('exposes the hamburger through hamburgerRef and marks nav controls as tap targets', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(
      <MemoryRouter>
        <Nav onMenuClick={vi.fn()} hamburgerRef={ref} />
      </MemoryRouter>,
    )
    const hamburger = screen.getByRole('button', { name: /open settings/i })
    expect(ref.current).toBe(hamburger)
    expect(hamburger).toHaveClass('tap-target')
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('tap-target')
  })

  it('navigates when a link is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Nav onMenuClick={vi.fn()} />
        <Routes>
          <Route path="/projects" element={<div>Projects page</div>} />
          <Route path="*" element={<div>Other page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('link', { name: /^projects$/i }))
    expect(screen.getByText('Projects page')).toBeInTheDocument()
  })

  it('has no keyboard-shortcuts button (the help modal stays ?-only)', () => {
    renderNav('/')
    expect(screen.queryByRole('button', { name: /shortcut|keyboard|help/i })).not.toBeInTheDocument()
  })

  it('renders Journal and Tasks links', () => {
    renderNav('/')
    expect(screen.getByRole('link', { name: /journal/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /tasks/i })).toBeInTheDocument()
  })

  it('has an accessible name on the nav landmark', () => {
    renderNav('/')
    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument()
  })

  it('marks Journal link as active on a journal route', () => {
    renderNav('/journal/05-14-2026')
    const journalLink = screen.getByRole('link', { name: /journal/i })
    const tasksLink = screen.getByRole('link', { name: /tasks/i })
    expect(journalLink.className).toContain('is-active')
    expect(tasksLink.className).not.toContain('is-active')
  })

  it('marks Tasks link as active on the tasks route', () => {
    renderNav('/tasks')
    const journalLink = screen.getByRole('link', { name: /journal/i })
    const tasksLink = screen.getByRole('link', { name: /tasks/i })
    expect(tasksLink.className).toContain('is-active')
    expect(journalLink.className).not.toContain('is-active')
  })

  it('marks Tasks link as active on a task detail route', () => {
    renderNav('/tasks/42')
    const tasksLink = screen.getByRole('link', { name: /tasks/i })
    expect(tasksLink.className).toContain('is-active')
  })

  it('Journal link points to today\'s journal date', () => {
    renderNav('/')
    const journalLink = screen.getByRole('link', { name: /journal/i })
    expect(journalLink.getAttribute('href')).toMatch(/^\/journal\/\d{2}-\d{2}-\d{4}$/)
  })

  it('renders Projects link to /projects', () => {
    renderNav('/')
    expect(screen.getByRole('link', { name: /^projects$/i })).toHaveAttribute('href', '/projects')
  })

  it.each(['/projects', '/projects/3'])('marks Projects active on %s only', (path) => {
    renderNav(path)
    expect(screen.getByRole('link', { name: /^projects$/i }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: /^tasks$/i }).className).not.toContain('is-active')
    expect(screen.getByRole('link', { name: /journal/i }).className).not.toContain('is-active')
  })

  it('does not mark Projects active on tasks routes', () => {
    renderNav('/tasks')
    expect(screen.getByRole('link', { name: /^projects$/i }).className).not.toContain('is-active')
  })

  it('Tasks link points to /tasks', () => {
    renderNav('/')
    expect(screen.getByRole('link', { name: /tasks/i })).toHaveAttribute('href', '/tasks')
  })
})
