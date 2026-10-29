/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TOUCH, allSelectors, body, media, sectionFrom, stripMedia } from '@/test/cssContract'

const path = (name: string) => fileURLToPath(new URL(name, import.meta.url))
const css = readFileSync(path('./tasks.css'), 'utf-8')

const MARKER = '/* ==== MOBILE (#317) ==== */'
const WIDTH = '(max-width: 480px)'
const section = sectionFrom(css, MARKER)
const base = css.slice(0, css.indexOf(MARKER))
const width = media(section, WIDTH)
const touch = media(section, TOUCH)
const tablet = media(section, '(max-width: 820px)')

// #320 appends its own marked section to projects.css; tolerate the file not existing yet.
const projectsPath = path('./projects.css')
const projectsCss = existsSync(projectsPath) ? readFileSync(projectsPath, 'utf-8') : null

const ALLOWED_ROOTS = ['.tasks-page', '.projects-page']
const FORBIDDEN_BARE = ['.t-badge', '.t-btn', '.t-input', '.t-card-actions']

function expectScoped(source: string) {
  for (const selector of allSelectors(source)) {
    expect(
      ALLOWED_ROOTS.some(root => selector === root || selector.startsWith(`${root} `) || selector.startsWith(`${root}.`)),
      `selector must start with an allowed root: ${selector}`,
    ).toBe(true)
  }
}

describe('tasks.css MOBILE (#317) scoping contract (AC37)', () => {
  it('has a delimited section with width, tablet and touch blocks', () => {
    expect(width.length).toBeGreaterThan(0)
    expect(touch.length).toBeGreaterThan(0)
    expect(tablet.length).toBeGreaterThan(0)
  })

  it('roots every selector after the marker at .tasks-page', () => {
    const selectors = allSelectors(section)
    expect(selectors.length).toBeGreaterThan(20)
    expectScoped(section)
  })

  it('never targets bare shared classes after the marker', () => {
    for (const selector of allSelectors(section)) {
      for (const bare of FORBIDDEN_BARE) {
        // A shared class may only appear as a descendant of a .tasks-page root, never as the subject root.
        expect(selector.startsWith(bare), selector).toBe(false)
      }
    }
  })

  it('applies the same contract to the marked section of projects.css when present', () => {
    const marker = '/* ==== MOBILE (#320) ==== */'
    if (!projectsCss || !projectsCss.includes(marker)) return
    expectScoped(sectionFrom(projectsCss, marker))
  })

  it('keeps width-only blocks free of 44px and --tap-min (sizing lives in the touch query)', () => {
    for (const block of [width, tablet]) {
      expect(block).not.toMatch(/44px/)
      expect(block).not.toMatch(/--tap-min/)
    }
  })

  it('does not change the shared base rules the journal depends on', () => {
    const baseRule = (selector: string) => body(base, selector).replace(/\s+/g, ' ').trim()
    expect(baseRule('.t-card-actions')).toBe('display: flex; gap: 4px; flex-shrink: 0;')
    for (const sel of ['.t-btn', '.t-input', '.t-panel']) {
      // Bare base rule exists outside the MOBILE section and is never re-declared inside it (only as `.tasks-page ...`).
      expect(base, sel).toMatch(new RegExp(`\\n${sel.replace('.', '\\.')}[ ,{]`))
      expect(allSelectors(section).some(s => s === sel), sel).toBe(false)
    }
    expect(base).toContain('.t-badge-project {')
    expect(allSelectors(section).some(s => s === '.t-badge-project')).toBe(false)
  })
})

