import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useRef, useState } from 'react'
import userEvent from '@testing-library/user-event'
import type { PrefsContextValue } from '@/context/PrefsContextDef'

vi.mock('@/context/usePrefs', () => ({
  usePrefs: vi.fn(),
}))

vi.mock('@/lib/themes', () => ({
  THEMES: [
    {
      id: 'default',
      label: 'Default',
      accentLight: '#000',
      accentDark: '#fff',
      bgLight: '#eee',
      bgDark: '#111',
    },
  ],
}))

import { usePrefs } from '@/context/usePrefs'
import { SettingsDrawer } from './SettingsDrawer'

function makePrefs(overrides?: Partial<PrefsContextValue>): PrefsContextValue {
  return {
    isDark: false,
    setIsDark: vi.fn(),
    theme: 'default',
    setTheme: vi.fn(),
    headerStyle: 'stat',
    setHeaderStyle: vi.fn(),
    todoSort: 'manual',
    setTodoSort: vi.fn(),
    projectStart: '2026-05-09',
    setProjectStart: vi.fn(),
    taskSortKey: 'title',
    setTaskSortKey: vi.fn(),
    taskSortDir: 'asc',
    setTaskSortDir: vi.fn(),
    autoCompleteParentWhenChildrenDone: false,
    setAutoCompleteParentWhenChildrenDone: vi.fn(),
    weekdaysOnly: false,
    setWeekdaysOnly: vi.fn(),
    ...overrides,
  }
}

function renderDrawer(open: boolean, prefs?: Partial<PrefsContextValue>) {
  const onClose = vi.fn()
  vi.mocked(usePrefs).mockReturnValue(makePrefs(prefs))
  const result = render(<SettingsDrawer open={open} onClose={onClose} />)
  return { ...result, onClose }
}

/** Owns the open state, with an opener outside the drawer and a hamburger fallback. */
function Harness() {
  const [open, setOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={hamburgerRef}>Hamburger</button>
      <button onClick={() => setOpen(true)}>Opener</button>
      <SettingsDrawer open={open} onClose={() => setOpen(false)} returnFocusRef={hamburgerRef} />
    </>
  )
}

