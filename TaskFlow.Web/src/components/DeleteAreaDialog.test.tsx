import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as areasApi from '@/api/areas'
import type { AreaResponseDto } from '@/api/areas'
import * as projectsApi from '@/api/projects'
import { DeleteAreaDialog } from './DeleteAreaDialog'

vi.mock('@/api/areas', () => ({ deleteArea: vi.fn(), getAreas: vi.fn() }))
vi.mock('@/api/projects', () => ({ getProjects: vi.fn() }))

const area = (id: number, name: string): AreaResponseDto => ({ id, name, displayOrder: id, projectCount: 2 })
const personal = area(2, 'Personal')
const all = [area(1, 'Business'), personal, area(3, 'Health')]

let server: Array<Record<string, unknown>> = []
const onCancel = vi.fn()
const onDeleted = vi.fn()

function renderDialog(areas: AreaResponseDto[] = all) {
  const user = userEvent.setup()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DeleteAreaDialog
        area={personal}
        areas={areas}
        listRef={{ current: null }}
        onCancel={onCancel}
        onDeleted={onDeleted}
      />
    </QueryClientProvider>,
  )
  return user
}

async function loadedDialog(areas?: AreaResponseDto[]) {
  const user = renderDialog(areas)
  await screen.findByText('Garden')
  return user
}

const radio = (name: string) => screen.getByRole('radio', { name })
const another = () => radio('Move them to another area')
const brandNew = () => radio('Move them to a new area')
const leave = () => radio('Leave them without an area')
const target = () => screen.getByRole('combobox', { name: 'Target area' })
const nameField = () => screen.getByRole('textbox', { name: 'New area name' })
const confirm = () => screen.getByRole('button', { name: /^Delete area/ })
const projectNames = () =>
  Array.from(screen.getByRole('dialog').querySelectorAll('.area-dialog-projects li'), li => li.textContent)

beforeEach(() => {
  vi.resetAllMocks()
  server = [
    { id: 1, name: 'Garden', areaId: 2, isArchived: false },
    { id: 2, name: 'Finances', areaId: 2, isArchived: true },
    { id: 3, name: 'Client work', areaId: 1, isArchived: false },
  ]
  vi.mocked(projectsApi.getProjects).mockImplementation(async () => ({ data: [...server] }) as never)
  vi.mocked(areasApi.deleteArea).mockResolvedValue({} as never)
})

