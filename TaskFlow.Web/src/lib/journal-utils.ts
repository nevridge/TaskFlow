const PROJECT_START = '2026-05-09'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isValidISODate(s: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!match) return false

  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return false

  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO(): string {
  return isoDate(new Date())
}

export function addDays(s: string, n: number): string {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

function dayDiff(a: string, b: string): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86400000)
}

export function dayWeek(s: string, startDate = PROJECT_START): { dayNum: number; weekNum: number } {
  const diff = dayDiff(s, startDate)
  return { dayNum: diff + 1, weekNum: Math.floor(diff / 7) + 1 }
}

export function dowName(s: string): string {
  return DAY_NAMES[parseISO(s).getDay()]
}

export function formatLong(s: string): string {
  const d = parseISO(s)
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export function formatShort(s: string): string {
  const d = parseISO(s)
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`
}

export function formatTime(isoString?: string): string {
  const d = isoString ? new Date(isoString) : new Date()
  let h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${min} ${ap}`
}

export function formatEntryTitle(s: string): string {
  const d = parseISO(s)
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** MM-DD-YYYY ↔ YYYY-MM-DD */
export function isoToUrlDate(s: string): string {
  const d = parseISO(s)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}-${d.getFullYear()}`
}

export function urlDateToISO(urlDate: string): string {
  const parts = urlDate.split('-')
  if (parts.length !== 3) return todayISO()
  const [mm, dd, yyyy] = parts
  if (!/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd) || !/^\d{4}$/.test(yyyy)) return todayISO()

  const iso = `${yyyy}-${mm}-${dd}`
  return isValidISODate(iso) ? iso : todayISO()
}

export function todayUrlDate(): string {
  return isoToUrlDate(todayISO())
}