describe('stacked rows (AC1, 5, 6, 9, 12)', () => {
  it('restyles table, tbody and rows as blocks/flex inside the <=480 query (AC1)', () => {
    expect(width).toMatch(/\.tasks-page \.t-list-table,[\s\S]*?display: block/)
    expect(width).toMatch(/\.tasks-page \.t-list-table \.t-list-row \{[^}]*display: flex/)
  })

  it('puts status and due on a wrapping flex line with 8px gaps (AC5)', () => {
    const row = /\.tasks-page \.t-list-table \.t-list-row \{([^}]*)\}/.exec(width)?.[1] ?? ''
    expect(row).toMatch(/flex-wrap: wrap/)
    expect(row).toMatch(/gap: 8px/)
  })

  it('hides the priority cell (AC6)', () => {
    expect(width).toMatch(/\.t-list-cell--priority \{ display: none; \}/)
  })

  it('indents subtasks 16px with a left border (AC9)', () => {
    const depth = /\.tasks-page \.t-depth-1 \{([^}]*)\}/.exec(width)?.[1] ?? ''
    expect(depth).toMatch(/padding-left: 16px/)
    expect(depth).toMatch(/border-left: 2px solid/)
  })

  it('keeps the table at 481-820px and scrolls inside .t-list-wrap (AC12)', () => {
    expect(tablet).toMatch(/\.tasks-page \.t-list-wrap \{[^}]*overflow-x: auto/)
    // Anchored on the list-only class so TaskDetailPage (#320) is not affected.
    expect(tablet).toMatch(/\.tasks-page\.t-list-page \{[^}]*overflow-x: clip/)
    expect(allSelectors(tablet)).not.toContain('.tasks-page')
    expect(tablet).not.toMatch(/display: block/)
  })

  it('wraps long titles and blocked reasons', () => {
    expect(width).toMatch(/\.t-task-link,[\s\S]*?overflow-wrap: anywhere/)
    expect(width).toMatch(/\.t-blocked-reason \{[^}]*white-space: normal[^}]*overflow-wrap: anywhere/)
  })
})

