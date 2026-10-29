/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TOUCH, allSelectors, body, media, sectionBetween, sectionFrom, stripMedia } from '@/test/cssContract'

const path = (name: string) => fileURLToPath(new URL(name, import.meta.url))
const css = readFileSync(path('./tasks.css'), 'utf-8')
const projectsCss = readFileSync(path('./projects.css'), 'utf-8')

const MARKER = '/* ==== MOBILE (#317) ==== */'
const MARKER_320 = '/* ==== MOBILE (#320) ==== */'
const WIDTH = '(max-width: 480px)'
// The #317 section ends where the #320 section starts, so media() never sees #320's blocks.
const section = sectionBetween(css, MARKER, MARKER_320)
const section320 = sectionFrom(css, MARKER_320)
const base = css.slice(0, css.indexOf(MARKER))
const width = media(section, WIDTH)
const touch = media(section, TOUCH)
const tablet = media(section, '(max-width: 820px)')

const width320 = media(section320, WIDTH)
const touch320 = media(section320, TOUCH)
const base320 = stripMedia(section320)

const projSection = sectionFrom(projectsCss, MARKER_320)
const projBase = projectsCss.slice(0, projectsCss.indexOf(MARKER_320))
const projWidth = media(projSection, WIDTH)
const projTouch = media(projSection, TOUCH)

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

  it('keeps width-only blocks free of 44px and --tap-min (sizing lives in the touch query)', () => {
    for (const block of [width, tablet, width320, projWidth]) {
      expect(block).not.toMatch(/44px/)
      expect(block).not.toMatch(/--tap-min/)
    }
  })

  it('does not change the shared base rules the journal depends on', () => {
    const baseRule = (selector: string) => body(base, selector).replace(/\s+/g, ' ').trim()
    expect(baseRule('.t-card-actions')).toBe('display: flex; gap: 4px; flex-shrink: 0;')
    for (const sel of ['.t-btn', '.t-input', '.t-panel']) {
      // Bare base rule exists outside the MOBILE sections and is never re-declared inside them (only as `.tasks-page ...`).
      expect(base, sel).toMatch(new RegExp(`\\n${sel.replace('.', '\\.')}[ ,{]`))
      for (const s of [section, section320]) {
        expect(allSelectors(s).some(x => x === sel), sel).toBe(false)
      }
    }
    expect(base).toContain('.t-badge-project {')
    for (const s of [section, section320]) {
      expect(allSelectors(s).some(x => x === '.t-badge-project')).toBe(false)
    }
  })
})

