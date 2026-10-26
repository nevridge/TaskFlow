import type { Ref } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { todayUrlDate } from '@/lib/journal-utils'

interface NavProps {
  onMenuClick: () => void
  /** Lets Layout return focus to the hamburger when the settings drawer closes. */
  hamburgerRef?: Ref<HTMLButtonElement>
}

export function Nav({ onMenuClick, hamburgerRef }: NavProps) {
  const { pathname } = useLocation()
  const isJournal = pathname.startsWith('/journal')
  const isTasks = pathname.startsWith('/tasks')
  const isProjects = pathname.startsWith('/projects')

  return (
    <nav aria-label="Primary navigation" className="app-nav">
      <button
        ref={hamburgerRef}
        className="app-nav-hamburger tap-target"
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
        className={`app-nav-link tap-target${isJournal ? ' is-active' : ''}`}
      >
        Journal
      </Link>
      <Link
        to="/tasks"
        className={`app-nav-link tap-target${isTasks ? ' is-active' : ''}`}
      >
        Tasks
      </Link>
      <Link
        to="/projects"
        className={`app-nav-link tap-target${isProjects ? ' is-active' : ''}`}
      >
        Projects
      </Link>
    </nav>
  )
}
