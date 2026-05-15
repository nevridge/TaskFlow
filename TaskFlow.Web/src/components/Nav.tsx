import { Link, useLocation } from 'react-router-dom'
import { todayUrlDate } from '@/lib/journal-utils'

interface NavProps {
  onMenuClick: () => void
}

export function Nav({ onMenuClick }: NavProps) {
  const { pathname } = useLocation()
  const isJournal = pathname.startsWith('/journal')
  const isTasks = pathname.startsWith('/tasks')

  return (
    <nav aria-label="Primary navigation" className="app-nav">
      <button
        className="app-nav-hamburger"
        onClick={onMenuClick}
        aria-label="Open settings"
        aria-haspopup="dialog"
      >
        <span />
        <span />
        <span />
      </button>
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
