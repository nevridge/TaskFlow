import { describe, it, expect } from 'vitest'
import { parseNoteContent } from './notes-format'

describe('parseNoteContent', () => {
  it('parses a single plain line as one paragraph', () => {
    expect(parseNoteContent('hello')).toEqual([{ type: 'paragraph', lines: ['hello'] }])
  })

  it('groups multiple plain lines into one paragraph', () => {
    expect(parseNoteContent('a\nb\nc')).toEqual([{ type: 'paragraph', lines: ['a', 'b', 'c'] }])
  })

  it('parses - and * lines as one ul with markers stripped', () => {
    expect(parseNoteContent('- a\n* b')).toEqual([{ type: 'ul', items: ['a', 'b'] }])
  })

  it('parses numbered lines as one ol and ignores the starting number', () => {
    expect(parseNoteContent('1. a\n2. b')).toEqual([{ type: 'ol', items: ['a', 'b'] }])
    expect(parseNoteContent('3. a\n7. b')).toEqual([{ type: 'ol', items: ['a', 'b'] }])
  })

  it('starts a new block when the list kind changes', () => {
    expect(parseNoteContent('- a\n1. b')).toEqual([
      { type: 'ul', items: ['a'] },
      { type: 'ol', items: ['b'] },
    ])
  })

  it('splits lists separated by a blank line', () => {
    expect(parseNoteContent('- a\n\n- b')).toEqual([
      { type: 'ul', items: ['a'] },
      { type: 'ul', items: ['b'] },
    ])
  })

  it('collapses multiple blanks and drops leading/trailing blanks', () => {
    expect(parseNoteContent('\n\na\n\n\n\nb\n\n')).toEqual([
      { type: 'paragraph', lines: ['a'] },
      { type: 'paragraph', lines: ['b'] },
    ])
  })

  it.each(['-item', '1)', '1.item', '*x*', '-', '- '])('treats %j as plain text', input => {
    const blocks = parseNoteContent(input)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
  })

  it('treats indented and tab-indented markers as plain text', () => {
    expect(parseNoteContent('  - x')).toEqual([{ type: 'paragraph', lines: ['  - x'] }])
    expect(parseNoteContent('\t- x')).toEqual([{ type: 'paragraph', lines: ['\t- x'] }])
  })

  it('normalizes CRLF and CR and trims trailing whitespace', () => {
    expect(parseNoteContent('a  \r\nb\rc\t')).toEqual([{ type: 'paragraph', lines: ['a', 'b', 'c'] }])
  })

  it('keeps HTML literal', () => {
    expect(parseNoteContent('<script>alert(1)</script>')).toEqual([
      { type: 'paragraph', lines: ['<script>alert(1)</script>'] },
    ])
  })

  it('returns [] for empty or whitespace-only input', () => {
    expect(parseNoteContent('')).toEqual([])
    expect(parseNoteContent('  \n \t\n')).toEqual([])
  })

  it('keeps paragraph, list, paragraph order', () => {
    expect(parseNoteContent('intro\n- a\n- b\noutro')).toEqual([
      { type: 'paragraph', lines: ['intro'] },
      { type: 'ul', items: ['a', 'b'] },
      { type: 'paragraph', lines: ['outro'] },
    ])
  })
})
