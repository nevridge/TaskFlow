import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { urlDateToISO, isValidISODate, todayISO, formatTime } from './journal-utils'

describe('journal-utils date parsing', () => {
  it('rejects invalid URL dates and falls back to today', () => {
    expect(urlDateToISO('13-99-2026')).toBe(todayISO())
  })

  it('converts valid URL dates to ISO', () => {
    expect(urlDateToISO('05-13-2026')).toBe('2026-05-13')
  })

  it('validates real ISO dates', () => {
    expect(isValidISODate('2026-02-29')).toBe(false)
    expect(isValidISODate('2028-02-29')).toBe(true)
  })
})

describe('formatTime', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-05-28T09:05:00Z').getTime() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a time string matching h:mm AM/PM format for a morning timestamp', () => {
    const result = formatTime('2026-05-28T09:05:00Z')
    expect(result).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
  })

  it('returns a PM time for a noon timestamp', () => {
    const result = formatTime('2026-05-28T12:00:00Z')
    expect(result).toMatch(/(AM|PM)$/)
    // noon in UTC is 12:00 PM
    expect(result).toContain('PM')
  })

  it('returns an AM time for a midnight timestamp', () => {
    const result = formatTime('2026-05-28T00:00:00Z')
    expect(result).toContain('AM')
  })

  it('returns a valid time string when called without arguments', () => {
    const result = formatTime(undefined)
    expect(result).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
  })

  it('zero-pads minutes (minutes=5 shows :05)', () => {
    const result = formatTime('2026-05-28T09:05:00Z')
    expect(result).toContain(':05')
  })
})
