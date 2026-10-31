import { describe, it, expect, afterEach } from 'vitest'
import { cn, formatDate, formatDateOnly } from './utils'

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

describe('formatDateOnly', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it.each([null, undefined, ''])('returns em-dash for %j', value => {
    expect(formatDateOnly(value)).toBe('—')
  })

  it.each([
    ['America/Los_Angeles', 420],
    ['UTC', 0],
    ['Asia/Tokyo', -540],
  ])('formats 2026-05-01 as May 1, 2026 in %s', (tz, offset) => {
    process.env.TZ = tz
    expect(new Date(2026, 4, 1).getTimezoneOffset()).toBe(offset)
    expect(formatDateOnly('2026-05-01')).toBe('May 1, 2026')
  })

  it('tolerates a legacy ISO timestamp by using its date part', () => {
    expect(formatDateOnly('2026-05-01T00:00:00.000Z')).toBe('May 1, 2026')
  })

  it('shows plain formatDate drifting a day west of UTC (the bug formatDateOnly avoids)', () => {
    process.env.TZ = 'America/Los_Angeles'
    expect(formatDate('2026-05-01')).toBe('Apr 30, 2026')
    expect(formatDateOnly('2026-05-01')).toBe('May 1, 2026')
  })
})
