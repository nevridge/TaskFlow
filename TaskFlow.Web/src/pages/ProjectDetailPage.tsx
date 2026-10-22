import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ProjectTaskDto } from '@/api/projects'
import { ProjectForm } from '@/components/ProjectForm'
import {
  useProjectQuery,
  useProjectTasksQuery,
  useUpdateProjectMutation,
} from '@/hooks/useProjects'
import { formatDate } from '@/lib/utils'
import { formatProjectCounts } from '@/lib/project-counts'
import { normalizeStatus, STATUS_LABELS } from '@/lib/task-status'
import '@/projects.css'

function NotFound() {
  return (
    <div className="projects-page">
      <div className="p-shell">
        <h1 className="p-title">Project</h1>
        <p className="p-error" role="alert">Project not found.</p>
        <Link className="p-back" to="/projects">Back to projects</Link>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ProjectTaskDto['status'] }) {
  // The API serializes enums as PascalCase. An unknown status renders as itself, never as "Draft".
  const known = normalizeStatus(status)
  if (known === 'Completed') return <span className="p-badge p-badge--completed">{STATUS_LABELS.Completed}</span>
  if (known === 'Blocked') return <span className="p-badge p-badge--blocked">{STATUS_LABELS.Blocked}</span>
  if (known === 'Todo') return <span className="p-badge">Todo</span>
  if (known === 'Draft') return <span className="p-badge">{STATUS_LABELS.Draft}</span>
  return <span className="p-badge">{status}</span>
}

function ProjectTasks({ id }: { id: number }) {
  const { data, isLoading, isError } = useProjectTasksQuery(id)
  const tasks = data?.data ?? []

  return (
    <section className="p-panel" aria-labelledby="project-tasks-heading">
      <h2 id="project-tasks-heading" className="p-subtitle">Tasks</h2>
      {isLoading ? (
        <p className="p-status" role="status">Loading tasks…</p>
      ) : isError ? (
        <p className="p-error" role="alert">Failed to load tasks.</p>
      ) : tasks.length === 0 ? (
        <p className="p-empty">No tasks in this project yet</p>
      ) : (
        <ul className="p-list">
          {tasks.map((task) => (
            <li key={task.id} className="p-row">
              <div className="p-row-main">
                <Link className="p-row-name" to={`/tasks/${task.id}`}>{task.title}</Link>
                <StatusBadge status={task.status} />
                {normalizeStatus(task.status) === 'Blocked' && task.blockedReason && (
                  <div className="p-task-meta" title={task.blockedReason}>Blocked: {task.blockedReason}</div>
                )}
                <div className="p-task-meta">
                  <span>Priority: {task.priority}</span>
                  {task.dueDate && <span>Due {formatDate(task.dueDate)}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ProjectDetailPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const projectQuery = useProjectQuery(id)
  const updateMutation = useUpdateProjectMutation()
  const [editing, setEditing] = useState(false)
  const editBtnRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)

  useEffect(() => {
    if (wasEditing.current && !editing) editBtnRef.current?.focus()
    wasEditing.current = editing
  }, [editing])

  // A failed background refetch keeps the cached project on screen; only an error with no data is "not found".
  if (!Number.isInteger(id) || id <= 0 || (projectQuery.isError && !projectQuery.data)) return <NotFound />
  if (projectQuery.isLoading || !projectQuery.data) {
    return (
      <div className="projects-page">
        <div className="p-shell">
          <h1 className="p-title">Project</h1>
          <p className="p-status" role="status">Loading project…</p>
        </div>
      </div>
    )
  }

  const project = projectQuery.data.data
  if (!project) return <NotFound />

  return (
    <div className="projects-page">
      <div className="p-shell">
        <Link className="p-back" to="/projects">Back to projects</Link>
        <section className="p-panel">
          {editing ? (
            <>
              <h1 className="p-title">{project.name}</h1>
              <ProjectForm
                initialName={project.name}
                initialDescription={project.description}
                submitLabel="Save"
                errorFallback="Could not save project."
                autoFocusName
                onSubmit={async (values) => {
                  await updateMutation.mutateAsync({
                    id: project.id,
                    data: {
                      name: values.name,
                      description: values.description,
                      isArchived: project.isArchived,
                    },
                  })
                  setEditing(false)
                }}
                onCancel={() => setEditing(false)}
              />
            </>
          ) : (
            <div className="p-detail-head">
              <div className="p-row-main">
                <h1 className="p-title">{project.name}</h1>
                {project.isArchived && <span className="p-badge p-badge--block">Archived</span>}
                <div className="p-counts">
                  {formatProjectCounts(project)}
                </div>
                {project.description && <p className="p-desc">{project.description}</p>}
              </div>
              <button
                ref={editBtnRef}
                type="button"
                className="p-btn"
                aria-label={`Edit ${project.name}`}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            </div>
          )}
        </section>
        <ProjectTasks id={id} />
      </div>
    </div>
  )
}
