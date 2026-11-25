import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ProjectsPage } from './ProjectsPage'
import type { ProjectResponseDto } from '@/api/projects'

vi.mock('@/hooks/useAreas', () => ({
  useAreasQuery: vi.fn(),
  useCreateAreaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useProjects', () => ({
  useProjectsQuery: vi.fn(),
  useCreateProjectMutation: vi.fn(),
  useUpdateProjectMutation: vi.fn(),
}))

import { useProjectsQuery, useCreateProjectMutation, useUpdateProjectMutation } from '@/hooks/useProjects'
import { useAreasQuery } from '@/hooks/useAreas'

const make = (over: Partial<ProjectResponseDto>): ProjectResponseDto => ({
  id: 1,
  name: 'Alpha',
  description: 'Alpha desc',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  openTaskCount: 3,
  completedTaskCount: 4,
  ...over,
})

const alpha = make({ areaId: 5, areaName: 'Work' })
const beta = make({ id: 2, name: 'Beta', description: null, isArchived: true, openTaskCount: 0, completedTaskCount: 1, areaId: 6, areaName: 'Home' })

const WORK = { id: 5, name: 'Work', displayOrder: 0, projectCount: 1 }
const HOME = { id: 6, name: 'Home', displayOrder: 1, projectCount: 1 }

function mockAreas(state: Record<string, unknown>) {
  vi.mocked(useAreasQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetched: true,
    isError: false,
    refetch: refetchAreas,
    ...state,
  } as never)
}

const refetchAreas = vi.fn()
const createAsync = vi.fn()
const updateAsync = vi.fn()
const refetch = vi.fn()

function mockQuery(state: Record<string, unknown>) {
  vi.mocked(useProjectsQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch,
    ...state,
  } as never)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  )
}

