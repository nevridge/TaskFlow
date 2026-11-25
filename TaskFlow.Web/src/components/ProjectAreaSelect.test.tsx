import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as areasApi from '@/api/areas'
import type { AreaResponseDto } from '@/api/areas'
import { ProjectForm } from './ProjectForm'

vi.mock('@/api/areas', () => ({ getAreas: vi.fn(), createArea: vi.fn() }))

// Tested through ProjectForm with the real area hooks: what matters is what the form submits.

const area = (id: number, name: string): AreaResponseDto => ({ id, name, displayOrder: id, projectCount: 0 })
let server: AreaResponseDto[] = []
const onSubmit = vi.fn()

function renderForm(props: Partial<React.ComponentProps<typeof ProjectForm>> = {}) {
  const user = userEvent.setup()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProjectForm submitLabel="Save" errorFallback="Could not save project." onSubmit={onSubmit} {...props} />
    </QueryClientProvider>,
  )
  return user
}

const select = () => screen.getByRole('combobox', { name: 'Area' })
const options = () => within(select()).getAllByRole('option').map(o => o.textContent)
const field = () => screen.getByRole('textbox', { name: 'New area name' })
const queryField = () => screen.queryByRole('textbox', { name: 'New area name' })
const nameInput = () => screen.getByRole('textbox', { name: 'Name' })
const save = () => screen.getByRole('button', { name: 'Save' })
const submitted = () => onSubmit.mock.lastCall?.[0].areaId

async function loaded(props?: Parameters<typeof renderForm>[0]) {
  const user = renderForm(props)
  await screen.findByRole('option', { name: 'Work' })
  return user
}

beforeEach(() => {
  vi.resetAllMocks()
  server = [area(2, 'Work'), area(1, 'Home')]
  onSubmit.mockResolvedValue(undefined)
  vi.mocked(areasApi.getAreas).mockImplementation(async () => ({ data: [...server] }) as never)
  vi.mocked(areasApi.createArea).mockImplementation(async name => {
    server = [...server, area(3, name)]
    return { data: area(3, name) } as never
  })
})

