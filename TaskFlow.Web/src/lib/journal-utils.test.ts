import { describe, expect, it } from 'vitest'
import { urlDateToISO, isValidISODate, todayISO } from './journal-utils'

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
