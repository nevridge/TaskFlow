/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A variable (not a literal) so Vite does not rewrite `new URL('./x', import.meta.url)` into an asset import.
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf-8')
const journalCss = read('./journal.css')

// jsdom cannot evaluate stylesheets, so these tests assert the CSS contract from the source text.
function rule(selector: string): string {
  const open = journalCss.indexOf(`
${selector} {`)
  if (open === -1) throw new Error(`No rule found for ${selector}`)
  const bodyStart = journalCss.indexOf('{', open) + 1
  return journalCss.slice(bodyStart, journalCss.indexOf('}', bodyStart))
}

/** Contents of the first `@media <query> {` at or after `from`, balanced on braces. */
function mediaBlock(query: string, from = 0): string {
  const at = journalCss.indexOf(`@media ${query} {`, from)
  if (at === -1) throw new Error(`No @media ${query}`)
  const start = journalCss.indexOf('{', at) + 1
  let depth = 1
  let i = start
  while (depth > 0 && i < journalCss.length) {
    if (journalCss[i] === '{') depth++
    else if (journalCss[i] === '}') depth--
    i++
  }
  return journalCss.slice(start, i - 1)
}

/** Declarations of the first `selector {` rule inside a media block (selector not required at column 0). */
function inBlock(block: string, selector: string): string {
  const escaped = selector
    .split(/,\s*/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&'))
    .join(',\\s*')
  // The selector must start a rule (after the block start, a brace, a comma or a newline), not end a longer one.
  const m = new RegExp(`(?:^|[,}\\n])[ \\t]*${escaped}\\s*\\{([^}]*)\\}`).exec(block)
  if (!m) throw new Error(`No rule for ${selector} in block`)
  return m[1]
}

const TOUCH = '(hover: none), (pointer: coarse)'
const phone = () => mediaBlock('(max-width: 480px)')
const touch = () => mediaBlock(TOUCH, journalCss.indexOf('/* Touch. Declared LAST'))

describe('journal notes, log and typeahead styles', () => {
  describe('log row grid', () => {
    it('sets the time track to auto at 480px and keeps the 44px track out of that block', () => {
      expect(inBlock(phone(), '.journal-page .log-entry')).toMatch(/--log-time-w:\s*auto/)
      // The 480px block may read --log-del-w (note grid) but never sets it: that is the touch block's job.
      expect(phone()).not.toMatch(/--log-del-w:/)
    })

    it('widens the delete track in the touch block through the variable, with no grid-template-columns there', () => {
      expect(touch()).toMatch(/\.journal-page \.log-entry \{ --log-del-w:\s*var\(--tap-min\); \}/)
      expect(touch()).not.toMatch(/grid-template-columns/)
    })

    it('flattens .log-body at 480px and puts time, text and delete on line 1, chip and relink on line 2', () => {
      const p = phone()
      expect(p).toMatch(/\.journal-page \.log-body \{ display: contents; \}/)
      expect(inBlock(p, '.journal-page .log-time')).toMatch(/grid-area:\s*1 \/ 1/)
      expect(p).toMatch(/\.journal-page \.log-text,\s*\.journal-page \.log-edit \{ grid-area: 1 \/ 2; \}/)
      expect(inBlock(p, '.journal-page .log-entry > .todo-x')).toMatch(/grid-area:\s*1 \/ 3/)
      expect(inBlock(p, '.journal-page .log-task-row')).toMatch(/grid-area:\s*2 \/ 2 \/ 3 \/ -1/)
    })

    it('stacks the note row at 480px: time and delete on line 1, text full width on line 2', () => {
      const p = phone()
      expect(inBlock(p, '.journal-page .log-entry.note-entry')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) var\(--log-del-w\)/)
      expect(inBlock(p, '.journal-page .log-entry.note-entry > .todo-x')).toMatch(/grid-area:\s*1 \/ 2/)
      expect(p).toMatch(/\.journal-page \.log-entry\.note-entry > \.note-text,\s*\.journal-page \.log-entry\.note-entry > \.note-edit-wrap \{ grid-area: 2 \/ 1 \/ 3 \/ -1; \}/)
    })

    it('lets the chip shrink and ellipsize instead of the fixed 200px / 220px caps', () => {
      const chip = /\.journal-page \.log-task-chip,\s*\.journal-page \.log-task-deleted-badge \{([^}]*)\}/.exec(phone())?.[1] ?? ''
      expect(chip).toMatch(/max-width:\s*100%/)
      expect(chip).toMatch(/overflow:\s*hidden/)
      expect(chip).toMatch(/text-overflow:\s*ellipsis/)
      expect(chip).toMatch(/white-space:\s*nowrap/)
      expect(chip).toMatch(/min-width:\s*0/)
    })

    it('lets the relink typeahead share line 2 with a short chip via its flex basis', () => {
      const t = inBlock(phone(), '.journal-page .log-task-row .task-typeahead')
      expect(t).toMatch(/flex:\s*1 1 8rem/)
      expect(t).toMatch(/min-width:\s*8rem/)
    })

    it('keeps the log text wrapping and shrinkable, with a focus ring on the edit triggers', () => {
      expect(rule('.log-text')).toMatch(/min-width:\s*0/)
      expect(rule('.log-text')).toMatch(/overflow-wrap:\s*anywhere/)
      expect(journalCss).toMatch(/\.journal-page \.note-text:focus-visible,\s*\.journal-page \.log-text:focus-visible \{[^}]*outline:\s*2px solid var\(--accent\)/)
    })

    it('styles the inline log editor like the todo editor, scoped at 0-2-0', () => {
      const edit = rule('.journal-page .log-edit')
      expect(edit).toMatch(/border-bottom:\s*1\.5px solid var\(--accent\)/)
      expect(edit).toMatch(/min-width:\s*0/)
      expect(edit).toMatch(/overflow-wrap:\s*anywhere/)
    })
  })

  describe('add rows', () => {
    it('wraps the log add row at 480px with the typeahead and Add on their own full-width line', () => {
      const p = phone()
      expect(inBlock(p, '.log-add-row')).toMatch(/flex-wrap:\s*wrap/)
      expect(inBlock(p, '.log-add-inputs')).toMatch(/flex:\s*0 0 100%/)
      const t = inBlock(p, '.log-add-inputs .task-typeahead')
      expect(t).toMatch(/flex:\s*1;/)
      expect(t).toMatch(/min-width:\s*0/)
      expect(rule('.log-add-inputs')).toMatch(/position:\s*relative/)
    })

    it('hides the Add button by default and shows it at 44px on touch', () => {
      expect(rule('.journal-page .log-add-btn')).toMatch(/display:\s*none/)
      const btn = inBlock(touch(), '.journal-page .log-add-btn')
      expect(btn).toMatch(/display:\s*inline-flex/)
      expect(btn).toMatch(/min-height:\s*var\(--tap-min\)/)
    })

    it('keeps the note actions right-aligned with at least an 8px gap and 44px buttons on touch', () => {
      const actions = rule('.journal-page .note-actions')
      expect(actions).toMatch(/justify-content:\s*flex-end/)
      expect(Number(/gap:\s*(\d+)px/.exec(actions)?.[1])).toBeGreaterThanOrEqual(8)
      const btn = inBlock(touch(), '.journal-page .note-actions button')
      expect(btn).toMatch(/min-height:\s*var\(--tap-min\)/)
      expect(btn).toMatch(/min-width:\s*var\(--tap-min\)/)
      expect(journalCss).toMatch(/\.journal-page \.note-action-save \{[^}]*background:\s*var\(--accent\)/)
    })

    it('gives the note textareas scroll-margin-bottom at 480px', () => {
      expect(phone()).toMatch(/\.journal-page \.note-add-input,\s*\.journal-page \.note-edit \{ scroll-margin-bottom: 96px; \}/)
    })

    it('wraps the notes add form so the actions take their own line inside it', () => {
      expect(rule('.journal-page .note-actions')).toMatch(/flex:\s*0 0 100%/)
      expect(journalCss).toMatch(/\.notes-section \.add-row \{ flex-wrap: wrap; \}/)
    })
  })

  describe('task typeahead', () => {
    it('fills its slot at 480px and anchors the dropdown to the row', () => {
      const wrapper = inBlock(phone(), '.task-typeahead')
      expect(wrapper).toMatch(/position:\s*static/)
      expect(wrapper).toMatch(/width:\s*100%/)
      expect(phone()).toMatch(/\.journal-page \.task-typeahead-input \{ width: 100%; \}/)
    })

    it('constrains the dropdown at 480px', () => {
      const d = inBlock(phone(), '.task-typeahead-dropdown')
      expect(d).toMatch(/left:\s*0/)
      expect(d).toMatch(/right:\s*0/)
      expect(d).toMatch(/min-width:\s*0/)
      expect(d).toMatch(/(^|[\s;])width:\s*100%/)
      expect(d).toMatch(/max-height:\s*min\(220px,\s*40dvh\)/)
      expect(d).toMatch(/overflow-y:\s*auto/)
      expect(d).toMatch(/overscroll-behavior:\s*contain/)
      expect(rule('.task-typeahead-dropdown')).toMatch(/touch-action:\s*pan-y/)
    })

    it('makes options at least 44px tall with wrapping text on touch', () => {
      const o = inBlock(touch(), '.journal-page .task-typeahead-option')
      expect(o).toMatch(/min-height:\s*var\(--tap-min\)/)
      expect(o).toMatch(/white-space:\s*normal/)
      expect(o).toMatch(/overflow-wrap:\s*anywhere/)
    })

    it('makes the note and log text a full-height tap zone on touch without display:flex', () => {
      const t = inBlock(touch(), '.journal-page .note-text, .journal-page .log-text')
      expect(t).toMatch(/min-height:\s*var\(--tap-min\)/)
      expect(t).not.toMatch(/display:\s*flex/)
    })
  })
})
