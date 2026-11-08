import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRef } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskForm } from './TaskForm'

beforeEach(() => {
  vi.clearAllMocks()
})

type Props = Parameters<typeof TaskForm>[0]

function renderForm(task?: Props['task'], onSubmit = vi.fn(), onCancel = vi.fn(), extra: Partial<Props> = {}) {
  return render(<TaskForm task={task} onSubmit={onSubmit} onCancel={onCancel} {...extra} />)
}

const projects = [
  { id: 2, name: 'Beta', isArchived: false },
  { id: 1, name: 'Alpha', isArchived: false },
  { id: 3, name: 'Old', isArchived: true },
]

const existing = {
  id: 7, title: 'Existing task', description: 'Some desc', status: 'Todo' as const, priority: 'Medium' as const,
}

const FUTURE = '2099-01-01'
const FUTURE_2 = '2099-02-02'
const PAST = '2000-01-01'
const PAST_2 = '2000-02-02'

function projectSelect() {
  return screen.getByRole('combobox', { name: 'Project' })
}

function optionLabels() {
  return within(projectSelect()).getAllByRole('option').map(o => o.textContent)
}

describe('TaskForm', () => {
  it('renders title input', () => {
    renderForm()
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument()
  })

  it('does not focus the title on mount without a titleInputRef', () => {
    renderForm()
    expect(screen.getByLabelText(/title/i)).not.toHaveFocus()
  })

  it('attaches a supplied titleInputRef to the title input', () => {
    const ref = createRef<HTMLInputElement>()
    renderForm(undefined, vi.fn(), vi.fn(), { titleInputRef: ref })
    expect(ref.current).toBe(screen.getByLabelText(/title/i))
  })

  it('pre-fills fields when editing an existing task', () => {
    const task = {
      id: 1, title: 'Existing task', description: 'Some desc', status: 'todo', priority: 'medium',
    }
    renderForm(task)
    expect(screen.getByDisplayValue('Existing task')).toBeInTheDocument()
  })

  it('submits the stored status and no blockedReason when a lock engages after the user changed the select', async () => {
    const onSubmit = vi.fn()
    const { rerender } = renderForm(existing, onSubmit)
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'blocked')
    rerender(<TaskForm task={existing} onSubmit={onSubmit} onCancel={vi.fn()} statusLocked displayStatus="InProgress" />)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.status).toBe('todo')
    expect(payload).not.toHaveProperty('blockedReason')
  })

  it('calls onSubmit with form data when submitted', async () => {
    const onSubmit = vi.fn()
    renderForm(undefined, onSubmit)
    await userEvent.type(screen.getByLabelText(/title/i), 'New task')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'New task' }))
  })

  describe('due date wire format', () => {
    it('sends a chosen date as YYYY-MM-DD with no time suffix', async () => {
      const onSubmit = vi.fn()
      renderForm(undefined, onSubmit)
      await userEvent.type(screen.getByLabelText(/title/i), 'Dated task')
      fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '2026-05-01' } })
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-05-01' }))
    })

    it('prefills the date input from the task and resubmits it unchanged', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, dueDate: '2026-05-01' }, onSubmit)
      expect(screen.getByLabelText('Due Date')).toHaveValue('2026-05-01')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-05-01' }))
    })

    it('sends null (not an empty string) when the date is cleared or never set', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, dueDate: '2026-05-01' }, onSubmit)
      fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '' } })
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit.mock.calls[0][0].dueDate).toBeNull()
    })

    it('sends null for a task with no due date', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, dueDate: null }, onSubmit)
      expect(screen.getByLabelText('Due Date')).toHaveValue('')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit.mock.calls[0][0].dueDate).toBeNull()
    })
  })

  it('keeps Cancel before Save in DOM order (mobile wrap must not reorder)', () => {
    renderForm()
    const cancel = screen.getByRole('button', { name: /cancel/i })
    const save = screen.getByRole('button', { name: /save/i })
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn()
    renderForm(undefined, vi.fn(), onCancel)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  describe('project select', () => {
    it('offers "No project" first, then non-archived projects alphabetically', () => {
      renderForm(undefined, vi.fn(), vi.fn(), { projects })
      expect(optionLabels()).toEqual(['No project', 'Alpha', 'Beta'])
    })

    it('sits between Due Date and Parent Task', () => {
      renderForm(undefined, vi.fn(), vi.fn(), { projects })
      const due = screen.getByLabelText('Due Date')
      const parent = screen.getByLabelText('Parent Task')
      expect(due.compareDocumentPosition(projectSelect()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(projectSelect().compareDocumentPosition(parent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('selects "No project" for a new task and emits null', async () => {
      const onSubmit = vi.fn()
      renderForm(undefined, onSubmit, vi.fn(), { projects })
      expect(projectSelect()).toHaveDisplayValue('No project')
      await userEvent.type(screen.getByLabelText(/title/i), 'T')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
    })

    it('create with a chosen project emits its id', async () => {
      const onSubmit = vi.fn()
      renderForm(undefined, onSubmit, vi.fn(), { projects })
      await userEvent.type(screen.getByLabelText(/title/i), 'T')
      await userEvent.selectOptions(projectSelect(), 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: 2 }))
    })

    it('moving from project A to B emits B', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, projectId: 1, projectName: 'Alpha' }, onSubmit, vi.fn(), { projects })
      expect(projectSelect()).toHaveDisplayValue('Alpha')
      await userEvent.selectOptions(projectSelect(), 'Beta')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: 2 }))
    })

    it('choosing "No project" on a task with a project emits null', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, projectId: 1, projectName: 'Alpha' }, onSubmit, vi.fn(), { projects })
      await userEvent.selectOptions(projectSelect(), 'No project')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
    })

    it('editing another field keeps the current project in the payload', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, projectId: 1, projectName: 'Alpha' }, onSubmit, vi.fn(), { projects })
      await userEvent.type(screen.getByLabelText(/title/i), ' edited')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Existing task edited', projectId: 1 }))
    })

    it('keeps an archived current project selected with the (archived) suffix', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, projectId: 3, projectName: 'Old' }, onSubmit, vi.fn(), { projects })
      expect(optionLabels()).toEqual(['No project', 'Old (archived)', 'Alpha', 'Beta'])
      expect(projectSelect()).toHaveDisplayValue('Old (archived)')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: 3 }))
    })

    it('keeps the archived current option available after the selection changes', async () => {
      renderForm({ ...existing, projectId: 3, projectName: 'Old' }, vi.fn(), vi.fn(), { projects })
      await userEvent.selectOptions(projectSelect(), 'Beta')
      expect(optionLabels()).toContain('Old (archived)')
    })

    it('falls back to projectName when the current project is not in the list', () => {
      renderForm({ ...existing, projectId: 9, projectName: 'Deleted elsewhere' }, vi.fn(), vi.fn(), { projects })
      expect(projectSelect()).toHaveDisplayValue('Deleted elsewhere')
      expect(optionLabels()).toEqual(['No project', 'Deleted elsewhere', 'Alpha', 'Beta'])
    })

    it('falls back to the id when the name is missing too', () => {
      renderForm({ ...existing, projectId: 9, projectName: null }, vi.fn(), vi.fn(), { projects: [] })
      expect(projectSelect()).toHaveDisplayValue('Project #9')
    })

    it('selects the matching option for a string projectId', () => {
      renderForm({ ...existing, projectId: '2', projectName: 'Beta' }, vi.fn(), vi.fn(), { projects })
      expect(projectSelect()).toHaveDisplayValue('Beta')
    })

    it.each([
      ['null', { projectId: null, projectName: null }],
      ['undefined', {}],
    ])('selects "No project" for a task with %s project', (_label, extra) => {
      renderForm({ ...existing, ...extra }, vi.fn(), vi.fn(), { projects })
      expect(projectSelect()).toHaveDisplayValue('No project')
    })

    it('defaultProjectId preselects an active project for a new task', () => {
      renderForm(undefined, vi.fn(), vi.fn(), { projects, defaultProjectId: 2 })
      expect(projectSelect()).toHaveDisplayValue('Beta')
    })

    it('defaultProjectId is ignored for an archived project', () => {
      renderForm(undefined, vi.fn(), vi.fn(), { projects, defaultProjectId: 3 })
      expect(projectSelect()).toHaveDisplayValue('No project')
    })

    it('defaultProjectId is ignored when editing a task', () => {
      renderForm({ ...existing, projectId: null }, vi.fn(), vi.fn(), { projects, defaultProjectId: 2 })
      expect(projectSelect()).toHaveDisplayValue('No project')
    })

    it('follows the server value when the task prop reports a different project after a refetch', () => {
      const { rerender } = renderForm({ ...existing, projectId: 1, projectName: 'Alpha' }, vi.fn(), vi.fn(), { projects })
      rerender(
        <TaskForm
          task={{ ...existing, projectId: 2, projectName: 'Beta' }}
          projects={projects}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      )
      expect(projectSelect()).toHaveDisplayValue('Beta')
    })

    it('marks the select invalid and focuses it, clearing on change', async () => {
      const onProjectChange = vi.fn()
      renderForm(undefined, vi.fn(), vi.fn(), { projects, projectInvalid: true, onProjectChange })
      expect(projectSelect()).toHaveAttribute('aria-invalid', 'true')
      expect(projectSelect()).toHaveFocus()
      await userEvent.selectOptions(projectSelect(), 'Alpha')
      expect(onProjectChange).toHaveBeenCalled()
    })

    it('does not submit while saving and labels the button', async () => {
      const onSubmit = vi.fn()
      renderForm(undefined, onSubmit, vi.fn(), { projects, isSaving: true })
      await userEvent.type(screen.getByLabelText(/title/i), 'T')
      const save = screen.getByRole('button', { name: /saving/i })
      expect(save).not.toBeDisabled()
      await userEvent.click(save)
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('marks the Save button aria-busy only while saving', () => {
      const { unmount } = renderForm(undefined, vi.fn(), vi.fn(), { projects, isSaving: true })
      expect(screen.getByRole('button', { name: /saving/i })).toHaveAttribute('aria-busy', 'true')
      unmount()
      renderForm(undefined, vi.fn(), vi.fn(), { projects })
      expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy')
    })

    it('keeps a selected project that is archived afterwards, with the suffix, and submits it', async () => {
      const onSubmit = vi.fn()
      const view = renderForm({ ...existing, projectId: null }, onSubmit, vi.fn(), { projects })
      await userEvent.selectOptions(projectSelect(), 'Beta')
      view.rerender(
        <TaskForm
          task={{ ...existing, projectId: null }}
          projects={projects.map(p => (p.id === 2 ? { ...p, isArchived: true } : p))}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      )
      expect(projectSelect()).toHaveDisplayValue('Beta (archived)')
      expect(optionLabels()).toEqual(['No project', 'Beta (archived)', 'Alpha'])
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: 2 }))
    })

    it('does not offer an archived project that was never selected', () => {
      renderForm({ ...existing, projectId: 1, projectName: 'Alpha' }, vi.fn(), vi.fn(), { projects })
      expect(optionLabels()).not.toContain('Old (archived)')
    })

    it('shows and submits "No project" when the selected project disappears from the list', async () => {
      const onSubmit = vi.fn()
      const view = renderForm({ ...existing, projectId: null }, onSubmit, vi.fn(), { projects })
      await userEvent.selectOptions(projectSelect(), 'Beta')
      view.rerender(
        <TaskForm
          task={{ ...existing, projectId: null }}
          projects={projects.filter(p => p.id !== 2)}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      )
      expect(projectSelect()).toHaveDisplayValue('No project')
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
    })

    it('resyncing to a new server project keeps the other edited fields', async () => {
      const { rerender } = renderForm({ ...existing, projectId: 1, projectName: 'Alpha' }, vi.fn(), vi.fn(), { projects })
      await userEvent.type(screen.getByLabelText(/title/i), ' edited')
      rerender(
        <TaskForm
          task={{ ...existing, projectId: 2, projectName: 'Beta' }}
          projects={projects}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      )
      expect(projectSelect()).toHaveDisplayValue('Beta')
      expect(screen.getByLabelText(/title/i)).toHaveValue('Existing task edited')
    })

    it('tab order is Due Date, Project, Parent Task on create (no Planned day)', async () => {
      renderForm(undefined, vi.fn(), vi.fn(), { projects })
      screen.getByLabelText('Due Date').focus()
      await userEvent.tab()
      expect(projectSelect()).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByLabelText('Parent Task')).toHaveFocus()
    })

    it('tab order on edit is Due Date, Planned day, Project, Parent Task with Clear absent when unplanned', async () => {
      renderForm(existing, vi.fn(), vi.fn(), { projects })
      screen.getByLabelText('Due Date').focus()
      await userEvent.tab()
      expect(screen.getByLabelText('Planned day')).toHaveFocus()
      await userEvent.tab()
      expect(projectSelect()).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByLabelText('Parent Task')).toHaveFocus()
    })

    it('tab order on edit puts Clear between Planned day and Project when a day is stored', async () => {
      renderForm({ ...existing, currentJournalDate: FUTURE }, vi.fn(), vi.fn(), { projects })
      screen.getByLabelText('Planned day').focus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'Clear planned day' })).toHaveFocus()
      await userEvent.tab()
      expect(projectSelect()).toHaveFocus()
    })

    it('works with no projects prop', () => {
      renderForm()
      expect(optionLabels()).toEqual(['No project'])
    })
  })

  describe('in progress status', () => {
    const base = { id: 7, title: 'T', status: 'Todo' as const, priority: 'Medium' as const }
    const statusSelect = () => screen.getByRole('combobox', { name: 'Status' })
    const option = () => within(statusSelect()).getByRole('option', { name: /^In Progress/ })

    it.each(['Draft', 'Completed'] as const)('disables In Progress with an explanation when the task is %s', status => {
      renderForm({ ...base, status })
      expect(option()).toBeDisabled()
      expect(option()).toHaveAttribute('title', 'Set to Todo first')
    })

    it('enables In Progress for Todo, Blocked, InProgress and new tasks', () => {
      for (const status of ['Todo', 'Blocked', 'InProgress'] as const) {
        const { unmount } = renderForm({ ...base, status: status as never })
        expect(option()).toBeEnabled()
        unmount()
      }
      renderForm()
      expect(option()).toBeEnabled()
    })

    it('sends the camelCase wire value inProgress', async () => {
      const onSubmit = vi.fn()
      renderForm(base, onSubmit)
      await userEvent.selectOptions(statusSelect(), 'inprogress')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'inProgress' }))
    })

    it('pre-selects an InProgress task and resubmits inProgress', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...base, status: 'InProgress' as never }, onSubmit)
      expect(statusSelect()).toHaveValue('inprogress')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'inProgress' }))
    })

    it('enables Blocked for an InProgress task', () => {
      renderForm({ ...base, status: 'InProgress' as never })
      expect(within(statusSelect()).getByRole('option', { name: 'Blocked' })).toBeEnabled()
    })
  })

  describe('blocked status', () => {
    const todoTask = { id: 7, title: 'T', status: 'Todo' as const, priority: 'Medium' as const }
    const statusSelect = () => screen.getByRole('combobox', { name: 'Status' })
    const blockedOption = () => within(statusSelect()).getByRole('option', { name: 'Blocked' })

    it('offers a Blocked option', () => {
      renderForm(todoTask)
      expect(blockedOption()).toBeInTheDocument()
    })

    it.each(['Draft', 'Completed'] as const)('disables Blocked when the task is %s', status => {
      renderForm({ ...todoTask, status })
      expect(blockedOption()).toBeDisabled()
    })

    it('disables Blocked when creating a new task', () => {
      renderForm()
      expect(blockedOption()).toBeDisabled()
    })

    it('enables Blocked for Todo and for already Blocked tasks', () => {
      const { unmount } = renderForm(todoTask)
      expect(blockedOption()).toBeEnabled()
      unmount()
      renderForm({ ...todoTask, status: 'Blocked' as never })
      expect(blockedOption()).toBeEnabled()
    })

    it('shows the reason field only while the status is Blocked', async () => {
      renderForm(todoTask)
      expect(screen.queryByLabelText('Blocked reason (optional)')).not.toBeInTheDocument()
      await userEvent.selectOptions(statusSelect(), 'blocked')
      const reason = screen.getByLabelText('Blocked reason (optional)')
      expect(reason).toHaveAttribute('maxlength', '200')
      await userEvent.selectOptions(statusSelect(), 'todo')
      expect(screen.queryByLabelText('Blocked reason (optional)')).not.toBeInTheDocument()
    })

    it('pre-fills the stored reason and submits it with status blocked', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...todoTask, status: 'Blocked' as never, blockedReason: 'Waiting on Sam' }, onSubmit)
      const reason = screen.getByLabelText('Blocked reason (optional)')
      expect(reason).toHaveValue('Waiting on Sam')
      await userEvent.clear(reason)
      await userEvent.type(reason, '  New reason ')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked', blockedReason: 'New reason' }))
    })

    it('submits an empty reason (clears it) while Blocked', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...todoTask, status: 'Blocked' as never, blockedReason: 'Old' }, onSubmit)
      await userEvent.clear(screen.getByLabelText('Blocked reason (optional)'))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit.mock.calls[0][0]).toHaveProperty('blockedReason', '')
    })

    it('omits blockedReason when the status is not Blocked, even after typing one and switching away', async () => {
      const onSubmit = vi.fn()
      renderForm(todoTask, onSubmit)
      await userEvent.selectOptions(statusSelect(), 'blocked')
      await userEvent.type(screen.getByLabelText('Blocked reason (optional)'), 'typed')
      await userEvent.selectOptions(statusSelect(), 'todo')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('blockedReason')
      expect(onSubmit.mock.calls[0][0]).toHaveProperty('status', 'todo')
    })
  })
})

