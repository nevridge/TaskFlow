/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf-8')
const css = read('./index.css')
const journalCss = read('./journal.css')
const html = read('../index.html')

// jsdom cannot evaluate stylesheets, so these tests assert the CSS contract from the source text.
function body(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`)
  if (at === -1) throw new Error(`No rule found for ${selector}`)
  const start = source.indexOf('{', at) + 1
  return source.slice(start, source.indexOf('}', start))
}

function blockEnd(source: string, start: number): number {
  let depth = 1
  let i = start
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return i
}

/** Contents of the first `@media <query> { ... }` block at or after `from`, balanced on braces. */
function media(source: string, query: string, from = 0): string {
  const at = source.indexOf(`@media ${query} {`, from)
  if (at === -1) throw new Error(`No @media ${query}`)
  const start = source.indexOf('{', at) + 1
  return source.slice(start, blockEnd(source, start) - 1)
}

function stripMedia(source: string): string {
  let out = source
  for (let m = /@media [^{]*\{/.exec(out); m; m = /@media [^{]*\{/.exec(out)) {
    out = out.slice(0, m.index) + out.slice(blockEnd(out, m.index + m[0].length))
  }
  return out
}

const TOUCH = '(hover: none), (pointer: coarse)'
const cssOutsideMedia = stripMedia(css)

describe('index.css conventions comment', () => {
  const header = css.slice(0, css.indexOf('/* ─── Global design tokens'))
  it('documents the four breakpoints and the layout/interaction rule', () => {
    expect(header).toMatch(/max-width: 820px/)
    expect(header).toMatch(/max-width: 480px/)
    expect(header).toContain('(hover: none), (pointer: coarse)')
    expect(header).toContain('(hover: hover) and (pointer: fine)')
    expect(header).toMatch(/layout keys off width; interaction and sizing key off the touch query/i)
  })
})

describe('tokens', () => {
  it('defines tap/input/page tokens in :root with a 12px phone page-pad', () => {
    const root = body(css, ':root')
    expect(root).toMatch(/--tap-min:\s*44px/)
    expect(root).toMatch(/--input-font-min:\s*16px/)
    expect(root).toMatch(/--page-pad:\s*24px/)
    expect(media(css, '(max-width: 480px)')).toMatch(/:root\s*\{\s*--page-pad:\s*12px/)
  })

  it('defines switch tokens for light (unchanged look) and dark (off colour at least .25 alpha)', () => {
    const root = body(css, ':root')
    expect(root).toMatch(/--switch-on:\s*#34c759/)
    expect(root).toMatch(/--switch-off:\s*rgba\(0,\s*0,\s*0,\s*\.15\)/)
    expect(root).toMatch(/--switch-thumb:\s*#fff/)
    const dark = body(css, 'html.is-dark')
    expect(dark).toMatch(/--switch-on:/)
    expect(dark).toMatch(/--switch-thumb:/)
    const off = /--switch-off:\s*rgba\(255,\s*255,\s*255,\s*(0?\.\d+)\)/.exec(dark)
    expect(off).not.toBeNull()
    expect(parseFloat(off![1])).toBeGreaterThanOrEqual(0.25)
  })

  it('styles the switch from the tokens, not theme accent', () => {
    expect(body(css, '.settings-toggle')).toMatch(/background:\s*var\(--switch-off\)/)
    expect(body(css, '.settings-toggle.is-on')).toMatch(/background:\s*var\(--switch-on\)/)
    expect(body(css, '.settings-toggle-thumb')).toMatch(/background:\s*var\(--switch-thumb\)/)
  })
})

describe('.tap-target', () => {
  it('sets touch-action outside any media query and min sizes only inside the touch query', () => {
    expect(body(cssOutsideMedia, '.tap-target')).toMatch(/touch-action:\s*manipulation/)
    expect(body(cssOutsideMedia, '.tap-target')).not.toMatch(/min-(width|height)/)
    const touch = media(css, TOUCH)
    expect(touch).toMatch(/\.tap-target\s*\{[^}]*min-width:\s*var\(--tap-min\)[^}]*min-height:\s*var\(--tap-min\)/)
  })
})

describe('nav', () => {
  const nav = body(css, '.app-nav')
  it('is sticky at the top below modals and the drawer, with safe-area padding', () => {
    expect(nav).toMatch(/position:\s*sticky/)
    expect(nav).toMatch(/top:\s*0/)
    const z = Number(/z-index:\s*(\d+)/.exec(nav)![1])
    expect(z).toBe(30)
    expect(z).toBeLessThan(40)
    expect(z).toBeLessThan(200)
    expect(nav).toContain('env(safe-area-inset-top)')
    expect(nav).toContain('env(safe-area-inset-left)')
    expect(nav).toContain('env(safe-area-inset-right)')
    expect(nav).toMatch(/background:\s*var\(--paper\)/)
  })
  it('never wraps and has no second menu or horizontal scroll', () => {
    expect(nav).toMatch(/white-space:\s*nowrap/)
    expect(nav).toMatch(/min-width:\s*0/)
    expect(nav).not.toMatch(/flex-wrap:\s*wrap|overflow-x/)
  })
  it('shrinks link padding and gap on phones', () => {
    const phone = media(css, '(max-width: 480px)', css.indexOf('/* Phone: shrink'))
    expect(phone).toMatch(/\.app-nav\s*\{[^}]*gap:\s*2px/)
    expect(phone).toMatch(/\.app-nav-link\s*\{[^}]*padding-left:\s*8px/)
  })
})

describe('settings drawer', () => {
  const drawer = body(css, '.settings-drawer')
  it('is responsive in width and height with a vh fallback', () => {
    expect(drawer).toMatch(/width:\s*min\(280px,\s*88vw\)/)
    expect(drawer.indexOf('height: 100vh')).toBeGreaterThan(-1)
    expect(drawer.indexOf('height: 100dvh')).toBeGreaterThan(drawer.indexOf('height: 100vh'))
  })
  it('scrolls internally and contains overscroll with safe-area bottom padding', () => {
    expect(drawer).toMatch(/overflow-y:\s*auto/)
    expect(drawer).toMatch(/overscroll-behavior:\s*contain/)
    expect(drawer).toMatch(/padding-bottom:\s*calc\(16px \+ env\(safe-area-inset-bottom\)\)/)
  })
  it('drops the transition for reduced motion but keeps the transform state', () => {
    const reduced = media(css, '(prefers-reduced-motion: reduce)')
    expect(reduced).toMatch(/\.settings-drawer,\s*\.settings-backdrop\s*\{\s*transition:\s*none/)
    expect(reduced).not.toMatch(/transform/)
    expect(body(css, '.settings-drawer.is-open')).toMatch(/translateX\(0\)/)
  })
  it('locks scroll only via html.drawer-open and never makes body fixed', () => {
    expect(body(css, 'html.drawer-open')).toMatch(/overflow:\s*hidden/)
    expect(body(css, 'html.drawer-open body')).toMatch(/overflow:\s*hidden/)
    expect(body(css, '.settings-backdrop')).toMatch(/touch-action:\s*none/)
    expect(css).not.toMatch(/body\s*\{[^}]*position:\s*fixed/)
    const rules = css.match(/[^{}]+\{[^{}]*overflow(-x)?:\s*hidden[^{}]*\}/g) ?? []
    for (const r of rules) {
      const selector = r.split('{')[0]
      if (/\b(html|body|#root)\b/.test(selector)) expect(selector).toContain('.drawer-open')
    }
  })
  it('lets labels wrap and keeps controls from shrinking', () => {
    expect(body(css, '.settings-row-label')).toMatch(/white-space:\s*normal/)
    expect(css).toMatch(/\.settings-row > :not\(\.settings-row-label\)\s*\{\s*flex-shrink:\s*0/)
  })
  it('sizes touch controls inside the touch query only, and keeps the swatch grid at two columns', () => {
    const touch = media(css, TOUCH, css.indexOf('Touch sizing for the drawer'))
    expect(touch).toMatch(/\.settings-seg-btn\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*var\(--tap-min\)/)
    expect(touch).toMatch(/\.settings-drawer-close\s*\{[^}]*var\(--tap-min\)/)
    expect(touch).toMatch(/\.settings-date-input\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
    expect(touch).toMatch(/\.settings-theme-swatch\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
    expect(touch).toMatch(/\.settings-row\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
    expect(body(css, '.settings-theme-grid')).toMatch(/grid-template-columns:\s*1fr 1fr/)
    expect(css.match(/\.settings-theme-grid[^{]*\{[^}]*grid-template-columns/g)).toHaveLength(1)
  })
})

describe('input font floor', () => {
  const touch = media(css, TOUCH, css.indexOf('Input font floor'))
  const selectorMatch = /(:is\(\.journal-page[^{]*)\{\s*font-size:\s*max\(var\(--input-font-min\),\s*1em\)/.exec(touch)

  // Specificity (classes/attrs/pseudo-classes) of the floor selector: :is() takes its most specific
  // argument (a class), and every :not([type]) adds one more.
  function floorSpecificity(sel: string): number {
    return 1 + (sel.match(/:not\(/g) ?? []).length
  }

  it('lives only inside the touch query with a max() floor and excludes non-text inputs', () => {
    expect(selectorMatch).not.toBeNull()
    const sel = selectorMatch![1]
    expect(sel).toMatch(/\.journal-page, \.tasks-page, \.projects-page, \.settings-drawer/)
    for (const t of ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit']) {
      expect(sel).toContain(`:not([type="${t}"])`)
    }
    expect(cssOutsideMedia).not.toContain('--input-font-min)')
  })

  it('has specificity of at least 0-2-1 and beats each known offender', () => {
    // Offenders: .journal-page .task-typeahead-input is 0-2-0; the font resets are 0-1-1; the rest are 0-1-0.
    expect(journalCss).toMatch(/\n\.journal-page \.task-typeahead-input \{/)
    expect(floorSpecificity(selectorMatch![1])).toBeGreaterThan(2)
    expect(css + journalCss).not.toMatch(/(task-typeahead-input|todo-block-input|settings-date-input)[^}]*font-size:[^;]*!important/)
  })

  it('also applies a tap-min min-height to text-type inputs on touch', () => {
    expect(touch).toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(touch).toMatch(/input:is\(\[type="text"\], \[type="date"\]/)
  })

  it('leaves desktop input sizes unchanged', () => {
    expect(body(css, '.settings-date-input')).toMatch(/font-size:\s*11\.5px/)
    expect(journalCss).toMatch(/\.journal-page \.task-typeahead-input \{[^}]*font-size:\s*12px/)
  })
})

describe('index.html viewport', () => {
  it('uses viewport-fit=cover and does not block zoom', () => {
    const meta = /<meta name="viewport"[^>]*>/.exec(html)![0]
    expect(meta).toContain('viewport-fit=cover')
    expect(meta).not.toMatch(/maximum-scale|user-scalable/)
  })
})
