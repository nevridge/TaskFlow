import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { TaskListRow } from './TaskListRow'
import { __resetCoarsePointerCache } from '@/lib/pointer'

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

type TaskProp = Parameters<typeof TaskListRow>[0]['task']
type TaskHandler = Parameters<typeof TaskListRow>[0]['onEdit']

const baseTask: TaskProp = {
  id: 42,
  title: 'Fix login bug',
  description: 'Users cannot log in',
  status: 'Todo',
  priority: 'high',
  dueDate: null,
}

function renderRow(
  task: TaskProp = baseTask,
  overrides: {
    onEdit?: TaskHandler
    onDelete?: TaskHandler
    onStatusCycle?: TaskHandler
  } = {},
) {
  const onEdit = overrides.onEdit ?? vi.fn()
  const onDelete = overrides.onDelete ?? vi.fn()
  const onStatusCycle = overrides.onStatusCycle ?? vi.fn()
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <TaskListRow
            task={task}
            onEdit={onEdit}
            onHistory={vi.fn<TaskHandler>()}
            onDelete={onDelete}
            onStatusCycle={onStatusCycle}
          />
        </tbody>
      </table>
    </MemoryRouter>
  )
}

describe('TaskListRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('task id', () => {
    it('shows #id with an accessible label before the title', () => {
      renderRow()
      const badge = screen.getByRole('img', { name: 'Task 42' })
      expect(badge).toHaveTextContent('#42')
      const link = screen.getByRole('link', { name: 'Fix login bug' })
      expect(link).toHaveAttribute('href', '/tasks/42')
      expect(badge.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(link.contains(badge)).toBe(false)
      expect(screen.queryByText('42')).toBeNull()
    })

    it('shows the subtask own id, not the parent id', () => {
      renderRow({ ...baseTask, id: 43, title: 'Child', parentTaskItemId: 42 })
      expect(screen.getByText('#43')).toBeInTheDocument()
      expect(screen.queryByText('#42')).toBeNull()
    })

    it.each(['Completed', 'Blocked'])('still shows the id on %s rows', status => {
      renderRow({ ...baseTask, status })
      expect(screen.getByRole('img', { name: 'Task 42' })).toBeInTheDocument()
    })

    it('renders nothing when the id is undefined', () => {
      renderRow({ ...baseTask, id: undefined })
      expect(screen.queryByRole('img')).toBeNull()
      expect(screen.queryByText(/#/)).toBeNull()
    })

    it('renders nothing and no error when the id is null', () => {
      const { container } = renderRow({ ...baseTask, id: null as never })
      expect(screen.queryByRole('img')).toBeNull()
      expect(container.querySelector('.t-task-id')).toBeNull()
      expect(screen.queryByText(/#/)).toBeNull()
      expect(screen.getByRole('link', { name: 'Fix login bug' })).toBeInTheDocument()
    })

    it('clicking the id does not navigate or fire row handlers', async () => {
      const onEdit = vi.fn()
      const onStatusCycle = vi.fn()
      render(
        <MemoryRouter initialEntries={['/tasks']}>
          <LocationProbe />
          <table>
            <tbody>
              <TaskListRow
                task={baseTask}
                onEdit={onEdit}
                onHistory={vi.fn<TaskHandler>()}
                onDelete={vi.fn<TaskHandler>()}
                onStatusCycle={onStatusCycle}
              />
            </tbody>
          </table>
        </MemoryRouter>
      )

      await userEvent.click(screen.getByRole('img', { name: 'Task 42' }))

      expect(screen.getByTestId('location')).toHaveTextContent('/tasks')
      expect(screen.getByTestId('location')).not.toHaveTextContent('/tasks/42')
      expect(onEdit).not.toHaveBeenCalled()
      expect(onStatusCycle).not.toHaveBeenCalled()
    })

    it('is not focusable and does not change the row tab stops', () => {
      const tabStops = (root: HTMLElement) =>
        root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length

      const withId = renderRow()
      const badge = screen.getByRole('img', { name: 'Task 42' })
      expect(badge).not.toHaveAttribute('tabindex')
      expect(badge.matches('a, button, input, [tabindex]')).toBe(false)
      const countWithId = tabStops(withId.container)
      withId.unmount()

      const withoutId = renderRow({ ...baseTask, id: undefined })
      expect(tabStops(withoutId.container)).toBe(countWithId)
    })

    it.each([
      ['7', '#7'],
      [123456, '#123456'],
      [0, '#0'],
    ])('renders id %s as %s', (id, text) => {
      renderRow({ ...baseTask, id })
      expect(screen.getByText(text)).toBeInTheDocument()
    })
  })

  it('renders the task title as a link', () => {
    renderRow()
    expect(screen.getByRole('link', { name: 'Fix login bug' })).toBeInTheDocument()
  })

  it('renders status and priority badges', () => {
    renderRow()
    expect(screen.getByText('To-do')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('calls onEdit when edit button is clicked', async () => {
    const onEdit = vi.fn()
    renderRow(baseTask, { onEdit })
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(baseTask)
  })

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn()
    renderRow(baseTask, { onDelete })
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith(baseTask)
  })

  it('calls onStatusCycle when status badge is clicked', async () => {
    const onStatusCycle = vi.fn()
    renderRow(baseTask, { onStatusCycle })
    await userEvent.click(screen.getByRole('button', { name: /to-do/i }))
    expect(onStatusCycle).toHaveBeenCalledWith(baseTask)
  })

  it('shows formatted due date when present', () => {
    const task = { ...baseTask, dueDate: '2026-06-15T12:00:00Z' }
    renderRow(task)
    expect(screen.getByText(/Jun 15, 2026/)).toBeInTheDocument()
  })

  it('shows em dash when no due date', () => {
    renderRow({ ...baseTask, dueDate: null })
    expect(screen.getByText('—', { selector: '.t-list-cell--due .t-list-empty' })).toBeInTheDocument()
  })

  it('renders unaffected when only childTaskCount is present (no childCount field)', () => {
    const task = { ...baseTask, childTaskCount: 3 }
    renderRow(task)
    expect(screen.getByRole('link', { name: 'Fix login bug' })).toBeInTheDocument()
    expect(screen.getByText('To-do')).toBeInTheDocument()

    // @ts-expect-error childCount was removed from TaskRowModel — this must fail to compile
    // if the field is ever reintroduced, since the component never reads it at runtime.
    const withRemovedField: TaskProp = { ...baseTask, childCount: 3 }
    expect(withRemovedField).toBeTruthy()
  })

  describe('overdue indicator', () => {
    const pastDate = '2020-01-01T00:00:00Z'

    it('marks past-due incomplete tasks as overdue', () => {
      const task = { ...baseTask, dueDate: pastDate, status: 'Todo' }
      renderRow(task)
      expect(screen.getByText('!', { selector: '.t-overdue-icon' })).toBeInTheDocument()
    })

    it('does not mark completed tasks as overdue even if past due', () => {
      const task = { ...baseTask, dueDate: pastDate, status: 'Completed' }
      renderRow(task)
      expect(screen.queryByText('!', { selector: '.t-overdue-icon' })).not.toBeInTheDocument()
    })

    it('does not mark future tasks as overdue', () => {
      const task = { ...baseTask, dueDate: '2099-12-31T00:00:00Z', status: 'Todo' }
      renderRow(task)
      expect(screen.queryByText('!', { selector: '.t-overdue-icon' })).not.toBeInTheDocument()
    })
  })

  describe('project badge', () => {
    it('shows the project name in the title cell without adding a column', () => {
      const { container } = renderRow({ ...baseTask, projectId: 3, projectName: 'Alpha Launch' })
      const badge = screen.getByText('Alpha Launch')
      expect(badge).toHaveClass('t-badge-project')
      expect(badge).toHaveAttribute('title', 'Alpha Launch')
      expect(badge.closest('td')).toHaveClass('t-list-cell--title')
      expect(container.querySelectorAll('td')).toHaveLength(5)
    })

    it('keeps the full name in the title for long names', () => {
      const longName = 'An extremely long project name that must be truncated in a table cell'
      renderRow({ ...baseTask, projectId: 3, projectName: longName })
      expect(screen.getByText(longName)).toHaveAttribute('title', longName)
    })

    it.each([
      ['null project', { projectId: null, projectName: null }],
      ['empty name', { projectId: 3, projectName: '' }],
      ['undefined project', {}],
      ['projectId without a name', { projectId: '3', projectName: null }],
    ])('renders no badge for %s', (_label, extra) => {
      const { container } = renderRow({ ...baseTask, ...extra })
      expect(container.querySelector('.t-badge-project')).toBeNull()
      expect(container.querySelectorAll('td')).toHaveLength(5)
    })
  })

  describe('mobile row (#317)', () => {
    type Props = Parameters<typeof TaskListRow>[0]

    function renderFull(task: TaskProp, extra: Partial<Props> = {}) {
      const handlers = {
        onEdit: vi.fn(),
        onHistory: vi.fn(),
        onDelete: vi.fn(),
        onStatusCycle: vi.fn(),
        onAddChild: vi.fn(),
        onBlock: vi.fn().mockResolvedValue(undefined),
        onUnblock: vi.fn(),
        onEditBlockedReason: vi.fn().mockResolvedValue(undefined),
      }
      render(
        <MemoryRouter>
          <table role="table">
            <tbody role="rowgroup">
              <TaskListRow task={task} {...handlers} {...extra} />
            </tbody>
          </table>
        </MemoryRouter>,
      )
      return handlers
    }

    function setTouch(touch: boolean) {
      Object.defineProperty(window, 'matchMedia', {
        value: vi.fn().mockReturnValue({ matches: touch }),
        configurable: true,
        writable: true,
      })
      __resetCoarsePointerCache()
    }

    const rowActions = () =>
      within(screen.getByRole('row')).getAllByRole('button').filter(b => b.closest('.t-card-actions'))

    beforeEach(() => {
      vi.clearAllMocks()
      __resetCoarsePointerCache()
    })
    afterEach(() => {
      Reflect.deleteProperty(window, 'matchMedia')
      __resetCoarsePointerCache()
    })

    it('shows child progress, blocked reason, deferral and project in full (AC4)', () => {
      renderFull(
        {
          ...baseTask,
          status: 'Blocked',
          blockedReason: 'Waiting on the vendor to reply about the contract',
          projectName: 'Alpha Launch',
          moveCount: 2,
          daysTagged: 3,
        } as TaskProp,
        { childProgress: '1/3 subtasks complete, 1 blocked' },
      )
      expect(screen.getByText('1/3 subtasks complete, 1 blocked')).toBeInTheDocument()
      expect(screen.getByText('Waiting on the vendor to reply about the contract')).toBeInTheDocument()
      expect(screen.getByText(/Moved 2/)).toHaveTextContent('Moved 2 · Tagged 3 days')
      expect(screen.getByText('Alpha Launch')).toBeInTheDocument()
    })

    it('orders actions Add subtask, Block, History, Edit, Delete with labels and no visible text (AC7)', () => {
      renderFull(baseTask)
      const actions = rowActions()
      expect(actions.map(b => b.getAttribute('aria-label'))).toEqual([
        'Add subtask',
        'Block task: Fix login bug',
        'Task history',
        'Edit',
        'Delete task: Fix login bug',
      ])
      actions.forEach(b => expect(b).toHaveTextContent(''))
    })

    it('has four actions and no Block slot on non-Todo rows (AC7)', () => {
      renderFull({ ...baseTask, status: 'Completed' })
      expect(rowActions().map(b => b.getAttribute('aria-label'))).toEqual(['Add subtask', 'Task history', 'Edit', 'Delete task: Fix login bug'])
    })

    it('exposes table, row, cell and columnheader semantics (AC11)', () => {
      const { container } = render(
        <MemoryRouter>
          <table role="table">
            <thead role="rowgroup">
              <tr role="row"><th role="columnheader">Title</th></tr>
            </thead>
            <tbody role="rowgroup">
              <TaskListRow task={baseTask} onEdit={vi.fn()} onHistory={vi.fn()} onDelete={vi.fn()} onStatusCycle={vi.fn()} />
            </tbody>
          </table>
        </MemoryRouter>,
      )
      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getAllByRole('row')).toHaveLength(2)
      expect(screen.getByRole('columnheader', { name: 'Title' })).toBeInTheDocument()
      expect(screen.getAllByRole('cell')).toHaveLength(5)
      expect(container.querySelectorAll('tr:not([role="row"]), td:not([role="cell"])')).toHaveLength(0)
    })

    it('marks the Edit button with the task id for focus return', () => {
      renderFull(baseTask)
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('data-task-edit-id', '42')
    })

    it('gives the status control the tap-target class (AC13)', () => {
      renderFull(baseTask)
      expect(screen.getByRole('button', { name: /^Status: To-do/ })).toHaveClass('tap-target', 't-status-btn')
    })

    it('gives the Blocked unblock button the tap-target class (AC13)', () => {
      renderFull({ ...baseTask, status: 'Blocked', blockedReason: 'x' })
      expect(screen.getByRole('button', { name: 'Unblock task: Fix login bug' })).toHaveClass('tap-target', 't-status-btn')
    })

    it('cycles status once on Enter (AC14)', async () => {
      const { onStatusCycle } = renderFull(baseTask)
      screen.getByRole('button', { name: /^Status: To-do/ }).focus()
      await userEvent.keyboard('{Enter}')
      expect(onStatusCycle).toHaveBeenCalledTimes(1)
      expect(onStatusCycle).toHaveBeenCalledWith(baseTask)
    })

    it('cycles status once on Space (AC14)', async () => {
      const { onStatusCycle } = renderFull(baseTask)
      screen.getByRole('button', { name: /^Status: To-do/ }).focus()
      await userEvent.keyboard(' ')
      expect(onStatusCycle).toHaveBeenCalledTimes(1)
    })

    it('opens the reason editor on a single tap on touch (AC15)', async () => {
      setTouch(true)
      renderFull({ ...baseTask, status: 'Blocked', blockedReason: 'Waiting on Sam' })
      await userEvent.click(screen.getByRole('button', { name: 'Blocked reason: Waiting on Sam. Edit' }))
      expect(screen.getByRole('textbox', { name: 'Blocked reason, optional' })).toBeInTheDocument()
    })

    it('keeps a mouse single click from opening the reason editor', async () => {
      setTouch(false)
      renderFull({ ...baseTask, status: 'Blocked', blockedReason: 'Waiting on Sam' })
      await userEvent.click(screen.getByRole('button', { name: 'Blocked reason: Waiting on Sam. Edit' }))
      expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
    })

    it('renders the spacer instead of the toggle for rows without children', () => {
      renderFull(baseTask, { depth: 1 })
      expect(screen.queryByRole('button', { name: /subtasks/ })).not.toBeInTheDocument()
      expect(document.querySelector('.t-depth-1 .t-tree-spacer')).not.toBeNull()
    })

    it('Delete calls onDelete and carries the id used for focus handling', async () => {
      const { onDelete } = renderFull({ ...baseTask, id: 7 })
      const btn = screen.getByRole('button', { name: 'Delete task: Fix login bug' })
      expect(btn).toHaveAttribute('data-task-delete-id', '7')
      expect(btn).not.toHaveAttribute('aria-disabled')
      await userEvent.click(btn)
      expect(onDelete).toHaveBeenCalledWith({ ...baseTask, id: 7 })
    })

    describe('parent with subtasks (#321)', () => {
      const parent = { ...baseTask, id: 9, childTaskCount: 2 } as TaskProp

      it('is aria-disabled, never disabled, tabbable and described by the hidden hint', () => {
        renderFull(parent)
        const btn = screen.getByRole('button', { name: 'Delete task: Fix login bug' })
        expect(btn).toHaveAttribute('aria-disabled', 'true')
        expect(btn).not.toBeDisabled()
        expect(btn).toHaveAttribute('title', 'Delete subtasks first (2)')
        expect(btn).toHaveAccessibleDescription('Delete subtasks first (2)')
        const hint = document.getElementById('del-hint-9')!
        expect(hint).toHaveClass('sr-only')
        // The hint is a sibling of the button, not inside it.
        expect(btn.contains(hint)).toBe(false)
        btn.focus()
        expect(btn).toHaveFocus()
      })

      it('does nothing on click, Enter or Space', async () => {
        const { onDelete } = renderFull(parent)
        const btn = screen.getByRole('button', { name: 'Delete task: Fix login bug' })
        await userEvent.click(btn)
        btn.focus()
        await userEvent.keyboard('{Enter}')
        await userEvent.keyboard(' ')
        expect(onDelete).not.toHaveBeenCalled()
      })

      it('is enabled when there are no subtasks', () => {
        renderFull({ ...baseTask, childTaskCount: 0 } as TaskProp)
        const btn = screen.getByRole('button', { name: 'Delete task: Fix login bug' })
        expect(btn).not.toHaveAttribute('aria-disabled')
        expect(btn).not.toHaveAttribute('aria-describedby')
        expect(btn).toHaveAttribute('title', 'Delete')
      })
    })
  })
})
