// Source-text helpers for CSS contract tests. jsdom cannot evaluate stylesheets, so tests assert the
// CSS contract from the file text. Shared by tasks.css.test.ts (and reusable by #320's projects.css test).

export const TOUCH = '(hover: none), (pointer: coarse)'

/** Index just past the `}` that closes a block whose contents start at `start`. */
export function blockEnd(source: string, start: number): number {
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
export function media(source: string, query: string, from = 0): string {
  const at = source.indexOf(`@media ${query} {`, from)
  if (at === -1) throw new Error(`No @media ${query}`)
  const start = source.indexOf('{', at) + 1
  return source.slice(start, blockEnd(source, start) - 1)
}

/** Declaration body of the first rule `selector { ... }` (selector at the start of a line). */
export function body(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`)
  if (at === -1) throw new Error(`No rule found for ${selector}`)
  const start = source.indexOf('{', at) + 1
  return source.slice(start, source.indexOf('}', start))
}

/** Source with every `@media` block removed (base rules only). */
export function stripMedia(source: string): string {
  let out = source
  for (let m = /@media [^{]*\{/.exec(out); m; m = /@media [^{]*\{/.exec(out)) {
    out = out.slice(0, m.index) + out.slice(blockEnd(out, m.index + m[0].length))
  }
  return out
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every selector (comma-split, trimmed) of every style rule in `source`, including rules nested in @media. */
export function allSelectors(source: string): string[] {
  const text = stripComments(source)
  const selectors: string[] = []
  let i = 0
  let preludeStart = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') {
      const prelude = text.slice(preludeStart, i).trim()
      if (prelude.startsWith('@')) {
        // Descend into the at-rule: its inner rules are scanned by the same loop.
        i++
        preludeStart = i
        continue
      }
      prelude.split(',').map(s => s.trim()).filter(Boolean).forEach(s => selectors.push(s))
      i = blockEnd(text, i + 1)
      preludeStart = i
      continue
    }
    if (ch === '}' || ch === ';') preludeStart = i + 1
    i++
  }
  return selectors
}

/** Everything from `marker` to the end of the file, or throws when the marker is missing. */
export function sectionFrom(source: string, marker: string): string {
  const at = source.indexOf(marker)
  if (at === -1) throw new Error(`Marker ${marker} not found`)
  return source.slice(at)
}
