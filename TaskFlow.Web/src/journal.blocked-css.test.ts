/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf-8')
const journalCss = read('./journal.css')
const indexCss = read('./index.css')

// jsdom cannot evaluate stylesheets, so these tests assert the CSS contract from the source text.
function rule(selector: string): string {
  const open = journalCss.indexOf(`
${selector} {`)
  if (open === -1) throw new Error(`No rule found for ${selector}`)
  const bodyStart = journalCss.indexOf('{', open) + 1
  return journalCss.slice(bodyStart, journalCss.indexOf('}', bodyStart))
}

describe('journal blocked styles', () => {
  it('scopes the blocked button/badge classes as .journal-page .classname (0-2-0)', () => {
    expect(() => rule('.journal-page .todo-block')).not.toThrow()
    expect(() => rule('.journal-page .todo-blocked-badge')).not.toThrow()
    expect(() => rule('.journal-page .todo.is-blocked .todo-check')).not.toThrow()
    expect(() => rule('.journal-page .todo-block-reason')).not.toThrow()
    expect(journalCss).not.toMatch(/(^|\n)\.todo-block(ed-badge|-reason)?\s*[{,]/)
  })

  it('reveals the Block button on hover, focus-within and focus-visible without removing it from the tab order', () => {
    expect(journalCss).toMatch(/\.journal-page \.todo:focus-within \.todo-block[^{]*\{\s*opacity:\s*1/)
    expect(journalCss).toMatch(/\.journal-page \.todo-block:focus-visible[^{]*\{\s*opacity:\s*1/)
    expect(journalCss).toMatch(/\.journal-page \.todo:hover \.todo-block/)
    expect(rule('.journal-page .todo-block')).not.toMatch(/display:\s*none|visibility:\s*hidden/)
  })

  it('draws the badge with a dashed border and a color-mix background from the danger tokens', () => {
    const badge = rule('.journal-page .todo-blocked-badge')
    expect(badge).toMatch(/border:\s*1px dashed var\(--danger-ink\)/)
    expect(badge).toMatch(/color-mix\([^)]*var\(--danger-bg\)/)
  })

  it('gives blocked rows a 3px left accent and reserves its width on every row', () => {
    expect(rule('.journal-page .todo')).toMatch(/border-left:\s*3px solid transparent/)
    expect(rule('.journal-page .todo.is-blocked')).toMatch(/border-left-color:\s*var\(--danger-ink\)/)
  })

  it('renders the reason as a muted single line with an ellipsis', () => {
    const reason = rule('.journal-page .todo-block-reason')
    expect(reason).toMatch(/white-space:\s*nowrap/)
    expect(reason).toMatch(/text-overflow:\s*ellipsis/)
    expect(reason).toMatch(/color:\s*var\(--muted\)/)
  })

  it('on narrow layouts keeps the Block button visible and puts the reason input on its own full-width line', () => {
    const media = /@media \(hover: none\), \(max-width: 820px\) \{([\s\S]*?)\n\}/.exec(
      journalCss.slice(journalCss.indexOf('/* Touch and narrow layouts')),
    )
    expect(media).not.toBeNull()
    expect(media![1]).toMatch(/\.todo-block \{[^}]*opacity:\s*1/)
    expect(rule('.journal-page .todo-block-input')).toMatch(/flex:\s*0 0 100%/)
  })

  it('defines the danger tokens it depends on in light and dark themes, and uses no --danger variable or inline colours', () => {
    expect(indexCss).toMatch(/--danger-ink:/)
    expect(indexCss).toMatch(/--danger-bg:/)
    const blockedSection = journalCss.slice(journalCss.indexOf('/* ─── Blocked tasks'))
    expect(blockedSection).not.toMatch(/var\(--danger\)/)
  })
})
