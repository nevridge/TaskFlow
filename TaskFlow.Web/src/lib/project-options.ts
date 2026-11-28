import { normalizeProjectId } from '@/lib/project-errors'

export type ProjectOption = {
  id: number
  name: string
  isArchived: boolean
  areaId?: number | null
}

export type ProjectOptionItem = { value: string; label: string }

export type ProjectOptionGroup = {
  key: string
  /** null = no <optgroup>. */
  label: string | null
  options: ProjectOptionItem[]
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
 * the list at all (deleted) gets no option, so callers must fall back to the task's current
 * project, or to "No project" when it has none.
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

/**
 * Groups project select options by area, in area display order with "No area" last, sorted by project
 * name inside each group. Empty groups are left out. With no areas (none, or not loaded) the options stay a
 * flat list in their existing order.
 */
export function groupProjectOptions(
  options: ProjectOptionItem[],
  projects: ProjectOption[],
  areas: ReadonlyArray<{ id: number; name: string }>,
): ProjectOptionGroup[] {
  if (areas.length === 0) return [{ key: 'flat', label: null, options }]

  const byValue = new Map(projects.map(p => [String(p.id), p]))
  const known = new Set(areas.map(a => a.id))
  const areaOf = (o: ProjectOptionItem) => {
    const areaId = byValue.get(o.value)?.areaId
    return areaId != null && known.has(areaId) ? areaId : null
  }
  const nameOf = (o: ProjectOptionItem) => byValue.get(o.value)?.name ?? o.label
  const group = (key: string, label: string, areaId: number | null): ProjectOptionGroup => ({
    key,
    label,
    options: options.filter(o => areaOf(o) === areaId).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
  })

  return [
    ...areas.map(a => group(`area-${a.id}`, a.name, a.id)),
    group('area-none', 'No area', null),
  ].filter(g => g.options.length > 0)
}
