import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import * as areasApi from '@/api/areas'
import type { AreaResponseDto } from '@/api/areas'
import * as projectsApi from '@/api/projects'
import { ProjectForm } from './ProjectForm'
import { SettingsDrawer } from './SettingsDrawer'

vi.mock('@/api/areas', () => ({
  getAreas: vi.fn(),
  createArea: vi.fn(),
  renameArea: vi.fn(),
  reorderAreas: vi.fn(),
  deleteArea: vi.fn(),
}))
vi.mock('@/api/projects', () => ({ getProjects: vi.fn() }))
vi.mock('@/context/usePrefs', () => ({
  usePrefs: () => ({ headerStyle: 'stat', todoSort: 'manual', theme: 'default', projectStart: '2026-01-01' }),
}))

// The section is tested inside the real drawer: Escape, Tab and focus are shared between the two.

let server: AreaResponseDto[] = []
const area = (id: number, name: string, projectCount = 0): AreaResponseDto => ({
  id,
  name,
  projectCount,
  displayOrder: id,
})

const onClose = vi.fn()

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <SettingsDrawer
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      />
    </>
  )
}

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
}

async function loaded() {
  const user = userEvent.setup()
  renderDrawer()
  await screen.findByRole('button', { name: 'Reorder Work' })
  return user
}

const section = () => screen.getByRole('region', { name: 'Areas' })
const rowNames = () => Array.from(document.querySelectorAll('.area-name'), el => el.textContent)
const handle = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
const announcement = () => section().querySelector('[role="status"].sr-only')
const drawerOpen = () => screen.getByRole('dialog', { name: 'Settings' }).classList.contains('is-open')

