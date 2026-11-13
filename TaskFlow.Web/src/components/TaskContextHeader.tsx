import { Link } from 'react-router-dom'
import type { HeaderPathSegment } from '@/lib/task-sections'
import { COMPLETED_PARENT_ADD_SUBTASK_HINT } from '@/lib/parent-options'
import type { TaskOriginState } from '@/lib/task-origin'

interface Props {
  path: HeaderPathSegment[]
  parentId: number
  /** Unique per rendered header, e.g. ctx:completed:12. */
  anchor: string
  /** Label of the section the header sits in; keeps each header's button name unique. */
  sectionLabel: string
  isAdding: boolean
  onAddChild: () => void
  /** True when the parent's STORED status is Completed: Add subtask stays focusable but does nothing. */
  addSubtaskDisabled?: boolean
  /** Direct-subtask progress, e.g. "1 of 4 done · 1 in progress". Omitted when the parent has no subtasks. */
  progressLabel?: string
  /** Router state for the parent link (the Tasks page passes its origin so the detail back link returns to the filtered list). */
  linkState?: TaskOriginState
}

/** Context row above subtasks: the path to the nearest parent, a link to it and an Add subtask button. */
export function TaskContextHeader({ path, parentId, anchor, sectionLabel, isAdding, onAddChild, addSubtaskDisabled = false, progressLabel, linkState }: Props) {
  const upper = path.slice(0, -1)
  const nearest = path[path.length - 1]
  const nearestTitle = nearest?.title ?? ''
  const hintId = `add-hint-${anchor.replace(/[^A-Za-z0-9_-]/g, '-')}`
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
            <Link to={`/tasks/${parentId}`} state={linkState} className="t-context-link" data-task-header-id={parentId}>{nearestTitle}</Link>
          </span>
          {progressLabel && <span className="t-context-progress">{progressLabel}</span>}
          <button
            type="button"
            className={`t-btn-icon t-context-add${isAdding ? ' is-active' : ''} aria-disabled:opacity-50 aria-disabled:cursor-not-allowed! aria-disabled:hover:bg-transparent! aria-disabled:hover:text-(--muted)! aria-disabled:hover:border-(--line)!`}
            aria-label={`Add subtask to ${nearestTitle} in ${sectionLabel}`}
            title={addSubtaskDisabled ? COMPLETED_PARENT_ADD_SUBTASK_HINT : 'Add subtask'}
            data-add-child-anchor={anchor}
            aria-disabled={addSubtaskDisabled ? 'true' : undefined}
            aria-describedby={addSubtaskDisabled ? hintId : undefined}
            onClick={() => {
              if (addSubtaskDisabled) return
              onAddChild()
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          {addSubtaskDisabled && <span id={hintId} className="sr-only">{COMPLETED_PARENT_ADD_SUBTASK_HINT}</span>}
        </div>
      </td>
    </tr>
  )
}
