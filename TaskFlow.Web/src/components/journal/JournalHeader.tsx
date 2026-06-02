import { dayWeekWeekdaysOnly, dowName, formatLong, formatShort, todayISO } from '@/lib/journal-utils'

interface Props {
  isoDate: string
  style: 'stat' | 'minimal'
  projectStart: string
  weekdaysOnly: boolean
}

export function JournalHeader({ isoDate, style, projectStart, weekdaysOnly }: Props) {
  const { dayNum, weekNum } = dayWeekWeekdaysOnly(isoDate, projectStart, weekdaysOnly)
  const dow = dowName(isoDate)
  const isToday = isoDate === todayISO()

  if (style === 'minimal') {
    return (
      <header className="hdr hdr-min">
        <div>
          <div className="hdr-eyebrow">Day {dayNum} · Week {weekNum}</div>
          <h1 className="hdr-title">{dow}</h1>
        </div>
        <div className="hdr-date">{formatShort(isoDate)}</div>
      </header>
    )
  }

  return (
    <header className="hdr">
      <div className="hdr-stat">
        <div className="hdr-stat-row">
          <div className="hdr-num">
            <span className="hdr-num-label">DAY</span>
            <span className="hdr-num-val">{dayNum}</span>
          </div>
          <div className="hdr-num">
            <span className="hdr-num-label">WEEK</span>
            <span className="hdr-num-val">{weekNum}</span>
          </div>
        </div>
        {isToday && <span className="hdr-today">Today</span>}
      </div>
      <div className="hdr-date-block">
        <div className="hdr-dow">{dow}</div>
        <div className="hdr-fulldate">{formatLong(isoDate)}</div>
      </div>
    </header>
  )
}
