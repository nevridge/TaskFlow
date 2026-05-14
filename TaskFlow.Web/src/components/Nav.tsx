import { Link, useLocation } from 'react-router-dom'
import { todayUrlDate } from '@/lib/journal-utils'

export function Nav() {
  const { pathname } = useLocation()
  const isJournal = pathname.startsWith('/journal')
  const isTasks = pathname.startsWith('/tasks')

  const base = 'px-3 py-1.5 rounded text-sm font-medium transition-colors'
  const active = 'bg-blue-600 text-white'
  const inactive = 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'

  return (
    <nav aria-label="Primary navigation" className="flex gap-1 px-4 py-2 border-b border-slate-200 bg-white">
      <Link to={`/journal/${todayUrlDate()}`} className={`${base} ${isJournal ? active : inactive}`}>
        Journal
      </Link>
      <Link to="/tasks" className={`${base} ${isTasks ? active : inactive}`}>
        Tasks
      </Link>
    </nav>
  )
}
