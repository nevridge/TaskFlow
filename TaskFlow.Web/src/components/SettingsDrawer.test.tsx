import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    ...overrides,
  }
}

function renderDrawer(open: boolean, prefs?: Partial<PrefsContextValue>) {
  const onClose = vi.fn()
  vi.mocked(usePrefs).mockReturnValue(makePrefs(prefs))
  const result = render(<SettingsDrawer open={open} onClose={onClose} />)
  return { ...result, onClose }
}

describe('SettingsDrawer', () => {
  beforeEach(() => vi.clearAllMocks())

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
