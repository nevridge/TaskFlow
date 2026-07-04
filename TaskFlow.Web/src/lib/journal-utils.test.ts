import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { urlDateToISO, isValidISODate, todayISO, formatTime, prevWeekday, addWeekdays, dayWeekWeekdaysOnly, dayWeek, formatMonthDay } from './journal-utils'

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

// 2026-05-25 = Monday, 2026-05-29 = Friday, 2026-05-30 = Saturday, 2026-05-31 = Sunday
describe('prevWeekday', () => {
  it('returns the same date for a Monday', () => {
    expect(prevWeekday('2026-05-25')).toBe('2026-05-25')
  })

  it('returns the same date for a Wednesday', () => {
    expect(prevWeekday('2026-05-27')).toBe('2026-05-27')
  })

  it('returns the same date for a Friday', () => {
    expect(prevWeekday('2026-05-29')).toBe('2026-05-29')
  })

  it('Saturday returns the preceding Friday', () => {
    expect(prevWeekday('2026-05-30')).toBe('2026-05-29')
  })

  it('Sunday returns the preceding Friday', () => {
    expect(prevWeekday('2026-05-31')).toBe('2026-05-29')
  })
})

describe('addWeekdays', () => {
  it('Friday +1 returns Monday', () => {
    expect(addWeekdays('2026-05-29', 1)).toBe('2026-06-01')
  })

  it('Monday -1 returns Friday', () => {
    expect(addWeekdays('2026-06-01', -1)).toBe('2026-05-29')
  })

  it('Wednesday +1 returns Thursday (no skip needed)', () => {
    expect(addWeekdays('2026-05-27', 1)).toBe('2026-05-28')
  })

  it('Saturday +1 returns Monday (skips Sunday)', () => {
    // 2026-05-30 is Saturday; stepping +1 from a weekend must land on a weekday
    expect(addWeekdays('2026-05-30', 1)).toBe('2026-06-01')
  })

  it('n=0 returns the same date unchanged', () => {
    expect(addWeekdays('2026-05-27', 0)).toBe('2026-05-27')
  })
})

describe('dayWeekWeekdaysOnly', () => {
  const PROJECT_START = '2026-05-09'

  it('with weekdaysOnly=false delegates to dayWeek', () => {
    const date = '2026-05-28'
    expect(dayWeekWeekdaysOnly(date, PROJECT_START, false)).toEqual(dayWeek(date, PROJECT_START))
  })

  it('with weekdaysOnly=true Day 1 = Monday when start is Monday', () => {
    // 2026-05-25 is a Monday
    const result = dayWeekWeekdaysOnly('2026-05-25', '2026-05-25', true)
    expect(result.dayNum).toBe(1)
    expect(result.weekNum).toBe(1)
  })

  it('with weekdaysOnly=true Day 5 = Friday (end of first work week)', () => {
    // Mon 25 = Day 1, Tue 26 = Day 2, Wed 27 = Day 3, Thu 28 = Day 4, Fri 29 = Day 5
    const result = dayWeekWeekdaysOnly('2026-05-29', '2026-05-25', true)
    expect(result.dayNum).toBe(5)
    expect(result.weekNum).toBe(1)
  })

  it('with weekdaysOnly=true Monday of second work week = Day 6, Week 2', () => {
    // Mon 25 → Fri 29 = 5 days, Mon Jun 1 = Day 6
    const result = dayWeekWeekdaysOnly('2026-06-01', '2026-05-25', true)
    expect(result.dayNum).toBe(6)
    expect(result.weekNum).toBe(2)
  })

  it('with weekdaysOnly=true and weekend startDate normalizes to preceding Friday', () => {
    // startDate Saturday 2026-05-30 normalizes to Friday 2026-05-29
    // so Friday 2026-05-29 is Day 1
    const result = dayWeekWeekdaysOnly('2026-05-29', '2026-05-30', true)
    expect(result.dayNum).toBe(1)
  })
})

describe('formatMonthDay', () => {
  it('formats 2026-06-04 as "Jun 4"', () => {
    expect(formatMonthDay('2026-06-04')).toBe('Jun 4')
  })
  it('formats 2026-01-01 as "Jan 1"', () => {
    expect(formatMonthDay('2026-01-01')).toBe('Jan 1')
  })
})
