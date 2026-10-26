import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFocusTrap } from './useFocusTrap'

function setup(html: string) {
  document.body.innerHTML = `<button id="opener">opener</button><button id="fb">fallback</button><div id="box" tabindex="-1">${html}</div>`
  return {
    box: document.getElementById('box') as HTMLElement,
    opener: document.getElementById('opener') as HTMLElement,
    fallback: document.getElementById('fb') as HTMLElement,
  }
}

function tab(shiftKey = false) {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  document.dispatchEvent(e)
  return e
}

describe('useFocusTrap', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { document.body.innerHTML = '' })

  it('wraps Tab from last to first and Shift+Tab from first or container to last', () => {
    const { box } = setup('<button id="a">a</button><button id="b">b</button>')
    renderHook(() => useFocusTrap({ current: box }, true))
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    b.focus()
    expect(tab().defaultPrevented).toBe(true)
    expect(a).toHaveFocus()
    expect(tab(true).defaultPrevented).toBe(true)
    expect(b).toHaveFocus()
    box.focus()
    expect(tab(true).defaultPrevented).toBe(true)
    expect(b).toHaveFocus()
  })

  it('does not intercept Tab in the middle of the container', () => {
    const { box } = setup('<button id="a">a</button><button id="b">b</button><button id="c">c</button>')
    renderHook(() => useFocusTrap({ current: box }, true))
    document.getElementById('b')!.focus()
    expect(tab().defaultPrevented).toBe(false)
  })

  it('does not intercept Tab when inactive', () => {
    const { box } = setup('<button id="a">a</button>')
    renderHook(() => useFocusTrap({ current: box }, false))
    document.getElementById('a')!.focus()
    expect(tab().defaultPrevented).toBe(false)
  })

  it('keeps focus and does not throw with zero focusables', () => {
    const { box } = setup('<span>nothing</span>')
    renderHook(() => useFocusTrap({ current: box }, true))
    box.focus()
    expect(() => expect(tab().defaultPrevented).toBe(true)).not.toThrow()
    expect(box).toHaveFocus()
  })

  it('skips disabled, tabindex=-1, hidden and inert elements, evaluated at keydown time', () => {
    const { box } = setup(
      '<button id="a">a</button><button id="x" disabled>x</button><button id="y" tabindex="-1">y</button>' +
        '<button id="h" hidden>h</button><div inert><button id="i">i</button></div><button id="z">z</button>',
    )
    renderHook(() => useFocusTrap({ current: box }, true))
    document.getElementById('z')!.focus()
    tab()
    expect(document.getElementById('a')).toHaveFocus()
    // z becomes disabled later: a is now the only focusable, so a is both first and last.
    document.getElementById('z')!.setAttribute('disabled', '')
    document.getElementById('a')!.focus()
    expect(tab().defaultPrevented).toBe(true)
    expect(document.getElementById('a')).toHaveFocus()
  })

  it('captures the opener before the container takes focus and restores it on deactivate', () => {
    const { box, opener } = setup('<button id="a">a</button>')
    opener.focus()
    const { rerender } = renderHook(({ active }) => useFocusTrap({ current: box }, active), {
      initialProps: { active: false },
    })
    rerender({ active: true })
    box.focus() // the drawer's own focus call runs after the hook's effect
    rerender({ active: false })
    expect(opener).toHaveFocus()
  })

  it('falls back when the opener is disconnected or was document.body', () => {
    const { box, opener, fallback } = setup('<button id="a">a</button>')
    opener.focus()
    const { rerender } = renderHook(({ active }) => useFocusTrap({ current: box }, active, { fallbackRef: { current: fallback } }), {
      initialProps: { active: true },
    })
    opener.remove()
    rerender({ active: false })
    expect(fallback).toHaveFocus()

    ;(document.activeElement as HTMLElement).blur()
    rerender({ active: true })
    expect(document.body).toHaveFocus()
    rerender({ active: false })
    expect(fallback).toHaveFocus()
  })
})
