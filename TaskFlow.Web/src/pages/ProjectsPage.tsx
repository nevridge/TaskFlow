import { useState } from 'react'
import type { ProjectResponseDto } from '@/api/projects'
import { ProjectForm, type ProjectFormSubmit } from '@/components/ProjectForm'
import { ProjectRow } from '@/components/ProjectRow'
import {
  useCreateProjectMutation,
  useProjectsQuery,
  useUpdateProjectMutation,
} from '@/hooks/useProjects'
import { useAreasQuery } from '@/hooks/useAreas'
import '@/projects.css'

export function ProjectsPage() {
  const { data, isLoading, isError, refetch } = useProjectsQuery()
  const areasQuery = useAreasQuery()
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
      data: {
        name: values.name,
        description: values.description,
        isArchived: project.isArchived,
        areaId: values.areaId,
      },
    })

  const handleToggleArchive = (project: ProjectResponseDto) =>
    updateMutation.mutateAsync({
      id: project.id,
      data: {
        name: project.name,
        description: project.description ?? null,
        isArchived: !project.isArchived,
        areaId: project.areaId ?? null,
      },
    })

  const areas = areasQuery.data?.data

  function renderRow(project: ProjectResponseDto) {
    return (
      <ProjectRow
        key={project.id}
        project={project}
        onSave={handleSave}
        onToggleArchive={handleToggleArchive}
        disabled={pendingProjectId === project.id}
      />
    )
  }

  // One flat list of headings, rows and empty texts: rows stay siblings, so a project that changes group
  // keeps its edit state and focus.
  function renderItems() {
    if (!areas) return visible.map(renderRow)
    const known = new Set(areas.map((a) => a.id))
    const unassigned = visible.filter((p) => p.areaId == null || !known.has(p.areaId))
    const heading = (key: string, name: string, className = 'p-group-title') => (
      <li key={key} className="p-group-heading">
        <h2 className={className}>{name}</h2>
      </li>
    )
    const grouped = areas.flatMap((area) => {
      const inArea = visible.filter((p) => p.areaId === area.id)
      const empty = (
        <li key={`area-${area.id}-empty`} className="p-empty">No projects in this area yet.</li>
      )
      return [heading(`area-${area.id}`, area.name), ...(inArea.length > 0 ? inArea.map(renderRow) : [empty])]
    })
    if (unassigned.length === 0) return grouped
    return [
      ...grouped,
      heading('area-none', 'No area', 'p-group-title p-group-title--none'),
      ...unassigned.map(renderRow),
    ]
  }

  function renderList() {
    // Only the first areas load is waited for: a later retry must not unmount open edit rows.
    if (isLoading || (areasQuery.isLoading && !areasQuery.isFetched)) {
      return <p className="p-status" role="status">Loading projects…</p>
    }
    if (isError) {
      return (
        <div>
          <p className="p-error" role="alert">Failed to load projects.</p>
          <button type="button" className="p-btn" onClick={() => refetch()}>Retry</button>
        </div>
      )
    }
    const nothingAtAll = projects.length === 0 && (areas?.length ?? 0) === 0
    return (
      <>
        {!areas && areasQuery.isError && (
          <div className="p-load-error">
            <p className="p-error" role="alert">Failed to load areas.</p>
            <button type="button" className="p-btn" onClick={() => areasQuery.refetch()}>Retry</button>
          </div>
        )}
        {nothingAtAll && <p className="p-empty">No projects yet. Create one above.</p>}
        {projects.length > 0 && visible.length === 0 && (
          <p className="p-empty">
            No active projects. Turn on "Show archived" to see {archivedCount} archived{' '}
            {archivedCount === 1 ? 'project' : 'projects'}.
          </p>
        )}
        {!nothingAtAll && <ul className="p-list">{renderItems()}</ul>}
      </>
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
