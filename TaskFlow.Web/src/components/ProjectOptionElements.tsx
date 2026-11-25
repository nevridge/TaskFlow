import type { ProjectOptionGroup, ProjectOptionItem } from '@/lib/project-options'

const toOption = (o: ProjectOptionItem) => (
  <option key={o.value} value={o.value}>{o.label}</option>
)

/** Native options for a project select, wrapped in an <optgroup> per area when grouped. */
export function ProjectOptionElements({ groups }: { groups: ProjectOptionGroup[] }) {
  return groups.map(g =>
    g.label === null ? (
      g.options.map(toOption)
    ) : (
      <optgroup key={g.key} label={g.label}>{g.options.map(toOption)}</optgroup>
    ),
  )
}
