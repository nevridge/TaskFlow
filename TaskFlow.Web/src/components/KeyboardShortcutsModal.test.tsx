import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal'

function renderModal(onClose = vi.fn()) {
  return render(<KeyboardShortcutsModal onClose={onClose} />)
}

describe('KeyboardShortcutsModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('renders the Navigation (all pages) group with g→h, g→t, and ? shortcuts', () => {
    renderModal()
    expect(screen.getByText('Navigation (all pages)')).toBeInTheDocument()
    expect(screen.getByText('Go to today (home)')).toBeInTheDocument()
    expect(screen.getByText('Go to tasks page')).toBeInTheDocument()
    expect(screen.getByText('Show / hide this help')).toBeInTheDocument()
  })

  it('renders the Journal — Day Navigation group with [ and ] shortcuts', () => {
    renderModal()
    expect(screen.getByText('Journal — Day Navigation')).toBeInTheDocument()
    expect(screen.getByText('Previous day')).toBeInTheDocument()
    expect(screen.getByText('Next day')).toBeInTheDocument()
  })

  it('renders the Journal — Actions group with t, l, and n shortcuts', () => {
    renderModal()
    expect(screen.getByText('Journal — Actions')).toBeInTheDocument()
    expect(screen.getByText('New todo')).toBeInTheDocument()
    expect(screen.getByText('New log entry')).toBeInTheDocument()
    expect(screen.getByText('Focus notes')).toBeInTheDocument()
  })

  it('renders the Inputs group with Esc shortcut', () => {
    renderModal()
    expect(screen.getByText('Inputs')).toBeInTheDocument()
    expect(screen.getByText('Cancel / deselect focused field')).toBeInTheDocument()
  })

  it('calls onClose when the Close button is clicked', async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when ? is pressed', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('traps Tab focus on the Close button', async () => {
    renderModal()
    const closeBtn = screen.getByRole('button', { name: /close/i })
    await userEvent.tab()
    expect(closeBtn).toHaveFocus()
  })

  it('sets body overflow to hidden while open', () => {
    renderModal()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body overflow and returns focus to the previously focused element on close', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()

    document.body.style.overflow = ''

    const { unmount } = renderModal()
    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
  })
})
