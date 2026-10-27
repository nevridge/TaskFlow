import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PrefsProvider } from '@/context/PrefsContext'
import { Layout } from './Layout'

// Unlike Layout.test.tsx, Nav and SettingsDrawer are NOT mocked here: this proves the real chain
// Nav hamburger ref -> Layout returnFocusRef -> SettingsDrawer / useFocusTrap fallback.
function renderLayout() {
  return render(
    <MemoryRouter>
      <PrefsProvider>
        <Layout />
      </PrefsProvider>
    </MemoryRouter>,
  )
}

// fireEvent.click does not focus the button, so activeElement stays <body> like a tap on iOS Safari.
function openDrawer() {
  const hamburger = screen.getByRole('button', { name: 'Open settings' })
  expect(document.activeElement).toBe(document.body)
  fireEvent.click(hamburger)
  return hamburger
}

describe('Layout focus return (real Nav + SettingsDrawer)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.classList.remove('drawer-open', 'is-dark')
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })

  it('opens the drawer from the hamburger, locks scroll and moves focus into the dialog', () => {
    renderLayout()
    expect(document.documentElement).not.toHaveClass('drawer-open')
    openDrawer()
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveClass('is-open')
    expect(document.documentElement).toHaveClass('drawer-open')
    expect(document.activeElement).toBe(dialog)
  })

  it('returns focus to the hamburger on Escape when the opener was <body>', () => {
    renderLayout()
    const hamburger = openDrawer()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveClass('is-open')
    expect(document.documentElement).not.toHaveClass('drawer-open')
    expect(document.activeElement).toBe(hamburger)
  })

  it('returns focus to the hamburger on backdrop click when the opener was <body>', () => {
    const { container } = renderLayout()
    const hamburger = openDrawer()
    fireEvent.click(container.querySelector('.settings-backdrop')!)
    expect(document.documentElement).not.toHaveClass('drawer-open')
    expect(document.activeElement).toBe(hamburger)
  })

  it('returns focus to the hamburger on the close button when the opener was <body>', () => {
    renderLayout()
    const hamburger = openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(document.documentElement).not.toHaveClass('drawer-open')
    expect(document.activeElement).toBe(hamburger)
  })
})
