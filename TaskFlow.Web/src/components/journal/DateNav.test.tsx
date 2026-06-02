import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

vi.mock('@/lib/journal-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return {
    ...actual,
    todayISO: () => '2026-05-28',
  }
})

import { DateNav } from './DateNav'

describe('DateNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigate.mockReset()
  })

  it('renders date input with the given isoDate as value', () => {
    render(<DateNav isoDate="2026-05-28" weekdaysOnly={false} />)
    const input = screen.getByDisplayValue('2026-05-28')
    expect(input).toBeInTheDocument()
  })

  it('navigates to previous day when previous button is clicked', async () => {
    render(<DateNav isoDate="2026-05-28" weekdaysOnly={false} />)
    await userEvent.click(screen.getByRole('button', { name: /previous day/i }))
    expect(navigate).toHaveBeenCalledWith('/journal/05-27-2026')
  })

  it('navigates to next day when next button is clicked', async () => {
    render(<DateNav isoDate="2026-05-28" weekdaysOnly={false} />)
    await userEvent.click(screen.getByRole('button', { name: /next day/i }))
    expect(navigate).toHaveBeenCalledWith('/journal/05-29-2026')
  })

  it('navigates to today when Today button is clicked', async () => {
    render(<DateNav isoDate="2026-05-27" weekdaysOnly={false} />)
    await userEvent.click(screen.getByRole('button', { name: /today/i }))
    expect(navigate).toHaveBeenCalledWith('/journal/05-28-2026')
  })

  it('Today button has is-active class when isoDate matches today', () => {
    render(<DateNav isoDate="2026-05-28" weekdaysOnly={false} />)
    const todayBtn = screen.getByRole('button', { name: /today/i })
    expect(todayBtn.className).toContain('is-active')
  })

  it('Today button lacks is-active class when isoDate differs from today', () => {
    render(<DateNav isoDate="2026-05-27" weekdaysOnly={false} />)
    const todayBtn = screen.getByRole('button', { name: /today/i })
    expect(todayBtn.className).not.toContain('is-active')
  })

  it('date input change triggers navigate to the new date', async () => {
    render(<DateNav isoDate="2026-05-28" weekdaysOnly={false} />)
    const input = screen.getByDisplayValue('2026-05-28') as HTMLInputElement
    // Simulate change event directly
    Object.defineProperty(input, 'value', { writable: true, value: '2026-06-01' })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // navigate should have been called with the new date URL
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/journal/06-01-2026')
    })
  })

  it('prev button from Monday navigates to Friday when weekdaysOnly=true', async () => {
    // 2026-06-01 is a Monday; prev weekday = 2026-05-29 (Friday)
    render(<DateNav isoDate="2026-06-01" weekdaysOnly={true} />)
    await userEvent.click(screen.getByRole('button', { name: /previous day/i }))
    expect(navigate).toHaveBeenCalledWith('/journal/05-29-2026')
  })

  it('next button from Friday navigates to Monday when weekdaysOnly=true', async () => {
    // 2026-05-29 is a Friday; next weekday = 2026-06-01 (Monday)
    render(<DateNav isoDate="2026-05-29" weekdaysOnly={true} />)
    await userEvent.click(screen.getByRole('button', { name: /next day/i }))
    expect(navigate).toHaveBeenCalledWith('/journal/06-01-2026')
  })
})
