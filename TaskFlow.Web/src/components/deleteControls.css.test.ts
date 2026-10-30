/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

/** The `className` string literal of the element carrying the given attribute marker. */
function classNameNear(source: string, marker: string): string {
  const at = source.indexOf(marker)
  expect(at, `${marker} not found`).toBeGreaterThan(-1)
  // The className sits within the same JSX opening tag, before or after the marker.
  const tagStart = source.lastIndexOf('<button', at)
  const tagEnd = source.indexOf('>', at)
  const tag = source.slice(tagStart, tagEnd)
  const match = /className="([^"]*)"/.exec(tag)
  expect(match, `className literal not found in ${marker} tag`).not.toBeNull()
  return match![1]
}

// Tailwind only generates a variant when the complete class string appears literally in source.
describe('Delete controls use Tailwind aria-disabled variants (AC16)', () => {
  const list = classNameNear(read('./TaskListRow.tsx'), 'data-task-delete-id={')
  const detail = classNameNear(read('../pages/TaskDetailPage.tsx'), 'data-task-delete-id={')

  it.each([
    ['TaskListRow', list],
    ['TaskDetailPage', detail],
  ])('%s Delete dims and shows not-allowed when aria-disabled', (_name, classes) => {
    expect(classes).toContain('aria-disabled:opacity-')
    expect(classes).toContain('aria-disabled:cursor-not-allowed')
  })

  it('uses important variants to beat the unlayered tasks.css hover and cursor rules', () => {
    expect(list).toContain('aria-disabled:cursor-not-allowed!')
    expect(list).toContain('aria-disabled:hover:bg-transparent!')
    expect(list).toContain('aria-disabled:hover:text-(--muted)!')
    expect(list).toContain('aria-disabled:hover:border-(--line)!')
    expect(detail).toContain('aria-disabled:cursor-not-allowed!')
    expect(detail).toContain('aria-disabled:hover:bg-transparent!')
  })

  it('never uses the disabled attribute on the Delete controls', () => {
    for (const source of [read('./TaskListRow.tsx'), read('../pages/TaskDetailPage.tsx')]) {
      const at = source.indexOf('data-task-delete-id={')
      const tag = source.slice(source.lastIndexOf('<button', at), source.indexOf('>', at))
      expect(tag).not.toMatch(/\sdisabled[=\s{]/)
    }
  })
})