describe('DeleteAreaDialog', () => {
  it('is a titled modal listing the area projects, archived ones badged, with nothing preselected', async () => {
    await loadedDialog()
    const dialog = screen.getByRole('dialog', { name: 'Delete the “Personal” area?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog).toHaveTextContent('2 projects will be left without an area:')
    expect(projectNames()).toEqual(['Garden', 'FinancesArchived'])
    expect(screen.getAllByRole('radio').filter(r => (r as HTMLInputElement).checked)).toEqual([])
    expect(another()).toHaveFocus()
    expect(within(target()).getAllByRole('option').map(o => o.textContent)).toEqual([
      'Choose an area',
      'Business',
      'Health',
    ])
    expect(confirm()).toBeDisabled()
  })

  it.each([
    ['another area', async (u: ReturnType<typeof userEvent.setup>) => u.selectOptions(target(), 'Health'), { moveToAreaId: 3 }, 'Delete area and move projects'],
    ['a new area', async (u: ReturnType<typeof userEvent.setup>) => u.type(nameField(), ' Home '), { newAreaName: 'Home' }, 'Delete area and move projects'],
    ['no area', async (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByText('Leave them without an area')), { noArea: true }, 'Delete area'],
  ])('sends the choice of %s', async (_label, choose, choice, label) => {
    const user = await loadedDialog()
    await choose(user)
    await user.click(screen.getByRole('button', { name: label }))
    expect(areasApi.deleteArea).toHaveBeenCalledWith(2, choice)
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
  })

  it('selects a radio by typing or clicking in its control, never by focus alone', async () => {
    const user = await loadedDialog()
    await user.click(leave())
    target().focus()
    nameField().focus()
    expect(leave()).toBeChecked()
    await user.click(nameField())
    expect(brandNew()).toBeChecked()
    await user.selectOptions(target(), 'Business')
    expect(another()).toBeChecked()
    nameField().focus()
    await user.keyboard('x')
    expect(brandNew()).toBeChecked()
  })

  it('updates the new-area hint as the name is typed and links it to its radio', async () => {
    const user = await loadedDialog()
    await user.type(nameField(), 'Home')
    expect(brandNew()).toHaveAccessibleDescription('“Home” will be created and the 2 projects moved into it.')
    expect(leave()).toHaveAccessibleDescription('They’ll show under “No area”. Their tasks aren’t changed.')
  })

  it('groups the three radios under their question', async () => {
    await loadedDialog()
    const group = screen.getByRole('group', { name: 'What should happen to them?' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
  })

  it('accepts a new area name of exactly 100 characters', async () => {
    const user = await loadedDialog()
    await user.click(nameField())
    await user.paste('a'.repeat(100))
    await user.click(confirm())
    expect(areasApi.deleteArea).toHaveBeenCalledWith(2, { newAreaName: 'a'.repeat(100) })
  })

  it('uses the singular wording for one project', async () => {
    server = [server[0]]
    const user = await loadedDialog()
    await user.type(nameField(), 'Home')
    expect(screen.getByRole('dialog')).toHaveTextContent('1 project will be left without an area:')
    expect(brandNew()).toHaveAccessibleDescription(/the 1 project moved into it/)
  })

  it('keeps confirm disabled for each incomplete or invalid choice', async () => {
    const user = await loadedDialog()
    await user.click(another())
    expect(confirm()).toBeDisabled()
    await user.click(brandNew())
    expect(confirm()).toBeDisabled()
    await user.type(nameField(), '   ')
    expect(confirm()).toBeDisabled()
    await user.clear(nameField())
    await user.click(nameField())
    await user.paste('a'.repeat(101))
    expect(confirm()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('100 characters or fewer')
  })

  it('disables "another area" when there is no other area', async () => {
    await loadedDialog([personal])
    expect(another()).toBeDisabled()
    expect(target()).toBeDisabled()
    expect(brandNew()).toHaveFocus()
  })

  it('does not allow confirming until the project list has loaded, and offers Retry', async () => {
    vi.mocked(projectsApi.getProjects).mockRejectedValueOnce({})
    const user = renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load projects.')
    await user.click(leave())
    expect(confirm()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Garden')
    expect(confirm()).toBeEnabled()
  })

  it('sends exactly one request for Enter in the name field', async () => {
    const user = await loadedDialog()
    await user.type(nameField(), 'Home{Enter}')
    expect(areasApi.deleteArea).toHaveBeenCalledExactlyOnceWith(2, { newAreaName: 'Home' })
  })

  it('never lets Enter in the name field confirm another choice, or fire while composing', async () => {
    const user = await loadedDialog()
    await user.type(nameField(), 'Home')
    await user.click(leave())
    nameField().focus()
    await user.keyboard('{Enter}')
    await user.click(nameField())
    fireEvent.keyDown(nameField(), { key: 'Enter', isComposing: true })
    expect(areasApi.deleteArea).not.toHaveBeenCalled()
  })

  it('holds the list, the focus and the dialog while the delete and its refetches run', async () => {
    let finish!: () => void
    vi.mocked(areasApi.deleteArea).mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }) as never,
    )
    const user = await loadedDialog()
    await user.click(leave())
    await user.click(confirm())
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(confirm()).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(document.querySelector('.area-dialog-backdrop')!)
    expect(onCancel).not.toHaveBeenCalled()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    // The server has moved the projects, and the refetch says so before the dialog closes.
    server = []
    await act(async () => finish())
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(projectNames()).toEqual(['Garden', 'FinancesArchived'])
    expect(dialog).toHaveTextContent('2 projects will be left without an area:')
  })

  it('stays open with the server message and focus inside when the delete fails', async () => {
    vi.mocked(areasApi.deleteArea).mockRejectedValue({ message: 'An area with that name already exists.' })
    const user = await loadedDialog()
    await user.type(nameField(), 'Business')
    await user.click(confirm())
    expect(await screen.findByRole('alert')).toHaveTextContent('An area with that name already exists.')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    expect(confirm()).toBeEnabled()
  })

  it('cancels on Escape and on the backdrop, but not on a composing Escape', async () => {
    const user = await loadedDialog()
    fireEvent.keyDown(nameField(), { key: 'Escape', isComposing: true })
    fireEvent.keyDown(nameField(), { key: 'Escape', keyCode: 229 })
    expect(onCancel).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await user.click(document.querySelector('.area-dialog-backdrop')!)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
