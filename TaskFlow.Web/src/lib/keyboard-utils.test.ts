import { describe, it, expect, vi, afterEach } from 'vitest'
import { isInputFocused } from './keyboard-utils'

describe('isInputFocused', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns false when no element is focused', () => {
    expect(isInputFocused()).toBe(false)
  })

  it('returns true when an input is the active element', () => {
    const el = document.createElement('input')
    document.body.appendChild(el)
    el.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns true when a textarea is the active element', () => {
    const el = document.createElement('textarea')
    document.body.appendChild(el)
    el.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns true when a select is the active element', () => {
    const el = document.createElement('select')
    document.body.appendChild(el)
    el.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns true when a contentEditable element is the active element', () => {
    // jsdom does not implement isContentEditable, so we stub activeElement directly
    const el = document.createElement('div')
    Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true })
    const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(el)
    expect(isInputFocused()).toBe(true)
    spy.mockRestore()
  })

  it('returns false when a non-input element (button) is the active element', () => {
    const el = document.createElement('button')
    document.body.appendChild(el)
    el.focus()
    expect(isInputFocused()).toBe(false)
  })

  it('returns false when a plain div is the active element', () => {
    const el = document.createElement('div')
    el.setAttribute('tabindex', '0')
    document.body.appendChild(el)
    el.focus()
    expect(isInputFocused()).toBe(false)
  })
})
