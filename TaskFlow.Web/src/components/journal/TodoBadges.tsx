// The .t-badge* styles live in tasks.css. The journal relies on tasks.css being
// bundled globally (App.tsx eagerly imports all pages), so it is not imported here.

interface TodoBadgesProps {
  priority?: string | null
  projectName?: string | null
}

const PRIORITIES = ['low', 'medium', 'high'] as const

export function TodoBadges({ priority, projectName }: TodoBadgesProps) {
  const normalized = (priority || 'low').toLowerCase()
  const p = (PRIORITIES as readonly string[]).includes(normalized) ? normalized : 'low'

  return (
    <span className="todo-badges">
      <span className={`t-badge t-badge-${p}`}>{p}</span>
      {projectName && (
        <span className="t-badge t-badge-project" title={projectName}>
          {projectName}
        </span>
      )}
    </span>
  )
}