describe('project form Area select', () => {
  it('offers "No area", areas in display order and "+ New area…" last, defaulting to "No area"', async () => {
    const user = await loaded()
    expect(options()).toEqual(['No area', 'Work', 'Home', '+ New area…'])
    expect(select()).toHaveDisplayValue('No area')
    await user.type(nameInput(), 'P')
    await user.click(save())
    expect(submitted()).toBeNull()
  })

  it('preselects the current area and submits a changed choice', async () => {
    const user = await loaded({ initialName: 'P', initialAreaId: 2 })
    expect(select()).toHaveDisplayValue('Work')
    await user.selectOptions(select(), 'Home')
    await user.click(save())
    expect(submitted()).toBe(1)
  })

  it('shows and submits "No area" when the current area was deleted', async () => {
    const user = await loaded({ initialName: 'P', initialAreaId: 99, initialAreaName: 'Gone' })
    expect(select()).toHaveDisplayValue('No area')
    await user.click(save())
    expect(submitted()).toBeNull()
  })

  // A failed load must not silently clear the project's area on save.
  it('keeps the current area while areas cannot be loaded, with Retry', async () => {
    vi.mocked(areasApi.getAreas).mockRejectedValueOnce({})
    const user = renderForm({ initialName: 'P', initialAreaId: 2, initialAreaName: 'Work' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load areas.')
    expect(select()).toHaveDisplayValue('Work')
    await user.click(save())
    expect(submitted()).toBe(2)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('option', { name: 'Home' })).toBeInTheDocument()
  })

  it('"Area not found." on save reaches the form', async () => {
    onSubmit.mockRejectedValue({ message: 'Area not found.' })
    const user = await loaded({ initialName: 'P', initialAreaId: 2 })
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent('Area not found.')
  })
})

describe('"+ New area…"', () => {
  async function openField(props?: Parameters<typeof renderForm>[0]) {
    const user = await loaded(props)
    await user.selectOptions(select(), '+ New area…')
    return user
  }

  it('reveals a focused field while the select keeps its previous value', async () => {
    await openField({ initialAreaId: 1 })
    expect(field()).toHaveFocus()
    expect(select()).toHaveDisplayValue('Home')
  })

  it('Add creates the area, selects it and returns focus to the select', async () => {
    const user = await openField({ initialName: 'P' })
    await user.type(field(), '  Garden ')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(areasApi.createArea).toHaveBeenCalledWith('Garden')
    await waitFor(() => expect(select()).toHaveDisplayValue('Garden'))
    expect(queryField()).not.toBeInTheDocument()
    expect(select()).toHaveFocus()
    await user.click(save())
    expect(submitted()).toBe(3)
  })

  it('Cancel restores the previous selection', async () => {
    const user = await openField({ initialAreaId: 1 })
    await user.type(field(), 'Garden')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(queryField()).not.toBeInTheDocument()
    expect(select()).toHaveDisplayValue('Home')
    expect(select()).toHaveFocus()
  })

  it('keeps the field open, focused and described when Add is rejected', async () => {
    vi.mocked(areasApi.createArea).mockRejectedValue({ message: 'An area with that name already exists.' })
    const user = await openField()
    await user.type(field(), 'work')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('An area with that name already exists.')
    expect(field()).toHaveValue('work')
    expect(document.activeElement).toBe(field())
    expect(field()).toHaveAccessibleDescription('An area with that name already exists.')
  })

  it('Enter adds and never submits the project form, including while pending or composing', async () => {
    vi.mocked(areasApi.createArea).mockReturnValue(new Promise(() => {}) as never)
    const user = await openField({ initialName: 'P' })
    await user.type(field(), 'Garden')
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true })
    expect(areasApi.createArea).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    expect(areasApi.createArea).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(field()).toHaveFocus()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not select an area whose Add resolves after Cancel', async () => {
    let finish!: () => void
    vi.mocked(areasApi.createArea).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = () => resolve({ data: area(3, 'Garden') } as never)
        }) as never,
    )
    const user = await openField()
    await user.type(field(), 'Garden{Enter}')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => finish())
    expect(select()).toHaveDisplayValue('No area')
  })

  it.each(['New area name', 'Add', 'Cancel', 'Area'])('Escape on "%s" closes the group', async label => {
    const user = await openField()
    const control =
      label === 'Add' || label === 'Cancel' ? screen.getByRole('button', { name: label }) : screen.getByLabelText(label)
    control.focus()
    fireEvent.keyDown(control, { key: 'Escape', isComposing: true })
    expect(field()).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(queryField()).not.toBeInTheDocument()
    expect(select()).toHaveFocus()
  })

  // On Windows each arrow step on a closed select fires change; stealing focus would trap the user.
  it.each(['ArrowDown', 'End', 'PageDown'])('leaves focus on the select when stepped onto with %s', async key => {
    await loaded()
    select().focus()
    fireEvent.keyDown(select(), { key })
    fireEvent.change(select(), { target: { value: '__new' } })
    expect(field()).toBeInTheDocument()
    expect(select()).toHaveFocus()
  })

  it.each([
    ['the Save button', async (u: ReturnType<typeof userEvent.setup>) => u.click(save())],
    ['Enter in Name', async (u: ReturnType<typeof userEvent.setup>) => u.type(nameInput(), '{Enter}')],
  ])('blocks a save by %s while a typed name has not been added, on create and edit', async (_how, trigger) => {
    for (const initialAreaId of [null, 2]) {
      const user = await openField({ initialName: 'P', initialAreaId })
      await user.type(field(), 'Garden')
      await trigger(user)
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('Add or cancel the new area first.')
      expect(field()).toHaveAccessibleDescription('Add or cancel the new area first.')
      expect(field()).toHaveAttribute('aria-invalid', 'true')
      expect(document.activeElement).toBe(field())
      await user.type(field(), 's')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      document.body.innerHTML = ''
    }
  })

  it('shows the name error alongside the blocked-save message', async () => {
    const user = await openField()
    await user.type(field(), 'Garden')
    await user.click(save())
    expect(screen.getAllByRole('alert').map(a => a.textContent)).toEqual([
      'Name is required.',
      'Add or cancel the new area first.',
    ])
  })

  it.each(['', '   '])('saves the shown selection with %j in the open field', async typed => {
    const user = await openField({ initialName: 'P', initialAreaId: 2 })
    if (typed) await user.type(field(), typed)
    await user.click(save())
    expect(submitted()).toBe(2)
  })

  it('saves normally after Cancel', async () => {
    const user = await openField({ initialName: 'P' })
    await user.type(field(), 'Garden')
    await user.click(save())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(save())
    expect(submitted()).toBeNull()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('reset after create returns to "No area" and closes an empty field', async () => {
    const user = await loaded({ resetOnSuccess: true })
    await user.selectOptions(select(), 'Work')
    await user.selectOptions(select(), '+ New area…')
    await user.type(nameInput(), 'P')
    await user.click(save())
    expect(submitted()).toBe(2)
    expect(select()).toHaveDisplayValue('No area')
    expect(queryField()).not.toBeInTheDocument()
  })
})