describe('SettingsDrawer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes a named dialog, aria-modal when open, inert and aria-hidden when closed', () => {
    const { rerender, onClose, container } = renderDrawer(true)
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).not.toHaveAttribute('inert')
    rerender(<SettingsDrawer open={false} onClose={onClose} />)
    const closed = container.querySelector('.settings-drawer')!
    expect(closed).not.toHaveAttribute('aria-modal')
    expect(closed).toHaveAttribute('inert')
    expect(closed).toHaveAttribute('aria-hidden', 'true')
  })

  it('colours switches through classes, with no inline colours', () => {
    const { container } = renderDrawer(true, { isDark: true, weekdaysOnly: false })
    expect(screen.getByRole('switch', { name: /dark mode/i })).toHaveClass('settings-toggle', 'is-on')
    expect(screen.getByRole('switch', { name: /weekdays/i })).not.toHaveClass('is-on')
    for (const sw of container.querySelectorAll('.settings-toggle')) {
      expect(sw.getAttribute('style') ?? '').not.toMatch(/background|#34c759|rgba/i)
    }
  })

  it('marks the close button and segment buttons as tap targets', () => {
    renderDrawer(true)
    expect(screen.getByRole('button', { name: /close settings/i })).toHaveClass('tap-target')
    expect(screen.getByRole('button', { name: /minimal/i })).toHaveClass('tap-target')
  })

  describe('focus trap', () => {
    function focusables() {
      const dialog = screen.getByRole('dialog', { name: 'Settings' })
      return Array.from(dialog.querySelectorAll<HTMLElement>('button, input'))
    }

    it('wraps Tab from the last focusable to the first', async () => {
      renderDrawer(true)
      const items = focusables()
      items[items.length - 1].focus()
      await userEvent.tab()
      expect(items[0]).toHaveFocus()
    })

    it('wraps Shift+Tab from the first focusable to the last', async () => {
      renderDrawer(true)
      const items = focusables()
      items[0].focus()
      await userEvent.tab({ shift: true })
      expect(items[items.length - 1]).toHaveFocus()
    })

    it('wraps Shift+Tab from the container to the last focusable', async () => {
      renderDrawer(true)
      expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveFocus()
      const items = focusables()
      await userEvent.tab({ shift: true })
      expect(items[items.length - 1]).toHaveFocus()
    })

    it.each([
      ['Escape', async () => { await userEvent.keyboard('{Escape}') }],
      ['the backdrop', async () => { await userEvent.click(document.querySelector('.settings-backdrop')!) }],
      ['the close button', async () => { await userEvent.click(screen.getByRole('button', { name: /close settings/i })) }],
    ])('returns focus to the opener after closing with %s', async (_name, close) => {
      vi.mocked(usePrefs).mockReturnValue(makePrefs())
      render(<Harness />)
      const opener = screen.getByRole('button', { name: 'Opener' })
      opener.focus()
      await userEvent.keyboard('{Enter}')
      expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveFocus()
      await close()
      expect(opener).toHaveFocus()
    })

    it('falls back to the hamburger when the opener was removed', async () => {
      vi.mocked(usePrefs).mockReturnValue(makePrefs())
      render(<Harness />)
      const external = document.createElement('button')
      document.body.append(external)
      external.focus()
      fireEvent.click(screen.getByRole('button', { name: 'Opener' }))
      expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveFocus()
      external.remove()
      await userEvent.keyboard('{Escape}')
      expect(screen.getByRole('button', { name: 'Hamburger' })).toHaveFocus()
    })
  })

  it('does not have is-open class when closed', () => {
    const { container } = renderDrawer(false)
    const drawer = container.querySelector('.settings-drawer')
    expect(drawer?.className).not.toContain('is-open')
  })

  it('has is-open class when open', () => {
    const { container } = renderDrawer(true)
    const drawer = container.querySelector('.settings-drawer')
    expect(drawer?.className).toContain('is-open')
  })

  it('calls onClose when close button is clicked', async () => {
    const { onClose } = renderDrawer(true)
    await userEvent.click(screen.getByRole('button', { name: /close settings/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when backdrop is clicked', async () => {
    const { container, onClose } = renderDrawer(true)
    const backdrop = container.querySelector('.settings-backdrop')!
    await userEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed while open', async () => {
    const { onClose } = renderDrawer(true)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose when Escape is pressed while closed', async () => {
    const { onClose } = renderDrawer(false)
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clicking minimal header style segment calls setHeaderStyle("minimal")', async () => {
    const setHeaderStyle = vi.fn()
    renderDrawer(true, { setHeaderStyle })
    await userEvent.click(screen.getByRole('button', { name: /minimal/i }))
    expect(setHeaderStyle).toHaveBeenCalledWith('minimal')
  })

  it('clicking "open first" todo sort calls setTodoSort("open first")', async () => {
    const setTodoSort = vi.fn()
    renderDrawer(true, { setTodoSort })
    await userEvent.click(screen.getByRole('button', { name: /open first/i }))
    expect(setTodoSort).toHaveBeenCalledWith('open first')
  })

  it('dark mode toggle calls setIsDark with inverted value', async () => {
    const setIsDark = vi.fn()
    renderDrawer(true, { isDark: false, setIsDark })
    await userEvent.click(screen.getByRole('switch', { name: /toggle dark mode/i }))
    expect(setIsDark).toHaveBeenCalledWith(true)
  })

  it('auto-complete toggle calls setAutoCompleteParentWhenChildrenDone', async () => {
    const setAutoCompleteParentWhenChildrenDone = vi.fn()
    renderDrawer(true, { autoCompleteParentWhenChildrenDone: false, setAutoCompleteParentWhenChildrenDone })
    await userEvent.click(screen.getByRole('switch', { name: /toggle parent auto-complete/i }))
    expect(setAutoCompleteParentWhenChildrenDone).toHaveBeenCalledWith(true)
  })

  it('weekdays-only toggle calls setWeekdaysOnly with inverted value', async () => {
    const setWeekdaysOnly = vi.fn()
    renderDrawer(true, { weekdaysOnly: false, setWeekdaysOnly })
    await userEvent.click(screen.getByRole('switch', { name: /toggle weekdays-only counter/i }))
    expect(setWeekdaysOnly).toHaveBeenCalledWith(true)
  })

  it('theme swatch click calls setTheme("default")', async () => {
    const setTheme = vi.fn()
    renderDrawer(true, { setTheme })
    await userEvent.click(screen.getByRole('button', { name: 'Default' }))
    expect(setTheme).toHaveBeenCalledWith('default')
  })

  it('active theme swatch has is-active class', () => {
    renderDrawer(true, { theme: 'default' })
    const swatch = screen.getByRole('button', { name: 'Default' })
    expect(swatch.className).toContain('is-active')
  })
})
