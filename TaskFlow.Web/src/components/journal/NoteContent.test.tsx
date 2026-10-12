import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteContent } from './NoteContent'

describe('NoteContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders HTML-like text literally without creating elements', () => {
    const { container } = render(<NoteContent text={'<script>alert(1)</script>\n<b>x</b>'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container).toHaveTextContent('<script>alert(1)</script>')
    expect(container).toHaveTextContent('<b>x</b>')
  })

  it('renders bullets as list items without the marker', () => {
    render(<NoteContent text={'- one\n* two'} />)
    expect(screen.getByRole('list')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual(['one', 'two'])
  })

  it('renders numbered lines as an ol', () => {
    const { container } = render(<NoteContent text={'1. one\n2. two'} />)
    expect(container.querySelector('ol')).not.toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders a multi-line paragraph with br elements', () => {
    const { container } = render(<NoteContent text={'a\nb\nc'} />)
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelectorAll('br')).toHaveLength(2)
  })

  it('renders a single plain line as text with no br or list', () => {
    const { container } = render(<NoteContent text="Remember to update docs" />)
    expect(screen.getByText('Remember to update docs')).toBeInTheDocument()
    expect(container.querySelector('br')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })
})
