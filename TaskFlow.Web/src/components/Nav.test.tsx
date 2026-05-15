import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Nav } from './Nav'

function renderNav(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Nav onMenuClick={vi.fn()} />
    </MemoryRouter>
  )
}

describe('Nav', () => {
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

  it('Tasks link points to /tasks', () => {
    renderNav('/')
    expect(screen.getByRole('link', { name: /tasks/i })).toHaveAttribute('href', '/tasks')
  })
})
