import { Link, useLocation } from 'react-router-dom'
import { todayUrlDate } from '@/lib/journal-utils'

export function Nav() {
  const { pathname } = useLocation()
  const isJournal = pathname.startsWith('/journal')
  const isTasks = pathname.startsWith('/tasks')

  return (
    <nav className="app-nav">
      <Link
        to={`/journal/${todayUrlDate()}`}
        className={`app-nav-link${isJournal ? ' is-active' : ''}`}
      >
        Journal
      </Link>
      <Link
        to="/tasks"
        className={`app-nav-link${isTasks ? ' is-active' : ''}`}
      >
        Tasks
      </Link>
    </nav>
  )
}
