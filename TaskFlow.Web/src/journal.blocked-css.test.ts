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

const TOUCH = '(hover: none), (pointer: coarse)'
const DESKTOP = '(hover: hover) and (pointer: fine)'

describe('journal touch and responsive styles', () => {
  const touch = () => mediaBlock(TOUCH, journalCss.indexOf('/* Touch. Declared LAST'))

  it('reveals row actions on hover only under (hover: hover) and (pointer: fine)', () => {
    const desktop = mediaBlock(DESKTOP)
    expect(desktop).toMatch(/\.journal-page \.todo:hover \.todo-x/)
    expect(desktop).toMatch(/\.journal-page \.todo:hover \.todo-history/)
    expect(desktop).toMatch(/\.journal-page \.todo:hover \.todo-block/)
    expect(desktop).toMatch(/\.journal-page \.log-entry:hover \.todo-x/)
    expect(journalCss).not.toMatch(/(^|\n)\.todo:hover/)
  })

  it('reveals actions on :focus-within for .todo and .log-entry outside the hover query', () => {
    expect(journalCss).toMatch(/\.journal-page \.todo:focus-within \.todo-x/)
    expect(journalCss).toMatch(/\.journal-page \.log-entry:focus-within \.todo-x/)
  })

  it('declares the touch block last, after the desktop block, with the hybrid-device comment', () => {
    const touchAt = journalCss.lastIndexOf(`@media ${TOUCH} {`)
    expect(touchAt).toBeGreaterThan(journalCss.indexOf(`@media ${DESKTOP} {`))
    expect(journalCss.indexOf('/* Touch. Declared LAST')).toBeLessThan(touchAt)
    expect(journalCss).toMatch(/touchscreen laptop/)
    expect(journalCss.slice(touchAt).match(/@media/g)).toHaveLength(1)
  })

  it('makes todo-x, todo-history and todo-block always visible at 44x44 with gaps of at least 8px', () => {
    const t = touch()
    expect(t).toMatch(/\.journal-page \.todo-x,\s*\.journal-page \.todo-history,\s*\.journal-page \.todo-block \{[^}]*opacity:\s*1;[^}]*width:\s*44px;[^}]*height:\s*44px/)
    expect(t).toMatch(/\.todo-subline-actions \{\s*gap:\s*8px/)
    expect(t).toMatch(/\.journal-page \.todo-x \{\s*margin-left:\s*8px/)
  })

  it('scopes every journal button rule as .journal-page .classname', () => {
    for (const cls of ['todo-x', 'todo-history', 'todo-block', 'todo-text', 'todo-blocked-badge', 'todo-check']) {
      expect(journalCss).not.toMatch(new RegExp(`(^|\\n)\\.${cls}\\s*[{,]`))
    }
  })

  it('gives the check an 18px visual with a 44px hit area that stays clear of the title', () => {
    const t = touch()
    expect(rule('.journal-page .todo-check')).toMatch(/width:\s*18px/)
    // Absolute insets are measured from the padding box, so the border width must be added to the inset.
    const hitArea = (selector: string, size: number) => {
      const inset = Number(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}::before \\{[^}]*inset:\\s*(-[\\d.]+)px`).exec(t)?.[1])
      const border = 1.5
      return size - 2 * border + 2 * -inset
    }
    expect(hitArea('.journal-page .todo-check', 18)).toBeGreaterThanOrEqual(44)
    expect(hitArea('.journal-page .todo-child .todo-check', 15)).toBeGreaterThanOrEqual(44)
    // Overhang past the border box must stay inside the column gap (id / title is not covered).
    expect((hitArea('.journal-page .todo-check', 18) - 18) / 2).toBeLessThanOrEqual(14)
    expect((hitArea('.journal-page .todo-child .todo-check', 15) - 15) / 2).toBeLessThanOrEqual(15)
    expect(t).toMatch(/\.journal-page \.todo \{ --todo-gap:\s*14px; \}/)
    expect(t).toMatch(/\.journal-page \.todo-child \{ --todo-gap:\s*15px; \}/)
    expect(rule('.todo')).toMatch(/gap:\s*12px var\(--todo-gap\)/)
  })

  it('makes the title a text-like button, a full-height tap zone on touch', () => {
    const text = rule('.journal-page .todo-text')
    expect(text).toMatch(/background:\s*none/)
    expect(text).toMatch(/border:\s*0/)
    expect(text).toMatch(/text-align:\s*left/)
    expect(text).toMatch(/cursor:\s*text/)
    expect(journalCss).toMatch(/\.journal-page \.todo-text:focus-visible/)
    expect(touch()).toMatch(/\.todo-text \{[^}]*min-height:\s*var\(--tap-min\)/)
  })

  it('wraps the blocked reason on touch (3-line clamp) with a 44px hit area; the badge is 44px too', () => {
    const t = touch()
    expect(t).toMatch(/\.todo-block-reason \{[^}]*min-height:\s*var\(--tap-min\)/)
    expect(t).toMatch(/white-space:\s*normal/)
    expect(t).toMatch(/overflow-wrap:\s*anywhere/)
    expect(t).toMatch(/-webkit-line-clamp:\s*3/)
    expect(t).toMatch(/\.todo-blocked-badge \{[^}]*min-height:\s*var\(--tap-min\)/)
  })

  it('sizes DateNav to 44px on touch with 8px spacing and a 16px date', () => {
    const t = touch()
    expect(t).toMatch(/\.datenav \{\s*gap:\s*8px/)
    expect(t).toMatch(/\.journal-page \.dn-btn,\s*\.journal-page \.dn-today \{[^}]*min-width:\s*var\(--tap-min\);[^}]*min-height:\s*var\(--tap-min\)/)
    expect(t).toMatch(/\.journal-page \.dn-date \{[^}]*min-height:\s*var\(--tap-min\);[^}]*font-size:\s*16px/)
  })

  it('wraps DateNav at 360px', () => {
    expect(mediaBlock('(max-width: 360px)')).toMatch(/\.datenav \{[^}]*width:\s*100%;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center/)
  })

  it('collapses the frame at 820px: card min-height 0, page padding-inline and 80px bottom', () => {
    const narrow = mediaBlock('(max-width: 820px)')
    expect(narrow).toMatch(/\.card \{ min-height: 0; \}/)
    expect(narrow).toMatch(/padding-inline:\s*var\(--page-pad\)/)
    expect(narrow).toMatch(/padding-bottom:\s*80px/)
    expect(rule('.card')).toMatch(/min-height:\s*calc\(440px \* var\(--den\)\)/)
    expect(rule('.journal')).toMatch(/overflow:\s*hidden/)
  })

  it('keeps the single-column grid and cards from growing past the container at 820px', () => {
    const narrow = mediaBlock('(max-width: 820px)')
    expect(narrow).toMatch(/\.j-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/)
    expect(narrow).not.toMatch(/grid-template-columns:\s*1fr\s*;/)
    expect(rule('.card')).toMatch(/min-width:\s*0/)
    expect(rule('.j-grid')).toMatch(/grid-template-columns:\s*1fr 1fr/)
  })

  it('bounds the log entry cell and wraps unbroken log text on every device', () => {
    expect(rule('.log-entry')).toMatch(/grid-template-columns:\s*64px minmax\(0, 1fr\) 22px/)
    expect(rule('.log-text')).toMatch(/min-width:\s*0/)
    expect(rule('.log-text')).toMatch(/overflow-wrap:\s*anywhere/)
    const t = mediaBlock(TOUCH, journalCss.indexOf('/* Touch. Declared LAST'))
    expect(t).not.toMatch(/(^|\n)\s*\.log-text\s*\{/)
  })

  it('wraps long task-history lines inside the sheet without editing tasks.css', () => {
    expect(journalCss).toMatch(/\.sheet \.t-panel,\s*\.sheet \.t-history-list,\s*\.sheet \.t-history-item \{ min-width: 0; \}/)
    expect(journalCss).toMatch(/\.sheet \.t-history-line \{ min-width: 0; overflow-wrap: anywhere; \}/)
    const t = mediaBlock(TOUCH, journalCss.indexOf('/* Touch. Declared LAST'))
    expect(t).not.toMatch(/t-history/)
  })

  it('lets the log add row and typeahead shrink instead of widening the layout', () => {
    expect(rule('.log-add-inputs')).toMatch(/min-width:\s*0/)
    expect(rule('.log-add-inputs .add-input')).toMatch(/width:\s*0/)
    expect(rule('.log-add-inputs .add-input')).toMatch(/min-width:\s*0/)
    expect(rule('.task-typeahead')).toMatch(/min-width:\s*0/)
    expect(rule('.log-add-inputs .task-typeahead')).toMatch(/flex:\s*0 1 auto/)
    expect(rule('.journal-page .task-typeahead-input')).toMatch(/max-width:\s*100%/)
    expect(rule('.journal-page .task-typeahead-input')).toMatch(/width:\s*150px/)
    expect(rule('.task-typeahead-dropdown')).toMatch(/min-width:\s*220px/)
  })

  it('keeps the shrink rules outside the touch query', () => {
    const t = mediaBlock(TOUCH, journalCss.indexOf('/* Touch. Declared LAST'))
    expect(t).not.toMatch(/\.j-grid|\.log-add-inputs|\.card \{[^}]*min-width/)
  })

  it('tightens the phone layout at 480px', () => {
    const phone = mediaBlock('(max-width: 480px)')
    expect(phone).toMatch(/\.card \{ padding: 14px 12px; \}/)
    expect(phone).toMatch(/\.hdr \{ padding: 16px 14px; \}/)
    expect(phone).toMatch(/\.hdr-fulldate \{\s*font-size:\s*18px;\s*overflow-wrap:\s*anywhere/)
    expect(phone).toMatch(/\.hdr-num \{\s*flex:\s*1 1 0;\s*min-width:\s*0;\s*padding:\s*8px 12px/)
    expect(phone).toMatch(/\.journal-page \.todo-child-list \{ padding-left: 16px; \}/)
    expect(phone).toMatch(/\.todo-edit \{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/)
    expect(phone).not.toMatch(/\.todo-text \{/)
    const title = rule('.journal-page .todo-text')
    expect(title).toMatch(/overflow-wrap:\s*break-word/)
    expect(title).not.toMatch(/anywhere/)
  })

  it('puts the todo row on two lines at 480px: actions left, badges right, in DOM order', () => {
    const phone = mediaBlock('(max-width: 480px)')
    expect(phone).toMatch(/\.todo-subline \{\s*display:\s*flex;\s*flex:\s*0 0 100%/)
    const actions = /\.journal-page \.todo-subline-actions \{([^}]*)\}/.exec(phone)?.[1] ?? ''
    expect(actions).toMatch(/display:\s*flex/)
    expect(actions).not.toMatch(/margin-left/)
    expect(journalCss).toMatch(/(^|\n)\.todo-subline,\s*\.todo-subline-meta,\s*\.todo-subline-actions \{ display: contents; \}/)
  })

  it('wraps the phone subline so actions drop below the badges instead of overlapping them', () => {
    const phone = mediaBlock('(max-width: 480px)')
    expect(phone).toMatch(/\.journal-page \.todo-subline \{[^}]*flex-wrap:\s*wrap/)
    expect(phone).toMatch(/\.journal-page \.todo-subline-meta \{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/)
    expect(phone).not.toMatch(/\.todo-subline-meta \{[^}]*min-width:\s*min-content/)
    expect(phone).not.toMatch(/\.todo-subline-actions \{[^}]*margin-left/)
    expect(phone).toMatch(/\.todo-subline-meta > \.todo-badges,\s*\.journal-page \.todo-subline-meta > \.todo-blocked-badge \{ max-width: 100%; \}/)
    const t = mediaBlock(TOUCH, journalCss.indexOf('/* Touch. Declared LAST'))
    expect(t).not.toMatch(/todo-subline \{|todo-subline-meta/)
    // The only subline rule allowed in the touch block is the pre-existing action gap.
    expect(t).toMatch(/\.journal-page \.todo-subline-actions \{ gap: 8px; \}/)
  })

  it('keeps the shrink chain that stops a long project pill overflowing at 375px', () => {
    const badges = rule('.journal-page .todo-badges')
    expect(badges).toMatch(/min-width:\s*0/)
    expect(badges).toMatch(/flex:\s*0 1 auto/)
    expect(badges).toMatch(/max-width:\s*100%/)
    const pill = rule('.journal-page .todo-badges .t-badge-project')
    expect(pill).toMatch(/flex:\s*0 1 auto/)
    expect(pill).toMatch(/min-width:\s*0/)
    expect(pill).toMatch(/max-width:\s*min\(16rem,\s*100%\)/)
    // The ellipsis itself lives in tasks.css, not journal.css.
    const tasksCss = read('./tasks.css')
    const base = /(^|\n)\.t-badge-project \{([^}]*)\}/.exec(tasksCss)?.[2] ?? ''
    expect(base).toMatch(/overflow:\s*hidden/)
    expect(base).toMatch(/text-overflow:\s*ellipsis/)
    expect(base).toMatch(/white-space:\s*nowrap/)
    expect(mediaBlock('(max-width: 480px)')).toMatch(/\.journal-page \.todo-subline-meta \{[^}]*flex-wrap:\s*wrap/)
  })

  it('wins the cascade for the subtask indent at 480px: higher specificity than the later base rule', () => {
    const classCount = (sel: string) => (sel.match(/\.[\w-]+/g) ?? []).length
    const phoneSel = '.journal-page .todo-child-list'
    const baseSel = '.todo-child-list'
    const phoneAt = journalCss.indexOf(`${phoneSel} { padding-left: 16px; }`)
    const baseAt = journalCss.indexOf(`\n${baseSel} {`)
    expect(phoneAt).toBeGreaterThan(-1)
    expect(baseAt).toBeGreaterThan(-1)
    // Either it comes later in the source at equal specificity, or it is strictly more specific.
    const wins = classCount(phoneSel) > classCount(baseSel) || (classCount(phoneSel) === classCount(baseSel) && phoneAt > baseAt)
    expect(wins).toBe(true)
    expect(journalCss.slice(baseAt)).toMatch(/padding:\s*0 0 0 20px/)
  })

  it('aligns phone line 2 with the title start using the same measures as line 1', () => {
    const phone = mediaBlock('(max-width: 480px)')
    expect(rule('.journal-page .todo-id')).toMatch(/min-width:\s*var\(--todo-id-w\)/)
    expect(phone).toMatch(/\.todo-subline \{[^}]*padding-left:\s*var\(--todo-title-x\)/)
    const titleX = /--todo-title-x:\s*calc\(var\(--todo-check\) \+ var\(--todo-gap\) \+ var\(--todo-id-w\) \+ var\(--todo-gap\)\)/
    expect(rule('.todo')).toMatch(titleX)
    expect(rule('.todo-child')).toMatch(titleX)
    const todo = rule('.todo')
    expect(todo).toMatch(/--todo-check:\s*18px/)
    expect(todo).toMatch(/--todo-gap:\s*12px/)
    expect(rule('.todo-child')).toMatch(/--todo-check:\s*15px/)
    expect(todo).toMatch(/--todo-id-w:\s*36px/)
  })

  it('keeps touch sizing out of the width-only blocks', () => {
    for (const q of ['(max-width: 820px)', '(max-width: 480px)', '(max-width: 360px)', '(width > 480px)']) {
      const block = mediaBlock(q)
      expect(block).not.toMatch(/44px|var\(--tap-min\)|(?<![\w-])opacity:\s*1\s*;/)
    }
  })
})

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
    expect(badge).toMatch(/border:\s*1px dashed color-mix\(in oklab, var\(--danger-ink\) 55%, transparent\)/)
    expect(badge).toMatch(/background:\s*color-mix\(in oklab, var\(--danger-bg\) 40%, transparent\)/)
    expect(badge).toMatch(/(^|[\s;])color:\s*var\(--danger-ink\)/)
  })

  it('styles the typeahead Blocked marker at 0-2-0 with a dashed danger-ink border', () => {
    const marker = rule('.journal-page .task-typeahead-blocked')
    expect(marker).toMatch(/border:\s*1px dashed var\(--danger-ink\)/)
    expect(marker).toMatch(/color:\s*var\(--danger-ink\)/)
    expect(journalCss).not.toMatch(/(^|\n)\.task-typeahead-blocked\s*[{,]/)
  })

  it('gives blocked rows a 2px left accent and reserves its width on every row', () => {
    expect(rule('.journal-page .todo')).toMatch(/border-left:\s*2px solid transparent/)
    expect(rule('.journal-page .todo.is-blocked')).toMatch(/border-left-color:\s*color-mix\([^)]*var\(--danger-ink\)/)
  })

  it('renders the reason as a muted single line with an ellipsis', () => {
    const reason = rule('.journal-page .todo-block-reason')
    expect(reason).toMatch(/white-space:\s*nowrap/)
    expect(reason).toMatch(/text-overflow:\s*ellipsis/)
    expect(reason).toMatch(/color:\s*var\(--muted\)/)
  })

  it('aligns the reason and its editor with the title edge instead of a hard-coded offset', () => {
    expect(rule('.journal-page .todo-block-reason')).toMatch(/padding:\s*0 0 0 var\(--todo-title-x\)/)
    const input = rule('.journal-page .todo-block-input')
    expect(input).toMatch(/margin-left:\s*var\(--todo-title-x\)/)
    expect(input).toMatch(/max-width:\s*calc\(100% - var\(--todo-title-x\)\)/)
    expect(input).toMatch(/flex:\s*0 0 100%/)
    expect(journalCss.slice(journalCss.indexOf('/* ─── Blocked tasks'))).not.toMatch(/30px/)
  })

  it('uses a thinner, softer rail that is shared by adjacent blocked rows, and none on subtasks', () => {
    const base = rule('.journal-page .todo')
    expect(base).toMatch(/border-left:\s*2px solid transparent/)
    expect(base).not.toMatch(/margin/)
    expect(rule('.journal-page .todo.is-blocked')).toMatch(/border-left-color:\s*color-mix\(in oklab, var\(--danger-ink\) 45%, transparent\)/)
    expect(rule('.journal-page .todo-child')).toMatch(/border-left:\s*0/)
    const childAt = journalCss.indexOf('\n.journal-page .todo-child {')
    const todoAt = journalCss.indexOf('\n.journal-page .todo {')
    expect(childAt).toBeGreaterThan(todoAt)
  })

  it('puts the metadata on its own line beneath the title above 480px', () => {
    const wide = mediaBlock('(width > 480px)')
    const meta = /\.journal-page \.todo-subline-meta \{([^}]*)\}/.exec(wide)?.[1] ?? ''
    expect(meta).toMatch(/flex:\s*0 0 100%/)
    expect(meta).toMatch(/padding-left:\s*var\(--todo-title-x\)/)
    expect(meta).toMatch(/box-sizing:\s*border-box/)
    expect(wide).not.toMatch(/:empty/)
    const phone = mediaBlock('(max-width: 480px)')
    expect(phone).not.toMatch(/order:\s*-1/)
    expect(phone).toMatch(/\.journal-page \.todo-subline-meta \{[^}]*justify-content:\s*flex-end/)
  })

  it('scopes every selector in the new width-only block under .journal-page', () => {
    const wide = mediaBlock('(width > 480px)')
    const selectors = wide.split('{').slice(0, -1).map(chunk => chunk.split('}').pop()!.trim())
    for (const sel of selectors) expect(sel.startsWith('.journal-page')).toBe(true)
  })

  it('no longer uses the old (hover: none), (max-width: 820px) query', () => {
    expect(journalCss).not.toContain('(hover: none), (max-width: 820px)')
    expect(journalCss).toContain('@media (hover: none), (pointer: coarse) {')
  })

  it('defines the danger tokens it depends on in light and dark themes, and uses no --danger variable or inline colours', () => {
    expect(indexCss).toMatch(/--danger-ink:/)
    expect(indexCss).toMatch(/--danger-bg:/)
    const blockedSection = journalCss.slice(journalCss.indexOf('/* ─── Blocked tasks'))
    expect(blockedSection).not.toMatch(/var\(--danger\)/)
  })
})
