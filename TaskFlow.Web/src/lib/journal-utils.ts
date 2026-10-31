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

/** Minutes ahead of UTC for the browser's current offset (e.g. -300 for UTC-5). */
export function getTimezoneOffsetMinutes(): number {
  // `|| 0` avoids returning -0 for UTC.
  return -new Date().getTimezoneOffset() || 0
}

/**
 * The user's calendar day (YYYY-MM-DD) for an instant. Mirrors the server's UserDateHelper.GetUserDate:
 * the offset (minutes ahead of UTC, e.g. -300 for UTC-5) is ADDED to the UTC instant. Uses UTC getters
 * only, so it does not depend on the machine's own timezone.
 */
export function userDayOf(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/** Parses an API timestamp as UTC even when the server omitted the Z / offset suffix. NaN when invalid. */
export function parseApiTimestamp(s: string): number {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)
  return Date.parse(hasZone ? s : `${s}Z`)
}

interface CompletionFields {
  status?: string | null
  completedAt?: string | null
  currentJournalDate?: string | null
}

/** The user's day a task's completion is attributed to: completedAt's day, else the linked day, else null. */
export function completionDayOf(task: CompletionFields, offsetMinutes = getTimezoneOffsetMinutes()): string | null {
  if (task.completedAt) {
    const ms = parseApiTimestamp(task.completedAt)
    if (!Number.isNaN(ms)) return userDayOf(ms, offsetMinutes)
  }
  return task.currentJournalDate ?? null
}

/** Exact mirror of the server's reopen guard (#350): a Completed task whose completion day is before today. */
export function isReopenBlocked(
  task: CompletionFields,
  offsetMinutes = getTimezoneOffsetMinutes(),
  nowMs = Date.now(),
): boolean {
  if (task.status !== 'Completed') return false
  const day = completionDayOf(task, offsetMinutes)
  if (!day) return false
  return day < userDayOf(nowMs, offsetMinutes)
}

/** A Completed task with a completion time whose completion day is the viewed day. */
export function isCompletedHere(
  task: CompletionFields,
  viewedISO: string,
  offsetMinutes = getTimezoneOffsetMinutes(),
): boolean {
  if (task.status !== 'Completed' || !task.completedAt) return false
  const ms = parseApiTimestamp(task.completedAt)
  return !Number.isNaN(ms) && userDayOf(ms, offsetMinutes) === viewedISO
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

/** Local-timezone "Mon D, YYYY, h:mm AM" for a UTC ISO timestamp (e.g. a task's startedAt). */
export function formatStartedAt(isoString: string): string {
  const d = new Date(isoString)
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${formatTime(isoString)}`
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

function isWeekend(s: string): boolean {
  const day = parseISO(s).getDay()
  return day === 0 || day === 6
}

export function prevWeekday(s: string): string {
  const day = parseISO(s).getDay()
  if (day === 6) return addDays(s, -1)
  if (day === 0) return addDays(s, -2)
  return s
}

export function addWeekdays(s: string, n: number): string {
  if (n === 0) return s
  const step = n > 0 ? 1 : -1
  let d = s
  let remaining = Math.abs(n)
  while (remaining > 0) {
    d = addDays(d, step)
    if (!isWeekend(d)) remaining--
  }
  return d
}

export function dayWeekWeekdaysOnly(
  s: string,
  startDate: string,
  weekdaysOnly: boolean,
): { dayNum: number; weekNum: number } {
  if (!weekdaysOnly) return dayWeek(s, startDate)

  const normalizedStart = prevWeekday(startDate)
  let count = 0
  let cursor = normalizedStart
  while (cursor < s) {
    cursor = addDays(cursor, 1)
    if (!isWeekend(cursor)) count++
  }
  const dayNum = count + 1
  return { dayNum, weekNum: Math.floor((dayNum - 1) / 5) + 1 }
}

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Formats an ISO date string as "Jun 4" */
export function formatMonthDay(isoDate: string): string {
  const d = parseISO(isoDate)
  return SHORT_MONTH_NAMES[d.getMonth()] + ' ' + d.getDate()
}
