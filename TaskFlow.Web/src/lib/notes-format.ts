export type NoteBlock =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }

const BULLET = /^[-*] (.*)$/
const NUMBERED = /^\d{1,9}\. (.*)$/

/**
 * Parses plain note text into blocks: paragraphs (consecutive plain lines),
 * bullet lists (`- ` / `* `) and numbered lists (`N. `). Blank lines separate
 * blocks; there is no nesting and the typed number is ignored.
 */
export function parseNoteContent(text: string): NoteBlock[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.trimEnd())

  const blocks: NoteBlock[] = []
  // True when the last block can still be extended (no blank line since it)
  let open = false

  for (const line of lines) {
    if (line === '') {
      open = false
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    const item = (bullet ?? numbered)?.[1].trim()
    const last = open ? blocks[blocks.length - 1] : undefined

    if (item) {
      const type = bullet ? 'ul' : 'ol'
      if (last?.type === type) {
        last.items.push(item)
      } else {
        blocks.push({ type, items: [item] })
      }
    } else if (last?.type === 'paragraph') {
      last.lines.push(line)
    } else {
      blocks.push({ type: 'paragraph', lines: [line] })
    }
    open = true
  }

  return blocks
}
