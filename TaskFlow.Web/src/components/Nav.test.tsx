import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Nav } from './Nav'

function renderNav(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Nav />
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
    expect(journalLink.className).toContain('bg-blue-600')
    expect(tasksLink.className).not.toContain('bg-blue-600')
  })

  it('marks Tasks link as active on the tasks route', () => {
    renderNav('/tasks')
    const journalLink = screen.getByRole('link', { name: /journal/i })
    const tasksLink = screen.getByRole('link', { name: /tasks/i })
    expect(tasksLink.className).toContain('bg-blue-600')
    expect(journalLink.className).not.toContain('bg-blue-600')
  })

  it('marks Tasks link as active on a task detail route', () => {
    renderNav('/tasks/42')
    const tasksLink = screen.getByRole('link', { name: /tasks/i })
    expect(tasksLink.className).toContain('bg-blue-600')
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
