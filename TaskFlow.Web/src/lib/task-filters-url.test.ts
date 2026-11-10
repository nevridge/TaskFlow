import { describe, it, expect } from 'vitest'
import { buildTaskFiltersSearch, parseTaskFilters, type TaskFilters } from './task-filters-url'
import type { RequestStatus } from './task-status'

const ALL: RequestStatus[] = ['draft', 'todo', 'inProgress', 'blocked', 'completed']
const parse = (qs: string) => parseTaskFilters(new URLSearchParams(qs))
const filters = (over: Partial<TaskFilters> = {}): TaskFilters => ({
  search: '',
  statuses: new Set(ALL),
  view: 'all',
  project: 'all',
  ...over,
})

describe('parseTaskFilters', () => {
  it('returns the defaults for no params', () => {
    expect(parse('')).toEqual(filters())
  })

  it('reads every filter', () => {
    const parsed = parse('q=foo&status=todo&status=inProgress&view=activeToday&project=12')
    expect(parsed).toEqual(filters({ search: 'foo', statuses: new Set(['todo', 'inProgress']), view: 'activeToday', project: 12 }))
  })

  it('keeps the search text untrimmed', () => {
    expect(parse('q=%20a%20').search).toBe(' a ')
  })

  it('reads project=none', () => {
    expect(parse('project=none').project).toBe('none')
  })

  it('status=none alone is the empty set', () => {
    expect(parse('status=none').statuses.size).toBe(0)
  })

  it('de-duplicates repeated statuses', () => {
    expect([...parse('status=todo&status=todo').statuses]).toEqual(['todo'])
  })

  it.each([
    ['unknown view', 'view=nope'],
    ['repeated view', 'view=all&view=activeToday'],
  ])('falls back for %s without touching the others', (_n, qs) => {
    expect(parse(`${qs}&q=x`)).toEqual(filters({ search: 'x' }))
  })

  it.each(['project=abc', 'project=0', 'project=-1', 'project=01', 'project=1.5', 'project=1&project=2', 'project='])(
    'falls back to all projects for %s',
    qs => expect(parse(`${qs}&view=activeToday`)).toEqual(filters({ view: 'activeToday' })),
  )

  it('a repeated q is empty', () => {
    expect(parse('q=a&q=b&view=activeToday')).toEqual(filters({ view: 'activeToday' }))
  })

  it.each(['status=none&status=todo', 'status=todo&status=bogus', 'status=Todo', 'status='])(
    'falls back to all five statuses for %s',
    qs => expect(parse(qs).statuses).toEqual(new Set(ALL)),
  )
})

describe('buildTaskFiltersSearch', () => {
  it('is empty when everything is default', () => {
    expect(buildTaskFiltersSearch(filters())).toBe('')
  })

  it('round trips every filter', () => {
    const f = filters({ search: 'foo bar', statuses: new Set(['blocked', 'draft']), view: 'completedHistory', project: 'none' })
    expect(parse(buildTaskFiltersSearch(f))).toEqual(f)
  })

  it('writes statuses in display order', () => {
    expect(buildTaskFiltersSearch(filters({ statuses: new Set(['completed', 'draft']) }))).toBe('?status=draft&status=completed')
  })

  it('writes status=none for the empty set and parses it back to zero checked', () => {
    const search = buildTaskFiltersSearch(filters({ statuses: new Set() }))
    expect(search).toBe('?status=none')
    expect(parse(search).statuses.size).toBe(0)
  })

  it('does not trim the search, and omits q only when it is empty', () => {
    expect(buildTaskFiltersSearch(filters({ search: ' a ' }))).toBe('?q=+a+')
    expect(parse(buildTaskFiltersSearch(filters({ search: ' a ' }))).search).toBe(' a ')
    expect(buildTaskFiltersSearch(filters({ search: ' ' }))).not.toBe('')
  })

  it('escapes # and & so the text survives the round trip', () => {
    const search = buildTaskFiltersSearch(filters({ search: 'a#b&c=d' }))
    expect(search).toContain('%23')
    expect(search).toContain('%26')
    expect(search).not.toContain('#')
    expect(parse(search).search).toBe('a#b&c=d')
  })
})
