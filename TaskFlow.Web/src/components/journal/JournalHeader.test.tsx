import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/journal-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return {
    ...actual,
    todayISO: vi.fn(),
  }
})

import { todayISO } from '@/lib/journal-utils'
import { JournalHeader } from './JournalHeader'

const PROJECT_START = '2026-05-09'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('JournalHeader stat style', () => {
  beforeEach(() => {
    vi.mocked(todayISO).mockReturnValue('2026-05-28')
  })

  it('renders DAY and WEEK labels', () => {
    render(<JournalHeader isoDate="2026-05-28" style="stat" projectStart={PROJECT_START} weekdaysOnly={false} />)
    expect(screen.getByText('DAY')).toBeInTheDocument()
    expect(screen.getByText('WEEK')).toBeInTheDocument()
  })

  it('shows Today badge when isoDate equals todayISO()', () => {
    render(<JournalHeader isoDate="2026-05-28" style="stat" projectStart={PROJECT_START} weekdaysOnly={false} />)
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('hides Today badge when isoDate differs from todayISO()', () => {
    render(<JournalHeader isoDate="2026-05-27" style="stat" projectStart={PROJECT_START} weekdaysOnly={false} />)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('renders a day-of-week name', () => {
    render(<JournalHeader isoDate="2026-05-28" style="stat" projectStart={PROJECT_START} weekdaysOnly={false} />)
    // May 28 2026 is a Thursday
    expect(screen.getByText('Thursday')).toBeInTheDocument()
  })
})

describe('JournalHeader weekdaysOnly', () => {
  beforeEach(() => {
    vi.mocked(todayISO).mockReturnValue('2026-05-28')
  })

  it('shows weekday-only day count when weekdaysOnly=true', () => {
    // PROJECT_START = 2026-05-09 (Saturday) normalizes to 2026-05-08 (Friday)
    // 2026-05-11 (Monday) is Day 2 (Friday=1, Mon=2)
    render(<JournalHeader isoDate="2026-05-11" style="minimal" projectStart="2026-05-08" weekdaysOnly={true} />)
    expect(screen.getByText(/Day 2/)).toBeInTheDocument()
  })

  it('normalizes Saturday projectStart to preceding Friday for day count', () => {
    // projectStart 2026-05-09 (Saturday) normalizes to 2026-05-08 (Friday)
    // Friday 2026-05-08 should be Day 1 regardless of whether projectStart is Sat or Fri
    const resultWithSat = render(<JournalHeader isoDate="2026-05-08" style="minimal" projectStart="2026-05-09" weekdaysOnly={true} />)
    expect(resultWithSat.getByText(/Day 1/)).toBeInTheDocument()
    resultWithSat.unmount()

    // Same date with projectStart=Friday should also yield Day 1
    const resultWithFri = render(<JournalHeader isoDate="2026-05-08" style="minimal" projectStart="2026-05-08" weekdaysOnly={true} />)
    expect(resultWithFri.getByText(/Day 1/)).toBeInTheDocument()
  })
})

describe('JournalHeader minimal style', () => {
  beforeEach(() => {
    vi.mocked(todayISO).mockReturnValue('2026-05-28')
  })

  it('renders Day/Week eyebrow text', () => {
    render(<JournalHeader isoDate="2026-05-28" style="minimal" projectStart={PROJECT_START} weekdaysOnly={false} />)
    expect(screen.getByText(/Day \d+ · Week \d+/)).toBeInTheDocument()
  })

  it('renders a short date string', () => {
    render(<JournalHeader isoDate="2026-05-28" style="minimal" projectStart={PROJECT_START} weekdaysOnly={false} />)
    // formatShort produces m-d-yyyy
    expect(screen.getByText('5-28-2026')).toBeInTheDocument()
  })
})
