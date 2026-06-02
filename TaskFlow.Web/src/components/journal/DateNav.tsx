import { useNavigate } from 'react-router-dom'
import { addDays, addWeekdays, isoToUrlDate, todayISO } from '@/lib/journal-utils'

interface Props {
  isoDate: string
  weekdaysOnly: boolean
}

export function DateNav({ isoDate, weekdaysOnly }: Props) {
  const navigate = useNavigate()
  const today = todayISO()
  const isToday = isoDate === today

  function go(newIso: string) {
    navigate(`/journal/${isoToUrlDate(newIso)}`)
  }

  return (
    <div className="datenav">
      <button className="dn-btn" onClick={() => go(weekdaysOnly ? addWeekdays(isoDate, -1) : addDays(isoDate, -1))} aria-label="Previous day">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <input
        type="date"
        className="dn-date"
        value={isoDate}
        onChange={e => e.target.value && go(e.target.value)}
      />
      <button className="dn-btn" onClick={() => go(weekdaysOnly ? addWeekdays(isoDate, 1) : addDays(isoDate, 1))} aria-label="Next day">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M9 6l6 6-6 6"/>
        </svg>
      </button>
      <button
        className={'dn-today' + (isToday ? ' is-active' : '')}
        onClick={() => go(today)}
      >
        Today
      </button>
    </div>
  )
}
