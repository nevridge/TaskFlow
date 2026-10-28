import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { __resetCoarsePointerCache } from '@/lib/pointer'
import { useTapToEditBlock } from './useTapToEditBlock'

function setTouch(touch: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: touch }),
    configurable: true,
    writable: true,
  })
  __resetCoarsePointerCache()
}

const onEdit = vi.fn()

function Block() {
  const tap = useTapToEditBlock(onEdit)
  return createElement(
    'div',
    { ...tap, 'aria-label': 'block' },
    createElement('p', null, 'paragraph'),
    createElement('button', { type: 'button' }, 'inner'),
  )
}

const block = () => screen.getByLabelText('block')

describe('useTapToEditBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
  })

  it('returns the button semantics for a non-button element', () => {
    setTouch(false)
    render(createElement(Block))
    expect(block()).toHaveAttribute('role', 'button')
    expect(block()).toHaveAttribute('tabindex', '0')
    expect(block()).toHaveClass('edit-trigger')
  })

  it('a single click edits on a coarse pointer', async () => {
    setTouch(true)
    render(createElement(Block))
    await userEvent.click(block())
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('a single click does not edit on a fine pointer, a double-click does', async () => {
    setTouch(false)
    render(createElement(Block))
    await userEvent.click(block())
    expect(onEdit).not.toHaveBeenCalled()
    await userEvent.dblClick(block())
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('a click with detail 0 (assistive tech) edits on a fine pointer', () => {
    setTouch(false)
    render(createElement(Block))
    fireEvent.click(block(), { detail: 0 })
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('Enter edits once and prevents default', () => {
    setTouch(false)
    render(createElement(Block))
    expect(fireEvent.keyDown(block(), { key: 'Enter' })).toBe(false)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('Space edits once and prevents default (no page scroll)', () => {
    setTouch(false)
    render(createElement(Block))
    expect(fireEvent.keyDown(block(), { key: ' ' })).toBe(false)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    setTouch(false)
    render(createElement(Block))
    expect(fireEvent.keyDown(block(), { key: 'a' })).toBe(true)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('ignores a held key (repeat) but still prevents the default', () => {
    setTouch(false)
    render(createElement(Block))
    expect(fireEvent.keyDown(block(), { key: ' ', repeat: true })).toBe(false)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('ignores keys while an IME composition is active', () => {
    setTouch(false)
    render(createElement(Block))
    fireEvent.keyDown(block(), { key: 'Enter', isComposing: true })
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('ignores a keydown that bubbles from a nested child', () => {
    setTouch(false)
    render(createElement(Block))
    fireEvent.keyDown(screen.getByRole('button', { name: 'inner' }), { key: 'Enter' })
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('always calls the latest onEdit', () => {
    setTouch(false)
    const first = vi.fn()
    const second = vi.fn()
    function Swap({ cb }: { cb: () => void }) {
      const tap = useTapToEditBlock(cb)
      return createElement('div', { ...tap, 'aria-label': 'block' })
    }
    const { rerender } = render(createElement(Swap, { cb: first }))
    rerender(createElement(Swap, { cb: second }))
    fireEvent.keyDown(block(), { key: 'Enter' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