/** The list item holding the open edit form. */
const editRow = () => screen.getAllByRole('listitem').find((li) => li.querySelector('form'))!

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAsync.mockResolvedValue({})
    updateAsync.mockResolvedValue({})
    vi.mocked(useCreateProjectMutation).mockReturnValue({ mutateAsync: createAsync, isPending: false } as never)
    vi.mocked(useUpdateProjectMutation).mockReturnValue({ mutateAsync: updateAsync, isPending: false } as never)
    mockQuery({ data: { data: [alpha, beta] } })
    mockAreas({ data: { data: [WORK, HOME] } })
  })

  it('lists active projects with name, open and completed counts', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/projects/1')
    expect(screen.getByText('3 open · 4 completed')).toBeInTheDocument()
  })

  it('hides archived by default and shows them when toggled', async () => {
    const user = userEvent.setup()
    renderPage()
    const toggle = screen.getByLabelText('Show archived')
    expect(toggle).not.toBeChecked()
    expect(screen.queryByRole('link', { name: 'Beta' })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive Beta' })).toBeInTheDocument()
  })

  it('writes nothing to localStorage', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderPage()
    await user.click(screen.getByLabelText('Show archived'))
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('shows loading state', () => {
    mockQuery({ isLoading: true })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading projects')
  })

  it('shows error state with retry', async () => {
    const user = userEvent.setup()
    mockQuery({ isError: true })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load projects.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows the no projects empty state', () => {
    mockAreas({ data: { data: [] } })
    mockQuery({ data: { data: [] } })
    renderPage()
    expect(screen.getByText('No projects yet. Create one above.')).toBeInTheDocument()
  })

  it('shows archived hint when only archived exist and the toggle is off', () => {
    mockQuery({ data: { data: [beta] } })
    renderPage()
    expect(screen.getByText(/No active projects/)).toHaveTextContent('see 1 archived project.')
  })

  it('handles an undefined payload as empty', () => {
    mockAreas({ data: { data: [] } })
    mockQuery({ data: undefined })
    renderPage()
    expect(screen.getByText('No projects yet. Create one above.')).toBeInTheDocument()
  })

  it('creates a project with name and description and clears the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Gamma')
    await user.type(screen.getByLabelText('Description'), 'G desc')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(createAsync).toHaveBeenCalledWith({ name: 'Gamma', description: 'G desc', areaId: null })
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('sends an empty description as null', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Gamma')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(createAsync).toHaveBeenCalledWith({ name: 'Gamma', description: null, areaId: null })
  })

  it('does not call the API for an invalid name', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(createAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.')
  })

  it('create 409 shows the API message, keeps input and adds no row', async () => {
    const user = userEvent.setup()
    createAsync.mockRejectedValue({ message: 'A project with that name already exists.' })
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Alpha')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A project with that name already exists.')
    expect(screen.getByLabelText('Name')).toHaveValue('Alpha')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('rename sends name, description, isArchived and the current area', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    const row = editRow()
    const name = within(row).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Alpha 2')
    await user.click(within(row).getByRole('button', { name: 'Save' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 1,
      data: { name: 'Alpha 2', description: 'Alpha desc', isArchived: false, areaId: 5 },
    })
  })

  it('edit description sends every field, clearing to null', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.clear(within(editRow()).getByLabelText('Description'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 1,
      data: { name: 'Alpha', description: null, isArchived: false, areaId: 5 },
    })
  })

  it('rename 409 shows the API message and keeps the form open', async () => {
    const user = userEvent.setup()
    updateAsync.mockRejectedValue({ message: 'Name taken' })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name taken')
    expect(within(editRow()).getByLabelText('Name')).toHaveValue('Alpha')
  })

  it('archive sends isArchived true with current name and description', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Archive Alpha' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 1,
      data: { name: 'Alpha', description: 'Alpha desc', isArchived: true, areaId: 5 },
    })
  })

  it('unarchive sends isArchived false', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByLabelText('Show archived'))
    await user.click(screen.getByRole('button', { name: 'Unarchive Beta' }))
    expect(updateAsync).toHaveBeenCalledWith({
      id: 2,
      data: { name: 'Beta', description: null, isArchived: false, areaId: 6 },
    })
  })

  it('save and archive send a null area for a project without one', async () => {
    const user = userEvent.setup()
    mockQuery({ data: { data: [make({})] } })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Archive Alpha' }))
    expect(updateAsync).toHaveBeenLastCalledWith({
      id: 1,
      data: { name: 'Alpha', description: 'Alpha desc', isArchived: true, areaId: null },
    })
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateAsync).toHaveBeenLastCalledWith({
      id: 1,
      data: { name: 'Alpha', description: 'Alpha desc', isArchived: false, areaId: null },
    })
  })

  it('disables Create while the create mutation is in flight', async () => {
    const user = userEvent.setup()
    let resolve: (v: unknown) => void = () => {}
    createAsync.mockReturnValue(new Promise((r) => { resolve = r }))
    renderPage()
    await user.type(screen.getByLabelText('Name'), 'Gamma')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled()
    resolve({})
  })

  it('disables Save while a list-page edit is in flight', async () => {
    const user = userEvent.setup()
    let resolve: (v: unknown) => void = () => {}
    updateAsync.mockReturnValue(new Promise((r) => { resolve = r }))
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    resolve({})
  })

  it('returns focus to the Edit button after a successful save', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Edit Alpha' })).toHaveFocus()
  })

  it('disables only the row whose update is pending', () => {
    mockQuery({ data: { data: [alpha, make({ id: 3, name: 'Gamma' })] } })
    vi.mocked(useUpdateProjectMutation).mockReturnValue({
      mutateAsync: updateAsync,
      isPending: true,
      variables: { id: 1 },
    } as never)
    renderPage()
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Archive Alpha' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit Gamma' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive Gamma' })).toBeEnabled()
  })

  it('renders a long name in a wrapping link', () => {
    const long = 'x'.repeat(100)
    mockQuery({ data: { data: [make({ name: long })] } })
    renderPage()
    expect(screen.getByRole('link', { name: long })).toHaveClass('p-row-name')
  })

  describe('grouping by area', () => {
    const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const listText = () => screen.getAllByRole('listitem').map((li) => li.querySelector('h2, a')?.textContent ?? li.textContent)

    it('lists areas in display order with empty text, then "No area" last', () => {
      mockAreas({ data: { data: [HOME, WORK] } })
      mockQuery({
        data: {
          data: [alpha, make({ id: 3, name: 'Loose' }), make({ id: 4, name: 'Orphan', areaId: 99 })],
        },
      })
      renderPage()
      expect(headings()).toEqual(['New project', 'Home', 'Work', 'No area'])
      expect(listText()).toEqual(['Home', 'No projects in this area yet.', 'Work', 'Alpha', 'No area', 'Loose', 'Orphan'])
    })

    it('has no area-management controls', () => {
      renderPage()
      expect(screen.queryByRole('button', { name: /^(Rename|Delete|Reorder) |add area/i })).not.toBeInTheDocument()
    })

    it('shows only "No area" when there are no areas', () => {
      mockAreas({ data: { data: [] } })
      renderPage()
      expect(headings()).toEqual(['New project', 'No area'])
    })

    it('applies "Show archived" inside each group and hides "No area" without visible projects', async () => {
      const user = userEvent.setup()
      mockQuery({ data: { data: [alpha, beta, make({ id: 3, name: 'Old', isArchived: true })] } })
      renderPage()
      expect(listText()).toEqual(['Work', 'Alpha', 'Home', 'No projects in this area yet.'])
      await user.click(screen.getByLabelText('Show archived'))
      expect(listText()).toEqual(['Work', 'Alpha', 'Home', 'Beta', 'No area', 'Old'])
    })

    it('shows the archived hint above the groups when every project is archived', () => {
      mockQuery({ data: { data: [beta] } })
      renderPage()
      const hint = screen.getByText(/No active projects/)
      const work = screen.getByRole('heading', { name: 'Work' })
      expect(hint.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('lists areas rather than "No projects yet" when there are areas but no projects', () => {
      mockQuery({ data: { data: [] } })
      renderPage()
      expect(screen.queryByText(/No projects yet\. Create one above/)).not.toBeInTheDocument()
      expect(screen.getAllByText('No projects in this area yet.')).toHaveLength(2)
    })

    it('waits for the first areas load before listing, so rows do not jump into groups', () => {
      mockAreas({ isLoading: true, isFetched: false })
      renderPage()
      expect(screen.getByRole('status')).toHaveTextContent('Loading projects')
      expect(screen.queryByRole('link', { name: 'Alpha' })).not.toBeInTheDocument()
    })

    it('falls back to a flat list with Retry when areas fail with no data', async () => {
      const user = userEvent.setup()
      mockAreas({ isError: true })
      renderPage()
      // The create form reports the same failure for its own select; this is the list's message.
      const listError = document.querySelector<HTMLElement>('.p-load-error')!
      expect(within(listError).getByRole('alert')).toHaveTextContent('Failed to load areas.')
      expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'No area' })).not.toBeInTheDocument()
      await user.click(within(listError).getByRole('button', { name: 'Retry' }))
      expect(refetchAreas).toHaveBeenCalledOnce()
    })

    it('keeps the grouping and the open edit form when a background areas refetch fails', async () => {
      const user = userEvent.setup()
      const view = renderPage()
      await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await user.type(within(editRow()).getByLabelText('Name'), ' typed')
      mockAreas({ data: { data: [WORK, HOME] }, isError: true })
      view.rerender(
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>,
      )
      expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument()
      expect(screen.queryByText('Failed to load areas.')).not.toBeInTheDocument()
      expect(within(editRow()).getByLabelText('Name')).toHaveValue('Alpha typed')
    })

    it('keeps an edit form open when its project changes group', async () => {
      const user = userEvent.setup()
      const view = renderPage()
      await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await user.type(within(editRow()).getByLabelText('Name'), ' typed')
      mockQuery({ data: { data: [{ ...alpha, areaId: 6 }, beta] } })
      view.rerender(
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>,
      )
      expect(listText().slice(0, 2)).toEqual(['Work', 'No projects in this area yet.'])
      expect(within(editRow()).getByLabelText('Name')).toHaveValue('Alpha typed')
    })

    // The refetch moves the row after the form has closed, which drops focus without the second restore.
    it('keeps focus on the Edit button, in view, after a save moves the project to another group', async () => {
      const user = userEvent.setup()
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const view = renderPage()
      await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await user.selectOptions(within(editRow()).getByLabelText('Area'), 'Home')
      await user.click(within(editRow()).getByRole('button', { name: 'Save' }))
      expect(updateAsync).toHaveBeenCalledWith({
        id: 1,
        data: { name: 'Alpha', description: 'Alpha desc', isArchived: false, areaId: 6 },
      })
      scrollIntoView.mockClear()
      ;(document.activeElement as HTMLElement).blur()
      mockQuery({ data: { data: [{ ...alpha, areaId: 6 }, beta] } })
      view.rerender(
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>,
      )
      expect(screen.getByRole('button', { name: 'Edit Alpha' })).toHaveFocus()
      expect(scrollIntoView).toHaveBeenCalled()
      delete (Element.prototype as Partial<Element>).scrollIntoView
    })
  })
})
