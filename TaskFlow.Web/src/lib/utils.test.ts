import { describe, it, expect } from 'vitest'
import { cn, formatDate } from './utils'

describe('cn', () => {
  it('returns empty string with no arguments', () => {
    expect(cn()).toBe('')
  })

  it('returns single class name', () => {
    expect(cn('foo')).toBe('foo')
  })

  it('ignores falsy values', () => {
    expect(cn('a', false as never)).toBe('a')
  })

  it('deduplicates conflicting tailwind classes (tailwind-merge)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})

describe('formatDate', () => {
  it('returns em-dash for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('returns em-dash for undefined', () => {
    expect(formatDate(undefined)).toBe('—')
  })

  it('formats a UTC ISO string containing the month and year', () => {
    const result = formatDate('2026-05-28T00:00:00Z')
    expect(result).toContain('May')
    expect(result).toContain('2026')
  })
})
