import { Link } from 'react-router-dom'
import type { HeaderPathSegment } from '@/lib/task-sections'

interface Props {
  path: HeaderPathSegment[]
  parentId: number
  /** Unique per rendered header, e.g. ctx:completed:12. */
  anchor: string
  isAdding: boolean
  onAddChild: () => void
}

/** Context row above subtasks: the path to the nearest parent, a link to it and an Add subtask button. */
export function TaskContextHeader({ path, parentId, anchor, isAdding, onAddChild }: Props) {
  const upper = path.slice(0, -1)
  const nearest = path[path.length - 1]
  const nearestTitle = nearest?.title ?? ''
  return (
    <tr role="row" className="t-context-header">
      <td role="cell" colSpan={5}>
        <div className="t-context-inner">
          <span className="t-context-path">
            <span className="sr-only">Parent: </span>
            {upper.map(seg => (
              <span key={seg.id} className="t-context-ancestor">
                {seg.title}
                <span aria-hidden="true" className="t-context-sep">{' › '}</span>
              </span>
            ))}
            <Link to={`/tasks/${parentId}`} className="t-context-link">{nearestTitle}</Link>
          </span>
          <button
            type="button"
            className={`t-btn-icon t-context-add${isAdding ? ' is-active' : ''}`}
            aria-label={`Add subtask to ${nearestTitle}`}
            title="Add subtask"
            data-add-child-anchor={anchor}
            onClick={onAddChild}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
      </td>
    </tr>
  )
}
