import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  id: 7, title: 'Existing task', description: 'Some desc', status: 'Todo' as const, priority: 'Medium' as const, isComplete: false,
}

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

  it('pre-fills fields when editing an existing task', () => {
    const task = {
      id: 1, title: 'Existing task', description: 'Some desc', status: 'todo', priority: 'medium', isComplete: false,
    }
    renderForm(task)
    expect(screen.getByDisplayValue('Existing task')).toBeInTheDocument()
  })

  it('calls onSubmit with form data when submitted', async () => {
    const onSubmit = vi.fn()
    renderForm(undefined, onSubmit)
    await userEvent.type(screen.getByLabelText(/title/i), 'New task')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'New task' }))
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

    it('tab order is Due Date, Project, Parent Task', async () => {
      renderForm(undefined, vi.fn(), vi.fn(), { projects })
      screen.getByLabelText('Due Date').focus()
      await userEvent.tab()
      expect(projectSelect()).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByLabelText('Parent Task')).toHaveFocus()
    })

    it('works with no projects prop', () => {
      renderForm()
      expect(optionLabels()).toEqual(['No project'])
    })
  })
})
