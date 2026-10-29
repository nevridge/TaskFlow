import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteForm } from './NoteForm'
import { __resetCoarsePointerCache } from '@/lib/pointer'
import type { NoteResponseDto } from '@/api/client/types.gen'

describe('NoteForm', () => {
  it('renders content textarea', () => {
    render(<NoteForm onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/content/i)).toBeInTheDocument()
  })

  it('pre-fills content when editing', () => {
    const note: NoteResponseDto = { id: 1, content: 'Existing note', taskItemId: 1 }
    render(<NoteForm note={note} onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByDisplayValue('Existing note')).toBeInTheDocument()
  })

  it('calls onSubmit with content when submitted', async () => {
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText(/content/i), 'My note')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSubmit).toHaveBeenCalledWith({ content: 'My note' })
  })

  it('calls onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<NoteForm onSubmit={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('NoteForm on touch (#320)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn((query: string) => ({ matches: query.includes('pointer: coarse') })),
      configurable: true,
      writable: true,
    })
    __resetCoarsePointerCache()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
  })

  it('Enter inserts a newline and does not submit', async () => {
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText(/content/i), 'one{Enter}two')
    expect(screen.getByLabelText(/content/i)).toHaveValue('one\ntwo')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Save submits and Cancel closes, with Cancel before Save in DOM order', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<NoteForm onSubmit={onSubmit} onCancel={onCancel} />)
    const cancel = screen.getByRole('button', { name: /cancel/i })
    const save = screen.getByRole('button', { name: /save/i })
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.type(screen.getByLabelText(/content/i), 'hello')
    await userEvent.click(save)
    expect(onSubmit).toHaveBeenCalledWith({ content: 'hello' })
    await userEvent.click(cancel)
    expect(onCancel).toHaveBeenCalled()
  })
})