describe('MOBILE (#320) scoping contract', () => {
  it('places the #320 marker after the #317 marker, once, as the last marker in each file', () => {
    expect(css.indexOf(MARKER_320)).toBeGreaterThan(css.indexOf(MARKER))
    expect(css.split(MARKER_320)).toHaveLength(2)
    expect(projectsCss.split(MARKER_320)).toHaveLength(2)
  })

  it('roots every tasks.css selector in the #320 section at .tasks-page', () => {
    const selectors = allSelectors(section320)
    expect(selectors.length).toBeGreaterThan(20)
    expectScoped(section320)
    for (const selector of selectors) {
      expect(selector.startsWith('.tasks-page '), selector).toBe(true)
      for (const bare of FORBIDDEN_BARE) expect(selector.startsWith(bare), selector).toBe(false)
    }
  })

  it('roots every projects.css selector in the #320 section at .projects-page .p-* (0-2-0)', () => {
    const selectors = allSelectors(projSection)
    expect(selectors.length).toBeGreaterThan(15)
    for (const selector of selectors) {
      expect(selector.startsWith('.projects-page .p-'), selector).toBe(true)
    }
    expectScoped(projSection)
  })

  it('has separate width and touch blocks in projects.css and nothing else but those blocks', () => {
    expect(projWidth.length).toBeGreaterThan(0)
    expect(projTouch.length).toBeGreaterThan(0)
    expect(projWidth).not.toMatch(/--tap-min/)
    const outside = stripMedia(projSection).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    expect(outside).toBe('')
    expect(projSection).not.toMatch(/@keyframes|@supports/)
    expect(section320).not.toMatch(/@keyframes|@supports/)
  })

  it('keeps comments free of a literal media rule opener', () => {
    for (const source of [section320, projSection]) {
      const comments = source.match(/\/\*[\s\S]*?\*\//g) ?? []
      for (const c of comments) expect(c).not.toMatch(/@media[^*]*\{/)
    }
  })

  it('keeps touch blocks free of font-size and colour (the index.css floor supplies 16px)', () => {
    for (const block of [touch320, projTouch]) {
      expect(block).not.toMatch(/font-size/)
      expect(block).not.toMatch(/(^|[;{\s])color:/)
    }
  })

  it('pins the padding tokens (#317 panel, --page-pad users)', () => {
    expect(width).toMatch(/\.tasks-page \.t-panel \{ padding: 14px 12px; \}/)
    expect(width).toMatch(/\.t-list-row > \.t-list-cell[^{]*\{[^}]*min-width: 0/)
    expect(base).toMatch(/\.tasks-page \{[^}]*--page-pad/)
    expect(projBase).toMatch(/\.projects-page \{[^}]*padding: 28px var\(--page-pad\) 80px/)
    expect(projWidth).toMatch(/\.projects-page \.p-panel \{ padding: 14px 12px; \}/)
  })

  it('still lists .tasks-page and .projects-page in the index.css touch input floor', () => {
    const indexCss = readFileSync(path('./index.css'), 'utf-8')
    expect(indexCss).toMatch(/:is\([^)]*\.tasks-page[^)]*\.projects-page/)
  })
})

describe('TaskForm on mobile (#320)', () => {
  it('stacks Status and Priority in one column without collapsing the rows', () => {
    expect(width320).toMatch(/\.tasks-page \.t-form-row \{[^}]*flex-direction: column/)
    expect(width320).toMatch(/\.tasks-page \.t-form-row > \* \{[^}]*flex: 0 0 auto/)
  })

  it('sizes the form inputs 44px on touch without a font-size', () => {
    expect(touch320).toMatch(/\.tasks-page \.t-form-row \.t-input \{ min-height: 44px; \}/)
  })

  it('wraps Save and Cancel with an 8px gap, flex 1 1 120px children and 44px touch buttons', () => {
    const actions = /\.tasks-page \.t-form-actions \{([^}]*)\}/.exec(width320)?.[1] ?? ''
    expect(actions).toMatch(/flex-wrap: wrap/)
    expect(actions).toMatch(/gap: 8px/)
    expect(width320).toMatch(/\.tasks-page \.t-form-actions > \* \{[^}]*flex: 1 1 120px/)
    expect(touch320).toMatch(/\.tasks-page \.t-form-actions \.t-btn,\s*\.tasks-page \.t-form-actions \.t-btn-primary \{ min-height: 44px; \}/)
  })

  it('relies on the #317 subtask editor cell rule (min-width 0), adding no new subtask CSS', () => {
    expect(width).toMatch(/\.t-list-row > \.t-list-cell[^{]*\{[^}]*min-width: 0/)
    expect(section320).not.toMatch(/subtask/)
  })
})

describe('TaskDetailPage on mobile (#320)', () => {
  it('wraps the title row and lets the title shrink and break', () => {
    expect(width320).toMatch(/\.tasks-page \.t-card-row \{ flex-wrap: wrap; \}/)
    const title = /\.tasks-page \.t-detail-title \{([^}]*)\}/.exec(width320)?.[1] ?? ''
    expect(title).toMatch(/min-width: 0/)
    expect(title).toMatch(/overflow-wrap: anywhere/)
  })

  it('puts Edit and Delete on their own row, Delete at the far right, 44px on touch', () => {
    const actions = /\.tasks-page \.t-card-row \.t-card-actions \{([^}]*)\}/.exec(width320)?.[1] ?? ''
    expect(actions).toMatch(/flex: 1 1 100%/)
    expect(actions).toMatch(/gap: 8px/)
    expect(width320).toMatch(/\.tasks-page \.t-card-row \.t-btn-danger \{ margin-left: auto; \}/)
    expect(touch320).toMatch(/\.tasks-page \.t-card-row \.t-card-actions \{ gap: 8px; \}/)
    expect(touch320).toMatch(/\.tasks-page \.t-card-row \.t-btn-danger \{ min-height: 44px; min-width: 44px; \}/)
  })

  it('makes the meta one column whose children break long strings', () => {
    expect(width320).toMatch(/\.tasks-page \.t-detail-meta \{[^}]*flex-direction: column/)
    expect(width320).toMatch(/\.tasks-page \.t-detail-meta > \* \{[^}]*overflow-wrap: anywhere/)
  })

  it('makes the project quick-select full width and 44px on touch', () => {
    expect(width320).toMatch(/\.tasks-page \.t-detail-project \.t-select \{[^}]*width: 100%/)
    expect(touch320).toMatch(/\.tasks-page \.t-detail-project \.t-select \{ min-height: 44px; \}/)
  })

  it('shows the visible project name only in the width block, after the base display none', () => {
    expect(base320).toMatch(/\.tasks-page \.t-detail-project-name \{ display: none; \}/)
    expect(width320).toMatch(/\.tasks-page \.t-detail-project-name \{[^}]*display: block/)
    expect(touch320).not.toMatch(/t-detail-project-name/)
    expect(section320.indexOf('display: none;')).toBeLessThan(section320.indexOf('@media'))
  })

  it('makes Add Note full width and 44px on touch', () => {
    expect(width320).toMatch(/\.tasks-page \.t-section-hdr \.t-btn-primary \{ flex: 1 1 100%; \}/)
    expect(touch320).toMatch(/\.tasks-page \.t-section-hdr \.t-btn-primary \{ min-height: 44px; \}/)
  })

  it('wraps notes and history rows', () => {
    expect(width320).toMatch(/\.tasks-page \.t-note-content \{ overflow-wrap: anywhere; \}/)
    expect(width320).toMatch(/\.tasks-page \.t-note-footer \{[^}]*flex-wrap: wrap/)
    expect(width320).toMatch(/\.tasks-page \.t-history-item,\s*\.tasks-page \.t-history-line,\s*\.tasks-page \.t-history-time \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/)
  })

  it('gives the back link and note actions 44px hit areas on touch', () => {
    expect(touch320).toMatch(/\.tasks-page \.t-back-link \{ min-height: 44px; \}/)
    expect(touch320).toMatch(/\.tasks-page \.t-note-actions \{ gap: 8px; \}/)
    expect(touch320).toMatch(/\.tasks-page \.t-note-actions \.t-btn,\s*\.tasks-page \.t-note-actions \.t-btn-danger \{ min-height: 44px; min-width: 44px; \}/)
  })
})

describe('Projects pages on mobile (#320)', () => {
  it('lays a project row out in three lines with right-aligned actions', () => {
    expect(projWidth).toMatch(/\.projects-page \.p-row \{[^}]*flex-wrap: wrap[^}]*gap: 8px[^}]*padding: 12px/)
    expect(projWidth).toMatch(/\.projects-page \.p-row-main \{ flex: 1 1 100%; \}/)
    const actions = /\.projects-page \.p-row-actions \{([^}]*)\}/.exec(projWidth)?.[1] ?? ''
    expect(actions).toMatch(/flex: 1 1 100%/)
    expect(actions).toMatch(/justify-content: flex-end/)
    expect(projTouch).toMatch(/\.projects-page \.p-row-actions \{ gap: 8px; \}/)
    expect(projWidth).toMatch(/\.projects-page \.p-badge \{ white-space: nowrap; \}/)
  })

  it('keeps the detail head wrapping with a shrinkable title and a fixed Edit button', () => {
    expect(projWidth).toMatch(/\.projects-page \.p-detail-head \{[^}]*flex-wrap: wrap/)
    expect(projWidth).toMatch(/\.projects-page \.p-detail-head \.p-row-main \{[^}]*flex: 1 1 160px[^}]*min-width: 0/)
    expect(projWidth).toMatch(/\.projects-page \.p-detail-head \.p-title \{[^}]*overflow-wrap: anywhere/)
    expect(projWidth).toMatch(/\.projects-page \.p-detail-head > \.p-btn \{ flex-shrink: 0; \}/)
  })

  it('wraps the toolbar and sizes the toggle to 44px on touch', () => {
    expect(projWidth).toMatch(/\.projects-page \.p-toolbar \{[^}]*flex-wrap: wrap[^}]*gap: 8px/)
    expect(projTouch).toMatch(/\.projects-page \.p-toggle \{ min-height: 44px; \}/)
    expect(projTouch).toMatch(/\.p-toggle input\[type="checkbox"\] \{ width: 20px; height: 20px; \}/)
  })

  it('wraps form actions and sizes inputs and buttons on touch', () => {
    expect(projWidth).toMatch(/\.projects-page \.p-form-actions \{[^}]*flex-wrap: wrap/)
    expect(projWidth).toMatch(/\.projects-page \.p-form-actions > \* \{[^}]*flex: 1 1 120px/)
    expect(projTouch).toMatch(/\.projects-page \.p-btn \{ min-height: 44px; \}/)
    expect(projTouch).toMatch(/\.projects-page \.p-form \.p-input \{ min-height: 44px; \}/)
    expect(projBase).toMatch(/\.projects-page \.p-form \{[^}]*flex-direction: column/)
  })

  it('makes the row name and back link real 44px boxes and wraps task meta', () => {
    expect(projTouch).toMatch(/\.projects-page \.p-row-name \{[^}]*display: inline-flex[^}]*min-height: 44px/)
    expect(projTouch).toMatch(/\.projects-page \.p-back \{[^}]*display: inline-flex[^}]*min-height: 44px/)
    expect(projTouch).toMatch(/\.projects-page \.p-row-name \{[^}]*max-width: 100%[^}]*min-width: 0/)
    expect(projWidth).toMatch(/\.projects-page \.p-toolbar > \.p-toggle:only-child \{ flex: 1 1 100%; \}/)
    expect(projWidth).toMatch(/\.projects-page \.p-task-meta \{[^}]*overflow-wrap: anywhere/)
  })

  it('keeps the mobile section after the base rules it overrides', () => {
    for (const sel of ['.p-row', '.p-row-actions', '.p-detail-head', '.p-badge']) {
      expect(projBase, sel).toContain(`.projects-page ${sel} {`)
    }
    expect(projectsCss.trimEnd().endsWith('}')).toBe(true)
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
