import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectResponseDto } from '@/api/projects'
import { getApiErrorMessage } from '@/lib/api-error'
import { formatProjectCounts } from '@/lib/project-counts'
import { ProjectForm, type ProjectFormSubmit } from '@/components/ProjectForm'

interface ProjectRowProps {
  project: ProjectResponseDto
  /** Full-replace save of name/description; should reject on failure. */
  onSave: (project: ProjectResponseDto, values: ProjectFormSubmit) => Promise<unknown>
  /** Flips isArchived; should reject on failure. */
  onToggleArchive: (project: ProjectResponseDto) => Promise<unknown>
  disabled?: boolean
}

export function ProjectRow({ project, onSave, onToggleArchive, disabled = false }: ProjectRowProps) {
  const [editing, setEditing] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const editBtnRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  /** Set by a save that changes the area, until the row has moved to its new group. */
  const movingFromRef = useRef<{ areaId: number | null } | null>(null)

  useEffect(() => {
    if (wasEditing.current && !editing) editBtnRef.current?.focus()
    wasEditing.current = editing
  }, [editing])

  // The effect above can run before the refetch moves the row, and moving it drops focus.
  const areaId = project.areaId ?? null
  useEffect(() => {
    const moving = movingFromRef.current
    const button = editBtnRef.current
    if (!moving || editing || disabled || !button) return
    // Leave focus alone if the user has already put it somewhere else.
    if (document.activeElement === document.body || document.activeElement === button) {
      button.focus()
      button.closest('li')?.scrollIntoView?.({ block: 'nearest' })
    }
    if (moving.areaId !== areaId) movingFromRef.current = null
  }, [areaId, editing, disabled])

  if (editing) {
    return (
      <li className="p-row">
        <div className="p-row-main">
          <ProjectForm
            initialName={project.name}
            initialDescription={project.description}
            initialAreaId={project.areaId ?? null}
            initialAreaName={project.areaName}
            submitLabel="Save"
            errorFallback="Could not save project."
            autoFocusName
            onSubmit={async (values) => {
              await onSave(project, values)
              if (values.areaId !== (project.areaId ?? null)) {
                movingFromRef.current = { areaId: project.areaId ?? null }
              }
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </li>
    )
  }

  async function handleArchive() {
    setArchiveError(null)
    try {
      await onToggleArchive(project)
    } catch (err) {
      setArchiveError(getApiErrorMessage(err, 'Could not update project.'))
    }
  }

  return (
    <li className="p-row">
      <div className="p-row-main">
        <Link className="p-row-name" to={`/projects/${project.id}`}>{project.name}</Link>
        {project.isArchived && <span className="p-badge">Archived</span>}
        <div className="p-counts">
          {formatProjectCounts(project)}
        </div>
        {project.description && <p className="p-desc p-desc--clamp">{project.description}</p>}
        {archiveError && <p className="p-error" role="alert">{archiveError}</p>}
      </div>
      <div className="p-row-actions">
        <button
          ref={editBtnRef}
          type="button"
          className="p-btn"
          aria-label={`Edit ${project.name}`}
          disabled={disabled}
          onClick={() => {
            movingFromRef.current = null
            setEditing(true)
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="p-btn"
          aria-label={`${project.isArchived ? 'Unarchive' : 'Archive'} ${project.name}`}
          disabled={disabled}
          onClick={handleArchive}
        >
          {project.isArchived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
    </li>
  )
}
