import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { TaskItemResponseDto, CreateTaskItemDto } from '@/api/client/types.gen'
import { normalizeProjectId } from '@/lib/project-errors'
import { buildProjectOptions, type ProjectOption } from '@/lib/project-options'

export type TaskFormPayload = CreateTaskItemDto & {
  parentTaskItemId?: number | null
  /** number = project, null = "No project", undefined = not set */
  projectId?: number | null
}

export type { ProjectOption }

type ParentTaskOption = {
  id: number
  title: string
}

type TaskFormModel = TaskItemResponseDto & {
  parentTaskItemId?: number | null
}

interface Props {
  task?: TaskFormModel
  availableParents?: ParentTaskOption[]
  /** All projects (archived included); the form filters archived ones itself. Parents fetch, the form does not. */
  projects?: ProjectOption[]
  /** Preselected project for a new task. Ignored when editing or when the project is archived/unknown. */
  defaultProjectId?: number | null
  /** Marks the Project select invalid and focuses it (e.g. after a 422/404). */
  projectInvalid?: boolean
  onProjectChange?: () => void
  isSaving?: boolean
  onSubmit: (data: TaskFormPayload) => void
  onCancel: () => void
}

export function TaskForm({
  task,
  availableParents = [],
  projects = [],
  defaultProjectId,
  projectInvalid = false,
  onProjectChange,
  isSaving = false,
  onSubmit,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<string>((task?.status ?? 'draft').toLowerCase())
  const [priority, setPriority] = useState<string>((task?.priority ?? 'low').toLowerCase())
  const [dueDate, setDueDate] = useState(task?.dueDate ? task.dueDate.split('T')[0] : '')
  const [parentTaskId, setParentTaskId] = useState<string>(task?.parentTaskItemId ? String(task.parentTaskItemId) : '')

  const serverProjectId = normalizeProjectId(task?.projectId)
  const defaultActive =
    !task && defaultProjectId != null && projects.some(p => p.id === defaultProjectId && !p.isArchived)
      ? String(defaultProjectId)
      : ''
  const [projectId, setProjectId] = useState<string>(
    serverProjectId !== null ? String(serverProjectId) : defaultActive,
  )
  // When a refetch changes the task's server-side project, the selection follows it.
  // React's "adjusting state while rendering" pattern; guarded by the seen-value
  // comparison, so the re-render finds them equal and cannot loop. Other fields are untouched.
  const [seenServerProjectId, setSeenServerProjectId] = useState(serverProjectId)
  if (task && seenServerProjectId !== serverProjectId) {
    setSeenServerProjectId(serverProjectId)
    setProjectId(serverProjectId !== null ? String(serverProjectId) : '')
  }
  const projectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (projectInvalid) projectRef.current?.focus()
  }, [projectInvalid])
  const projectOptions = buildProjectOptions(task, projects, projectId ? Number(projectId) : null)
  // A selected id with no option (project deleted) is shown as, and submitted as, "No project".
  const effectiveProjectId = projectOptions.some(o => o.value === projectId) ? projectId : ''

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSaving) return
    onSubmit({
      title,
      description: description || null,
      status: status as 'draft' | 'todo' | 'completed',
      priority: priority as 'low' | 'medium' | 'high',
      // dueDate is always YYYY-MM-DD from <input type="date">; append UTC midnight to avoid timezone drift
      dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null,
      parentTaskItemId: parentTaskId ? Number(parentTaskId) : undefined,
      projectId: effectiveProjectId ? Number(effectiveProjectId) : null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="t-form">
      <div className="t-field">
        <label htmlFor="title" className="t-label">Title</label>
        <input id="title" className="t-input" value={title} onChange={e => setTitle(e.target.value)} required />
      </div>
      <div className="t-field">
        <label htmlFor="description" className="t-label">Description</label>
        <textarea
          id="description"
          className="t-input"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />
      </div>
      <div className="t-form-row">
        <div className="t-field">
          <label htmlFor="status" className="t-label">Status</label>
          <select id="status" className="t-input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="todo">Todo</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="t-field">
          <label htmlFor="priority" className="t-label">Priority</label>
          <select id="priority" className="t-input" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div className="t-field">
        <label htmlFor="dueDate" className="t-label">Due Date</label>
        <input id="dueDate" type="date" className="t-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      <div className="t-field">
        <label htmlFor="projectId" className="t-label">Project</label>
        <select
          id="projectId"
          ref={projectRef}
          className="t-input"
          value={effectiveProjectId}
          aria-invalid={projectInvalid ? 'true' : undefined}
          onChange={e => { setProjectId(e.target.value); onProjectChange?.() }}
        >
          <option value="">No project</option>
          {projectOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="t-field">
        <label htmlFor="parentTaskId" className="t-label">Parent Task</label>
        <select id="parentTaskId" className="t-input" value={parentTaskId} onChange={e => setParentTaskId(e.target.value)}>
          <option value="">None</option>
          {availableParents.map(parent => (
            <option key={parent.id} value={String(parent.id)}>{parent.title}</option>
          ))}
        </select>
      </div>
      <div className="t-form-actions">
        <button type="button" className="t-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="t-btn-primary" aria-busy={isSaving || undefined}>{isSaving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}