describe('TaskForm with a locked (derived) status', () => {
  const blockedTask = { ...existing, status: 'Blocked' as const, blockedReason: 'Waiting on Sam' }

  it('disables the status select, shows the derived status and links the helper text', () => {
    renderForm(existing, vi.fn(), vi.fn(), { statusLocked: true, displayStatus: 'InProgress' })
    const select = screen.getByRole('combobox', { name: 'Status' })
    expect(select).toBeDisabled()
    expect(select).toHaveValue('inprogress')
    expect(select).toHaveAttribute('aria-describedby', 'status-locked-hint')
    expect(document.getElementById('status-locked-hint')).toHaveTextContent('Follows open subtasks. Complete or remove them to change it.')
  })

  it('hides the blocked-reason input while locked', () => {
    renderForm(blockedTask, vi.fn(), vi.fn(), { statusLocked: true, displayStatus: 'Todo' })
    expect(screen.queryByLabelText(/blocked reason/i)).not.toBeInTheDocument()
  })

  it('submits the stored status and omits blockedReason', async () => {
    const onSubmit = vi.fn()
    renderForm(blockedTask, onSubmit, vi.fn(), { statusLocked: true, displayStatus: 'Todo' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.status).toBe('blocked')
    expect(payload).not.toHaveProperty('blockedReason')
  })

  it('keeps the select editable when not locked', () => {
    renderForm(existing)
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeEnabled()
    expect(document.getElementById('status-locked-hint')).toBeNull()
  })
})

describe('TaskForm open statuses under a Completed parent', () => {
  const parents = [
    { id: 1, title: 'Open parent', status: 'Todo' },
    { id: 2, title: 'Done parent', status: 'Completed' },
  ]
  const doneChild = { ...existing, status: 'Completed' as const, parentTaskItemId: 2 }
  const statusSelect = () => screen.getByRole('combobox', { name: 'Status' })
  const openNames = ['Draft', 'Todo', 'In Progress', 'Blocked']
  const HINT = 'Parent is completed. Reopen the parent first to change this status.'

  function expectOpenDisabled(disabled: boolean) {
    for (const name of openNames) {
      const option = within(statusSelect()).getByRole('option', { name: new RegExp(`^${name}`) })
      if (disabled) expect(option).toBeDisabled()
      else if (name === 'Draft' || name === 'Todo') expect(option).toBeEnabled()
    }
  }

  it('disables all open statuses, keeps Completed selected, and shows a linked hint', () => {
    renderForm(doneChild, vi.fn(), vi.fn(), { availableParents: parents })
    expectOpenDisabled(true)
    const completed = within(statusSelect()).getByRole('option', { name: 'Completed' }) as HTMLOptionElement
    expect(completed).toBeEnabled()
    expect(completed.selected).toBe(true)
    const hint = screen.getByText(HINT)
    expect(statusSelect()).toHaveAttribute('aria-describedby', hint.id)
  })

  it.each([
    ['the parent is open', { ...doneChild, parentTaskItemId: 1 }, parents],
    ['there is no parent', { ...doneChild, parentTaskItemId: null }, parents],
    ['the parent is unknown', { ...doneChild, parentTaskItemId: 99 }, parents],
    ['the task itself is open', { ...doneChild, status: 'Todo' as const }, parents],
  ])('does not disable anything when %s', (_label, task, availableParents) => {
    renderForm(task, vi.fn(), vi.fn(), { availableParents })
    expectOpenDisabled(false)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    expect(statusSelect()).not.toHaveAttribute('aria-describedby')
  })

  it('does not apply in create mode', () => {
    renderForm(undefined, vi.fn(), vi.fn(), { availableParents: parents })
    expectOpenDisabled(false)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('re-enables and hides the hint when the parent is cleared, then saves the new status with no parent', async () => {
    const onSubmit = vi.fn()
    renderForm(doneChild, onSubmit, vi.fn(), { availableParents: parents })
    await userEvent.selectOptions(screen.getByLabelText('Parent Task'), '')
    expectOpenDisabled(false)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    await userEvent.selectOptions(statusSelect(), 'todo')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.status).toBe('todo')
    // Omitted/null parent: useUpdateTaskMutation puts `parentTaskItemId ?? null` on the wire.
    expect(payload.parentTaskItemId ?? null).toBeNull()
  })

  it('re-enables when a non-Completed parent is chosen', async () => {
    renderForm(doneChild, vi.fn(), vi.fn(), { availableParents: parents })
    await userEvent.selectOptions(screen.getByLabelText('Parent Task'), '1')
    expectOpenDisabled(false)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })
})

describe('TaskForm parent picker', () => {
  const parents = [
    { id: 1, title: 'Open parent', status: 'Todo' },
    { id: 2, title: 'Done parent', status: 'Completed' },
    { id: 3, title: 'Also done', status: 'completed' },
  ]

  it('disables Completed parents with a visible suffix and keeps open parents enabled', () => {
    renderForm(undefined, vi.fn(), vi.fn(), { availableParents: parents })
    expect(screen.getByRole('option', { name: 'Open parent' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Done parent (completed)' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Also done (completed)' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'None' })).toBeEnabled()
  })

  it('keeps a selected Completed parent enabled and submits it unchanged', async () => {
    const onSubmit = vi.fn()
    renderForm({ ...existing, parentTaskItemId: 2 }, onSubmit, vi.fn(), { availableParents: parents })
    expect(screen.getByRole('option', { name: 'Done parent (completed)' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit.mock.calls[0][0].parentTaskItemId).toBe(2)
  })

  it('disables the Completed parent once another parent is chosen', async () => {
    renderForm({ ...existing, parentTaskItemId: 2 }, vi.fn(), vi.fn(), { availableParents: parents })
    await userEvent.selectOptions(screen.getByLabelText('Parent Task'), '1')
    expect(screen.getByRole('option', { name: 'Done parent (completed)' })).toBeDisabled()
  })

  it('shows a disabled, selected fallback option when the parent is missing from the list', async () => {
    const onSubmit = vi.fn()
    renderForm({ ...existing, parentTaskItemId: 99 }, onSubmit, vi.fn(), { availableParents: parents })
    const fallback = screen.getByRole('option', { name: 'Current parent' }) as HTMLOptionElement
    expect(fallback).toBeDisabled()
    expect(fallback.selected).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit.mock.calls[0][0].parentTaskItemId).toBe(99)
  })

  it('notifies when the parent or status changes', async () => {
    const onParentOrStatusChange = vi.fn()
    renderForm(existing, vi.fn(), vi.fn(), { availableParents: parents, onParentOrStatusChange })
    await userEvent.selectOptions(screen.getByLabelText('Parent Task'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'draft')
    expect(onParentOrStatusChange).toHaveBeenCalledTimes(2)
  })

  describe('planned day', () => {
    const submitted = (onSubmit: ReturnType<typeof vi.fn>) => onSubmit.mock.calls[0][0]

    it('renders for an existing non-completed task and is absent on create', () => {
      const { unmount } = renderForm(existing)
      expect(screen.getByLabelText('Planned day')).toHaveAttribute('type', 'date')
      unmount()
      renderForm()
      expect(screen.queryByLabelText('Planned day')).not.toBeInTheDocument()
    })

    it('is absent when the stored status is Completed', () => {
      renderForm({ ...existing, status: 'Completed' })
      expect(screen.queryByLabelText('Planned day')).not.toBeInTheDocument()
    })

    it('initializes from currentJournalDate and sends no plannedDay key when untouched', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, currentJournalDate: FUTURE }, onSubmit)
      expect(screen.getByLabelText('Planned day')).toHaveValue(FUTURE)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit)).not.toHaveProperty('plannedDay')
    })

    it('sends the new day only after a change', async () => {
      const onSubmit = vi.fn()
      renderForm(existing, onSubmit)
      fireEvent.change(screen.getByLabelText('Planned day'), { target: { value: FUTURE } })
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit).plannedDay).toBe(FUTURE)
    })

    it('sends plannedDay null after Clear and Save', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, currentJournalDate: FUTURE }, onSubmit)
      await userEvent.click(screen.getByRole('button', { name: 'Clear planned day' }))
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(submitted(onSubmit).plannedDay).toBeNull()
    })

    it('treats a field emptied by backspacing a date segment (value "") as an intentional clear', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, currentJournalDate: FUTURE }, onSubmit)
      fireEvent.change(screen.getByLabelText('Planned day'), { target: { value: '' } })
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit).plannedDay).toBeNull()
    })

    it('sends no plannedDay for an unplanned task left empty', async () => {
      const onSubmit = vi.fn()
      renderForm(existing, onSubmit)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit)).not.toHaveProperty('plannedDay')
    })

    it('does not tie Planned day and Due Date together', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, currentJournalDate: FUTURE, dueDate: '2099-05-05' }, onSubmit)
      fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '2099-06-06' } })
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit).dueDate).toBe('2099-06-06')
      expect(submitted(onSubmit)).not.toHaveProperty('plannedDay')
      expect(screen.getByLabelText('Planned day')).toHaveValue(FUTURE)
    })

    it('Clear is only visible with a value, empties the field without submitting and refocuses it', async () => {
      const onSubmit = vi.fn()
      renderForm(existing, onSubmit)
      expect(screen.queryByRole('button', { name: 'Clear planned day' })).not.toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('Planned day'), { target: { value: FUTURE } })
      await userEvent.click(screen.getByRole('button', { name: 'Clear planned day' }))
      expect(screen.getByLabelText('Planned day')).toHaveValue('')
      expect(screen.getByLabelText('Planned day')).toHaveFocus()
      expect(screen.queryByRole('button', { name: 'Clear planned day' })).not.toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('min is today normally and omitted while the stored day is past', () => {
      const { unmount } = renderForm({ ...existing, currentJournalDate: FUTURE })
      expect(screen.getByLabelText('Planned day')).toHaveAttribute('min')
      unmount()
      renderForm({ ...existing, currentJournalDate: PAST })
      expect(screen.getByLabelText('Planned day')).not.toHaveAttribute('min')
    })

    it('an unchanged stored past day is never sent alongside unrelated edits', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, currentJournalDate: PAST }, onSubmit)
      await userEvent.type(screen.getByLabelText(/title/i), ' edited')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(submitted(onSubmit)).not.toHaveProperty('plannedDay')
    })

    it('a changed past day shows an inline error, sends nothing, and the error clears on change', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, currentJournalDate: PAST }, onSubmit)
      const input = screen.getByLabelText('Planned day')
      fireEvent.change(input, { target: { value: PAST_2 } })
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('Pick today or a later day.')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveFocus()
      fireEvent.change(input, { target: { value: FUTURE } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(input).not.toHaveAttribute('aria-invalid')
    })

    it('is disabled with a hint and sends no plannedDay while the live status is Completed', async () => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, currentJournalDate: FUTURE }, onSubmit)
      fireEvent.change(screen.getByLabelText('Planned day'), { target: { value: FUTURE_2 } })
      await userEvent.selectOptions(screen.getByLabelText('Status'), 'completed')
      expect(screen.getByLabelText('Planned day')).toBeDisabled()
      expect(screen.getByText("Completed tasks can't be planned.")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear planned day' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit)).not.toHaveProperty('plannedDay')
    })

    it.each(['Blocked', 'Draft', 'InProgress'] as const)('is enabled and plans a %s task like any open task', async status => {
      const onSubmit = vi.fn()
      renderForm({ ...existing, status, blockedReason: status === 'Blocked' ? 'waiting' : undefined }, onSubmit)
      expect(screen.getByLabelText('Planned day')).toBeEnabled()
      fireEvent.change(screen.getByLabelText('Planned day'), { target: { value: FUTURE } })
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit).plannedDay).toBe(FUTURE)
    })

    it('accepts today as the earliest plannable day', async () => {
      const onSubmit = vi.fn()
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      renderForm(existing, onSubmit)
      fireEvent.change(screen.getByLabelText('Planned day'), { target: { value: today } })
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(submitted(onSubmit).plannedDay).toBe(today)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('resyncs to a refetched stored day and reverts to it when the revert token bumps', () => {
      const task = { ...existing, currentJournalDate: FUTURE }
      const { rerender } = renderForm(task)
      const input = screen.getByLabelText('Planned day')
      rerender(<TaskForm task={{ ...task, currentJournalDate: FUTURE_2 }} onSubmit={vi.fn()} onCancel={vi.fn()} />)
      expect(input).toHaveValue(FUTURE_2)
      fireEvent.change(input, { target: { value: '' } })
      rerender(
        <TaskForm task={{ ...task, currentJournalDate: FUTURE_2 }} plannedDayRevertToken={1} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      )
      expect(input).toHaveValue(FUTURE_2)
    })
  })
})
