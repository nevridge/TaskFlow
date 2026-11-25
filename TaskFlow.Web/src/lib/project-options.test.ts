import { describe, it, expect } from 'vitest'
import { buildProjectOptions, groupProjectOptions, type ProjectOption } from './project-options'

const areas = [
  { id: 20, name: 'Personal' },
  { id: 10, name: 'Business' },
  { id: 30, name: 'Empty' },
]

const projects: ProjectOption[] = [
  { id: 1, name: 'Zulu', isArchived: false, areaId: 20 },
  { id: 2, name: 'Alpha', isArchived: false, areaId: 20 },
  { id: 3, name: 'Mike', isArchived: true, areaId: 20 },
  { id: 4, name: 'Client', isArchived: false, areaId: 10 },
  { id: 5, name: 'Loose', isArchived: false, areaId: null },
  { id: 6, name: 'Orphan', isArchived: false, areaId: 99 },
]

const shape = (groups: ReturnType<typeof groupProjectOptions>) =>
  groups.map(g => [g.label, g.options.map(o => o.label)])

describe('groupProjectOptions', () => {
  it('follows area display order, sorts by name inside a group, omits empty groups and puts "No area" last', () => {
    const options = buildProjectOptions({ projectId: 3 }, projects)
    expect(shape(groupProjectOptions(options, projects, areas))).toEqual([
      ['Personal', ['Alpha', 'Mike (archived)', 'Zulu']],
      ['Business', ['Client']],
      ['No area', ['Loose', 'Orphan']],
    ])
  })

  it('puts a current project that is missing from the list under "No area"', () => {
    const options = buildProjectOptions({ projectId: 50, projectName: 'Gone' }, [projects[3]])
    expect(shape(groupProjectOptions(options, [projects[3]], areas))).toEqual([
      ['Business', ['Client']],
      ['No area', ['Gone']],
    ])
  })

  it('stays flat and in the existing order without areas', () => {
    const options = buildProjectOptions({ projectId: 3 }, projects)
    expect(shape(groupProjectOptions(options, projects, []))).toEqual([[null, options.map(o => o.label)]])
  })
})