/** A request that stays pending until the test settles it. */
function deferred() {
  let resolve!: (value?: unknown) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise: promise as never, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  server = [area(1, 'Work', 2), area(2, 'Personal', 1), area(3, 'Health')]
  vi.mocked(areasApi.getAreas).mockImplementation(async () => ({ data: [...server] }) as never)
  vi.mocked(projectsApi.getProjects).mockResolvedValue({ data: [] } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Areas section', () => {
  it('lists rows with count wording and no up/down or menu controls', async () => {
    await loaded()
    const rows = within(section()).getAllByRole('listitem')
    expect(rows.map(r => r.querySelector('.area-count')?.textContent)).toEqual([
      '2 projects',
      '1 project',
      'No projects',
    ])
    expect(within(rows[0]).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Reorder Work',
      'Rename Work',
      'Delete Work',
    ])
  })

  it('shows a load failure with Retry and leaves the other settings usable', async () => {
    vi.mocked(areasApi.getAreas).mockRejectedValueOnce({})
    const user = userEvent.setup()
    renderDrawer()
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load areas.')
    expect(screen.getByRole('switch', { name: 'Toggle dark mode' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Reorder Work' })).toBeInTheDocument()
  })

  // Hidden-on-touch must never become unreachable for an attached keyboard.
  it('keeps the handle in the tab order, with no tap-target size and a described hint', async () => {
    const user = await loaded()
    const first = handle('Work')
    expect(first).not.toHaveAttribute('tabindex')
    expect(first).not.toHaveAttribute('aria-hidden')
    expect(first).not.toHaveClass('tap-target')
    expect(first).toHaveAccessibleDescription(/Alt\+↑ \/ Alt\+↓/)
    screen.getByRole('switch', { name: /toggle parent auto-complete/i }).focus()
    await user.tab()
    expect(first).toHaveFocus()
  })

  // A second query key in either place would leave the open drawer stale.
  it('shows an area created from a project form without a reload', async () => {
    vi.mocked(areasApi.createArea).mockImplementation(async name => {
      server = [...server, area(4, name)]
      return { data: area(4, name) } as never
    })
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ProjectForm submitLabel="Create project" errorFallback="x" onSubmit={vi.fn()} />
        <SettingsDrawer open onClose={onClose} />
      </QueryClientProvider>,
    )
    await screen.findByRole('button', { name: 'Reorder Work' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Area' }), '+ New area…')
    await user.keyboard('Garden{Enter}')
    expect(await screen.findByRole('button', { name: 'Reorder Garden' })).toBeInTheDocument()
  })

  it('hides the reorder hint with a single area', async () => {
    server = [area(1, 'Work')]
    await loaded()
    expect(screen.queryByText(/to reorder/)).not.toBeInTheDocument()
    expect(handle('Work')).not.toHaveAttribute('aria-describedby')
  })
})

describe('rename and add', () => {
  it('renames on Enter with the trimmed name and returns focus to the pencil', async () => {
    vi.mocked(areasApi.renameArea).mockImplementation(async (id, name) => {
      server = server.map(a => (a.id === id ? { ...a, name } : a))
      return {} as never
    })
    const user = await loaded()
    await user.click(screen.getByRole('button', { name: 'Rename Work' }))
    const input = screen.getByRole('textbox', { name: 'Area name' })
    expect(input).toHaveFocus()
    expect(handle('Work')).toBeDisabled()
    await user.keyboard('  Job  {Enter}')
    expect(areasApi.renameArea).toHaveBeenCalledWith(1, 'Job')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Job' })).toHaveFocus())
  })

  it('closes an unchanged rename without a request', async () => {
    const user = await loaded()
    await user.click(screen.getByRole('button', { name: 'Rename Work' }))
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(areasApi.renameArea).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Rename Work' })).toHaveFocus()
  })

  it('appends an added area and returns focus to "+ Add area"', async () => {
    vi.mocked(areasApi.createArea).mockImplementation(async name => {
      server = [...server, area(4, name)]
      return { data: area(4, name) } as never
    })
    const user = await loaded()
    await user.click(screen.getByRole('button', { name: '+ Add area' }))
    await user.type(screen.getByRole('textbox', { name: 'New area name' }), 'Garden')
    await user.click(screen.getByRole('button', { name: 'Save area' }))
    await waitFor(() => expect(rowNames()).toEqual(['Work', 'Personal', 'Health', 'Garden']))
    expect(screen.getByRole('button', { name: '+ Add area' })).toHaveFocus()
  })

  const failures = [
    ['an empty name', '', 'Name is required.'],
    ['a name over 100 characters', 'a'.repeat(101), 'Name must be 100 characters or fewer.'],
    ['a duplicate rejected by the server', 'personal', 'An area with that name already exists.'],
  ] as const

  describe.each([
    ['rename', 'Rename Work', 'Area name', 'Save name'],
    ['add', '+ Add area', 'New area name', 'Save area'],
  ])('%s', (_kind, opener, field, saveLabel) => {
    it.each(failures)('keeps the field open and focused after %s', async (_case, typed, message) => {
      const rejection = { message: 'An area with that name already exists.' }
      vi.mocked(areasApi.renameArea).mockRejectedValue(rejection)
      vi.mocked(areasApi.createArea).mockRejectedValue(rejection)
      const user = await loaded()
      await user.click(screen.getByRole('button', { name: opener }))
      const input = screen.getByRole('textbox', { name: field })
      await user.clear(input)
      if (typed) await user.paste(typed)
      await user.click(screen.getByRole('button', { name: saveLabel }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(input).toHaveValue(typed)
      expect(document.activeElement).toBe(input)
    })
  })

  // A focused button that becomes disabled drops focus to body.
  it('moves focus to the field before disabling Save', async () => {
    vi.mocked(areasApi.createArea).mockReturnValue(deferred().promise)
    const user = await loaded()
    await user.click(screen.getByRole('button', { name: '+ Add area' }))
    await user.keyboard('Garden')
    await user.click(screen.getByRole('button', { name: 'Save area' }))
    expect(screen.getByRole('button', { name: 'Save area' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'New area name' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(areasApi.createArea).toHaveBeenCalledOnce()
  })

  it.each(['Area name', 'Save name', 'Cancel rename'])(
    'Escape on "%s" cancels the editor only; a second Escape closes the drawer',
    async name => {
      const user = await loaded()
      await user.click(screen.getByRole('button', { name: 'Rename Work' }))
      screen.getByLabelText(name).focus()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('textbox', { name: 'Area name' })).not.toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Rename Work' })).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledOnce()
    },
  )

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'a composing key (%j) neither saves, cancels nor closes the drawer',
    async composing => {
      const user = await loaded()
      await user.click(screen.getByRole('button', { name: 'Rename Work' }))
      const input = screen.getByRole('textbox', { name: 'Area name' })
      await user.keyboard('typed')
      fireEvent.keyDown(input, { key: 'Enter', ...composing })
      fireEvent.keyDown(input, { key: 'Escape', ...composing })
      expect(input).toBeInTheDocument()
      expect(areasApi.renameArea).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    },
  )

  it('keeps one editor open at a time and discards drafts when the drawer closes', async () => {
    const user = await loaded()
    await user.click(screen.getByRole('button', { name: '+ Add area' }))
    await user.keyboard('draft')
    await user.click(screen.getByRole('button', { name: 'Rename Work' }))
    expect(screen.queryByRole('textbox', { name: 'New area name' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Add area' }))
    expect(screen.queryByRole('textbox', { name: 'Area name' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'New area name' })).toHaveValue('')
    await user.keyboard('draft')
    await user.click(screen.getByRole('button', { name: 'Close settings' }))
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('keyboard reorder', () => {
  it('shows the new order at once, keeps focus on the handle and announces the position', async () => {
    const save = deferred()
    vi.mocked(areasApi.reorderAreas).mockReturnValue(save.promise)
    const user = await loaded()
    handle('Personal').focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await waitFor(() => expect(rowNames()).toEqual(['Personal', 'Work', 'Health']))
    expect(areasApi.reorderAreas).toHaveBeenCalledWith([2, 1, 3])
    expect(announcement()).toHaveTextContent('Personal moved to position 1 of 3')
    expect(handle('Personal')).toHaveFocus()
    // Input is ignored while the save is pending, without disabling the focused handle.
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(areasApi.reorderAreas).toHaveBeenCalledOnce()
    expect(handle('Personal')).toBeEnabled()
    server = [server[1], server[0], server[2]]
    await act(async () => save.resolve({}))
  })

  it('restores the order, reports the error, reloads and keeps focus when the save fails', async () => {
    const save = deferred()
    vi.mocked(areasApi.reorderAreas).mockReturnValue(save.promise)
    const user = await loaded()
    handle('Work').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await waitFor(() => expect(rowNames()).toEqual(['Personal', 'Work', 'Health']))
    // Areas changed elsewhere: the reload must show the server's list, not just the snapshot.
    server = [...server, area(4, 'Added elsewhere')]
    await act(async () => save.reject({ message: 'The list must include every area.' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The list must include every area.')
    await waitFor(() => expect(rowNames()).toEqual(['Work', 'Personal', 'Health', 'Added elsewhere']))
    expect(handle('Work')).toHaveFocus()
  })

  it.each([
    ['Work', 'ArrowUp'],
    ['Health', 'ArrowDown'],
  ])('does nothing at the end of the list (%s, %s)', async (name, key) => {
    const user = await loaded()
    handle(name).focus()
    await user.keyboard(`{Alt>}{${key}}{/Alt}`)
    expect(areasApi.reorderAreas).not.toHaveBeenCalled()
    expect(announcement()).toHaveTextContent('')
  })
})

describe('mouse reorder', () => {
  // Rows are 40px tall, stacked from 0 in DOM order.
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const rows = Array.from(document.querySelectorAll('[data-area-row]'))
      return { top: rows.indexOf(this) * 40, height: 40 } as DOMRect
    })
    vi.mocked(areasApi.reorderAreas).mockResolvedValue({} as never)
  })

  const pointer = { button: 0, pointerId: 1, pointerType: 'mouse' }
  const dropLine = () => section().querySelector('.area-drop-line')

  async function startDrag() {
    await loaded()
    const grip = handle('Work')
    fireEvent.pointerDown(grip, { ...pointer, clientY: 10 })
    return grip
  }

  it('shows the drop line, saves the new order on drop and focuses the moved handle', async () => {
    const grip = await startDrag()
    fireEvent.pointerMove(grip, { ...pointer, clientY: 30 })
    expect(dropLine()).not.toBeInTheDocument()
    fireEvent.pointerMove(grip, { ...pointer, clientY: 70 })
    expect(dropLine()?.closest('li')).toHaveTextContent('Health')
    fireEvent.pointerUp(grip, { ...pointer, clientY: 70 })
    expect(dropLine()).not.toBeInTheDocument()
    await waitFor(() => expect(areasApi.reorderAreas).toHaveBeenCalledWith([2, 1, 3]))
    expect(handle('Work')).toHaveFocus()
  })

  it('sends nothing when dropped where it started', async () => {
    const grip = await startDrag()
    fireEvent.pointerUp(grip, { ...pointer, clientY: 30 })
    expect(areasApi.reorderAreas).not.toHaveBeenCalled()
  })

  it('recomputes the target when the drawer scrolls under a still pointer', async () => {
    const grip = await startDrag()
    fireEvent.pointerMove(grip, { ...pointer, clientY: 70 })
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      const rows = Array.from(document.querySelectorAll('[data-area-row]'))
      return { top: rows.indexOf(this) * 40 - 60, height: 40 } as DOMRect
    })
    fireEvent.scroll(screen.getByRole('dialog', { name: 'Settings' }))
    expect(dropLine()).toHaveClass('area-drop-line--after')
  })

  it.each(['Escape', 'pointercancel'])('%s aborts the drag, sends nothing and leaves the drawer open', async how => {
    const grip = await startDrag()
    fireEvent.pointerMove(grip, { ...pointer, clientY: 70 })
    // Focus need not be on the handle.
    if (how === 'Escape') fireEvent.keyDown(document.body, { key: 'Escape' })
    else fireEvent.pointerCancel(grip, pointer)
    expect(dropLine()).not.toBeInTheDocument()
    fireEvent.pointerUp(grip, { ...pointer, clientY: 70 })
    expect(areasApi.reorderAreas).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(drawerOpen()).toBe(true)
  })

  it('ignores touch pointers', async () => {
    await loaded()
    const grip = handle('Work')
    const touch = { ...pointer, pointerType: 'touch' }
    fireEvent.pointerDown(grip, { ...touch, clientY: 10 })
    fireEvent.pointerMove(grip, { ...touch, clientY: 110 })
    expect(dropLine()).not.toBeInTheDocument()
    fireEvent.pointerUp(grip, { ...touch, clientY: 110 })
    expect(areasApi.reorderAreas).not.toHaveBeenCalled()
  })
})

describe('delete', () => {
  const trash = (name: string) => screen.getByRole('button', { name: `Delete ${name}` })
  const list = () => section().querySelector('ul')
  const dialog = () => screen.queryByRole('dialog', { name: /^Delete the/ })
  const removeOnDelete = () =>
    vi.mocked(areasApi.deleteArea).mockImplementation(async id => {
      server = server.filter(a => a.id !== id)
      return {} as never
    })

  beforeEach(() => {
    vi.mocked(projectsApi.getProjects).mockResolvedValue({
      data: [{ id: 9, name: 'Site', areaId: 1, isArchived: false }],
    } as never)
  })

  it('deletes an empty area at once and focuses the list', async () => {
    removeOnDelete()
    const user = await loaded()
    await user.click(trash('Health'))
    expect(dialog()).not.toBeInTheDocument()
    expect(areasApi.deleteArea).toHaveBeenCalledWith(3, undefined)
    await waitFor(() => expect(rowNames()).toEqual(['Work', 'Personal']))
    expect(list()).toHaveFocus()
  })

  it('opens the dialog if a direct delete fails because the area now has projects', async () => {
    vi.mocked(areasApi.deleteArea).mockImplementation(async () => {
      server = server.map(a => (a.id === 3 ? { ...a, projectCount: 2 } : a))
      throw { message: 'The area has projects.' }
    })
    const user = await loaded()
    await user.click(trash('Health'))
    expect(await screen.findByRole('dialog', { name: 'Delete the “Health” area?' })).toBeInTheDocument()
  })

  it('shows any other direct delete failure in the section', async () => {
    vi.mocked(areasApi.deleteArea).mockRejectedValue({})
    const user = await loaded()
    await user.click(trash('Health'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete area.')
    expect(dialog()).not.toBeInTheDocument()
  })

  it('Escape closes only the dialog and returns focus to the trash button', async () => {
    const user = await loaded()
    await user.click(trash('Work'))
    await user.keyboard('{Escape}')
    expect(dialog()).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(trash('Work')).toHaveFocus()
    // The drawer takes Escape back afterwards.
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  // The drawer's trap would otherwise pull focus out of the portalled dialog.
  it('keeps Tab inside the dialog and Cancel returns focus to the trash button', async () => {
    const user = await loaded()
    await user.click(trash('Work'))
    await screen.findByText('Site')
    for (let i = 0; i < 10; i++) {
      await user.tab()
      expect(dialog()).toContainElement(document.activeElement as HTMLElement)
    }
    for (let i = 0; i < 10; i++) {
      await user.tab({ shift: true })
      expect(dialog()).toContainElement(document.activeElement as HTMLElement)
    }
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(trash('Work')).toHaveFocus()
  })

  it('focuses the list once the dialog delete succeeds and the row is gone', async () => {
    removeOnDelete()
    const user = await loaded()
    await user.click(trash('Work'))
    await screen.findByText('Site')
    await user.click(screen.getByRole('radio', { name: 'Leave them without an area' }))
    await user.click(screen.getByRole('button', { name: 'Delete area' }))
    await waitFor(() => expect(dialog()).not.toBeInTheDocument())
    await waitFor(() => expect(rowNames()).toEqual(['Personal', 'Health']))
    expect(list()).toHaveFocus()
  })
})
