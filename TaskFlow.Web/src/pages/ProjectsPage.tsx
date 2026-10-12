import { useState } from 'react'
import type { ProjectResponseDto } from '@/api/projects'
import { ProjectForm, type ProjectFormSubmit } from '@/components/ProjectForm'
import { ProjectRow } from '@/components/ProjectRow'
import {
  useCreateProjectMutation,
  useProjectsQuery,
  useUpdateProjectMutation,
} from '@/hooks/useProjects'
import '@/projects.css'

export function ProjectsPage() {
  const { data, isLoading, isError, refetch } = useProjectsQuery()
  const createMutation = useCreateProjectMutation()
  const updateMutation = useUpdateProjectMutation()
  const [showArchived, setShowArchived] = useState(false)
  // Only the row being saved is locked; concurrent PUTs to the same project would race.
  const pendingProjectId = updateMutation.isPending ? updateMutation.variables?.id : undefined

  const projects: ProjectResponseDto[] = data?.data ?? []
  const visible = showArchived ? projects : projects.filter((p) => !p.isArchived)
  const archivedCount = projects.length - projects.filter((p) => !p.isArchived).length

  const handleSave = (project: ProjectResponseDto, values: ProjectFormSubmit) =>
    updateMutation.mutateAsync({
      id: project.id,
      data: { name: values.name, description: values.description, isArchived: project.isArchived },
    })

  const handleToggleArchive = (project: ProjectResponseDto) =>
    updateMutation.mutateAsync({
      id: project.id,
      data: {
        name: project.name,
        description: project.description ?? null,
        isArchived: !project.isArchived,
      },
    })

  function renderList() {
    if (isLoading) return <p className="p-status" role="status">Loading projects…</p>
    if (isError) {
      return (
        <div>
          <p className="p-error" role="alert">Failed to load projects.</p>
          <button type="button" className="p-btn" onClick={() => refetch()}>Retry</button>
        </div>
      )
    }
    if (projects.length === 0) {
      return <p className="p-empty">No projects yet. Create one above.</p>
    }
    if (visible.length === 0) {
      return (
        <p className="p-empty">
          No active projects. Turn on "Show archived" to see {archivedCount} archived{' '}
          {archivedCount === 1 ? 'project' : 'projects'}.
        </p>
      )
    }
    return (
      <ul className="p-list">
        {visible.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            onSave={handleSave}
            onToggleArchive={handleToggleArchive}
            disabled={pendingProjectId === project.id}
          />
        ))}
      </ul>
    )
  }

  return (
    <div className="projects-page">
      <div className="p-shell">
        <h1 className="p-title">Projects</h1>

        <section className="p-panel" aria-labelledby="new-project-heading">
          <h2 id="new-project-heading" className="p-subtitle">New project</h2>
          <ProjectForm
            submitLabel="Create project"
            errorFallback="Could not create project."
            resetOnSuccess
            onSubmit={(values) => createMutation.mutateAsync(values)}
          />
        </section>

        <div className="p-toolbar">
          <label className="p-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>

        {renderList()}
      </div>
    </div>
  )
}
