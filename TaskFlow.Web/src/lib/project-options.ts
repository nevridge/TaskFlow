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
 * current selection always stays valid and visible.
 */
export function buildProjectOptions(
  task: CurrentProjectSource | undefined,
  projects: ProjectOption[],
): Array<{ value: string; label: string }> {
  const currentId = normalizeProjectId(task?.projectId)
  const current = currentId !== null ? projects.find(p => p.id === currentId) : undefined
  const options: Array<{ value: string; label: string }> = []

  let currentFirst = false
  if (currentId !== null) {
    if (current?.isArchived) {
      options.push({ value: String(currentId), label: `${current.name} (archived)` })
      currentFirst = true
    } else if (!current) {
      options.push({ value: String(currentId), label: task?.projectName || `Project #${currentId}` })
      currentFirst = true
    }
  }

  projects
    .filter(p => !p.isArchived)
    .filter(p => !(currentFirst && p.id === currentId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(p => options.push({ value: String(p.id), label: p.name }))
  return options
}
