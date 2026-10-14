import { normalizeProjectId } from '@/lib/project-errors'

export type ProjectOption = {
  id: number
  name: string
  isArchived: boolean
}

interface CurrentProjectSource {
  projectId?: number | string | null
  projectName?: string | null
}

/**
 * Options for a task's project select (excluding the leading "No project" option).
 * Only non-archived projects are offered, plus the task's current project even when
 * it is archived (suffixed) or missing from the list (built from projectName), so the
 * current selection always stays valid and visible. The currently selected project
 * (form state) is kept the same way when it is archived; a selected id that is not in
 * the list at all (deleted) gets no option, so callers must treat it as "No project".
 */
export function buildProjectOptions(
  task: CurrentProjectSource | undefined,
  projects: ProjectOption[],
  selectedId?: number | null,
): Array<{ value: string; label: string }> {
  const currentId = normalizeProjectId(task?.projectId)
  const current = currentId !== null ? projects.find(p => p.id === currentId) : undefined
  const options: Array<{ value: string; label: string }> = []
  const pinned = new Set<number>()

  if (currentId !== null) {
    if (current?.isArchived) {
      options.push({ value: String(currentId), label: `${current.name} (archived)` })
      pinned.add(currentId)
    } else if (!current) {
      options.push({ value: String(currentId), label: task?.projectName || `Project #${currentId}` })
      pinned.add(currentId)
    }
  }

  if (selectedId != null && !pinned.has(selectedId)) {
    const selected = projects.find(p => p.id === selectedId)
    if (selected?.isArchived) {
      options.push({ value: String(selectedId), label: `${selected.name} (archived)` })
      pinned.add(selectedId)
    }
  }

  projects
    .filter(p => !p.isArchived)
    .filter(p => !pinned.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(p => options.push({ value: String(p.id), label: p.name }))
  return options
}
