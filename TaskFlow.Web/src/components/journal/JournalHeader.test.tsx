import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('JournalHeader stat style', () => {
  beforeEach(() => {
    vi.mocked(todayISO).mockReturnValue('2026-05-28')
  })

  it('renders DAY and WEEK labels', () => {
    render(<JournalHeader isoDate="2026-05-28" style="stat" projectStart={PROJECT_START} />)
    expect(screen.getByText('DAY')).toBeInTheDocument()
    expect(screen.getByText('WEEK')).toBeInTheDocument()
  })

  it('shows Today badge when isoDate equals todayISO()', () => {
    render(<JournalHeader isoDate="2026-05-28" style="stat" projectStart={PROJECT_START} />)
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('hides Today badge when isoDate differs from todayISO()', () => {
    render(<JournalHeader isoDate="2026-05-27" style="stat" projectStart={PROJECT_START} />)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('renders a day-of-week name', () => {
    render(<JournalHeader isoDate="2026-05-28" style="stat" projectStart={PROJECT_START} />)
    // May 28 2026 is a Thursday
    expect(screen.getByText('Thursday')).toBeInTheDocument()
  })
})

describe('JournalHeader minimal style', () => {
  beforeEach(() => {
    vi.mocked(todayISO).mockReturnValue('2026-05-28')
  })

  it('renders Day/Week eyebrow text', () => {
    render(<JournalHeader isoDate="2026-05-28" style="minimal" projectStart={PROJECT_START} />)
    expect(screen.getByText(/Day \d+ · Week \d+/)).toBeInTheDocument()
  })

  it('renders a short date string', () => {
    render(<JournalHeader isoDate="2026-05-28" style="minimal" projectStart={PROJECT_START} />)
    // formatShort produces m-d-yyyy
    expect(screen.getByText('5-28-2026')).toBeInTheDocument()
  })
})