describe('touch targets (AC2, 8, 16, 22, 25, 26, 29)', () => {
  it('gives the tree toggle a 44px hit area around the 18px visual (AC2)', () => {
    expect(touch).toMatch(/\.t-tree-toggle::after \{[^}]*inset: -13px/)
    expect(base).toMatch(/\.t-tree-toggle,\r?\n\.t-tree-spacer \{\s*width: 18px;\s*height: 18px/)
  })

  it('makes row actions 44x44 with 8px gaps and 16px before Delete (AC8)', () => {
    expect(touch).toMatch(/\.t-list-cell--actions \.t-btn-icon \{[^}]*width: 44px;[^}]*height: 44px/)
    expect(touch).toMatch(/\.t-list-cell--actions \.t-card-actions \{ gap: 8px; \}/)
    // Delete sits at the far edge; its neighbour adds 8px on top of the 8px gap => >=16px between them.
    expect(touch).toMatch(/\.t-action-delete \{ margin-left: auto; \}/)
    expect(touch).toMatch(/\.t-btn-icon:has\(\+ \.t-action-delete\) \{ margin-right: 8px; \}/)
    expect(width).toMatch(/\.t-action-delete \{ margin-left: auto; \}/)
  })

  it('sizes the status control and unblock button to 44px', () => {
    expect(touch).toMatch(/\.t-status-btn \{[^}]*min-width: 44px;[^}]*min-height: 44px/)
  })

  it('sizes the block editor Save and Cancel to the tap minimum and the row full width (AC16)', () => {
    expect(touch).toMatch(/block-editor-save \{[^}]*min-height: var\(--tap-min\)/)
    expect(width).toMatch(/\.t-list-row--block-editor \{ width: 100%/)
  })

  it('makes the group header at least 44px tall and full width (AC22)', () => {
    expect(touch).toMatch(/\.t-group-toggle \{ min-height: 44px; \}/)
    expect(width).toMatch(/\.t-group-toggle \{[^}]*width: 100%/)
  })

  it('sizes the search input 100% wide on its own line, 44px tall, with a 44px clear hit area (AC25)', () => {
    expect(width).toMatch(/\.t-search-wrap \{[^}]*flex: 1 1 100%/)
    expect(width).toMatch(/\.t-search-input \{[^}]*width: 100%/)
    expect(touch).toMatch(/\.t-search-input \{ min-height: 44px; \}/)
    expect(touch).toMatch(/\.t-search-clear \{[^}]*min-width: 44px;[^}]*min-height: 44px/)
    // The 16px floor comes from index.css (touch inputs); the search base font stays untouched here.
    expect(base).toMatch(/\.t-search-input \{[^}]*font-size: 13px/)
  })

  it('reserves the clear-button width as search input padding on touch, and keeps the count beside the toggle', () => {
    expect(touch).toMatch(/\.t-search-input \{ padding-right: 44px; \}/)
    expect(width).not.toMatch(/\.t-search-input \{[^}]*padding-right/)
    expect(width).toMatch(/\.t-filter-count \{[^}]*flex: 0 1 auto/)
    expect(width).not.toMatch(/\.t-filter-count \{[^}]*flex: 1 1 100%/)
  })

  it('wraps chips with 8px gaps, 12px side padding, 44px tall on touch (AC26)', () => {
    const group = /\.tasks-page \.t-chip-group \{([^}]*)\}/.exec(width)?.[1] ?? ''
    expect(group).toMatch(/gap: 8px/)
    expect(group).toMatch(/padding-inline: 12px/)
    expect(touch).toMatch(/\.t-chip \{ min-height: 44px/)
  })

  it('gives open filter fields 44px checkbox rows and a full-width project select (AC29)', () => {
    expect(touch).toMatch(/\.t-status-option \{ min-height: 44px/)
    expect(touch).toMatch(/\.t-filter-fields \.t-select \{ width: 100%; min-height: 44px/)
  })

  it('sizes the Sort by select, direction button and Filters toggle to 44px', () => {
    expect(touch).toMatch(/\.t-sort-control \.t-select \{ min-height: 44px/)
    expect(touch).toMatch(/\.t-sort-dir \{ width: 44px; height: 44px/)
    expect(touch).toMatch(/\.t-filter-toggle \{ min-height: 44px/)
  })
})

describe('sorting and filters (AC18, 30, 38)', () => {
  it('visually hides the thead with the clip pattern, never display:none (AC18)', () => {
    const thead = /\.tasks-page \.t-list-table thead \{([^}]*)\}/.exec(width)?.[1] ?? ''
    expect(thead).toMatch(/clip: rect\(0 0 0 0\)/)
    expect(thead).toMatch(/overflow: hidden/)
    expect(thead).not.toMatch(/display:\s*none/)
  })

  it('hides the Sort by control and Filters toggle at base and shows them only in the <=480 query (AC18, 30)', () => {
    const baseSection = stripMedia(section)
    expect(baseSection).toMatch(/\.t-filter-toggle,\s*\.tasks-page \.t-sort-control \{ display: none; \}/)
    expect(width).toMatch(/\.t-filter-toggle \{[^}]*display: inline-flex/)
    expect(width).toMatch(/\.t-sort-control \{[^}]*display: flex/)
    expect(touch).not.toMatch(/\.t-sort-control \{/)
  })

  it('collapses the filter fields only inside the <=480 query (AC30)', () => {
    expect(stripMedia(section)).not.toMatch(/data-collapsed/)
    expect(stripMedia(section)).toMatch(/\.t-filter-fields \{ display: contents; \}/)
    expect(width).toMatch(/\.t-filter-fields\[data-collapsed="true"\] \{ display: none; \}/)
  })

  it('uses --page-pad for the page and 14px 12px for the panel (AC38)', () => {
    expect(base).toMatch(/\.tasks-page \{[^}]*padding: 28px var\(--page-pad\) 80px/)
    expect(width).toMatch(/\.tasks-page \.t-panel \{ padding: 14px 12px; \}/)
  })

  it('clears the sticky nav when the edit panel is scrolled into view', () => {
    expect(stripMedia(section)).toMatch(/\.t-edit-panel \{ scroll-margin-top: calc\(64px/)
  })
})

describe('cleanup (AC39)', () => {
  it('removed the unreferenced classes', () => {
    for (const cls of ['.t-list-th--movement', '.t-list-th--journal', '.t-list-cell--movement', '.t-modal', '.t-card {', '.t-badges']) {
      expect(css).not.toContain(cls)
    }
  })
})
