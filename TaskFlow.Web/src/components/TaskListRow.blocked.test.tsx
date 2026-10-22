import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TaskListRow } from './TaskListRow'

type Props = Parameters<typeof TaskListRow>[0]
type TaskProp = Props['task']

const todo: TaskProp = { id: 42, title: 'Fix login bug', status: 'Todo', priority: 'High', dueDate: null }
const blocked: TaskProp = {
  ...todo,
  status: 'Blocked',
  blockedReason: 'Waiting on Sam',
  blockedAt: '2026-05-27T10:00:00Z',
  previousStatus: 'Todo',
}

function renderRow(task: TaskProp, extra: Partial<Props> = {}) {
  const onBlock = vi.fn<NonNullable<Props['onBlock']>>().mockResolvedValue(undefined)
  const onUnblock = vi.fn()
  const onEditBlockedReason = vi.fn<NonNullable<Props['onEditBlockedReason']>>().mockResolvedValue(undefined)
  const onStatusCycle = vi.fn()
  render(
    <MemoryRouter>
      <table>
        <tbody>
          <TaskListRow
            task={task}
            onEdit={vi.fn()}
            onHistory={vi.fn()}
            onDelete={vi.fn()}
            onStatusCycle={onStatusCycle}
            onBlock={onBlock}
            onUnblock={onUnblock}
            onEditBlockedReason={onEditBlockedReason}
            {...extra}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  )
  return { onBlock, onUnblock, onEditBlockedReason, onStatusCycle }
}

describe('TaskListRow blocked tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Draft rows have no Block button', () => {
    renderRow({ ...todo, status: 'Draft' })
    expect(screen.queryByRole('button', { name: /^Block task/ })).not.toBeInTheDocument()
  })

  it('Completed rows have no Block button', () => {
    renderRow({ ...todo, status: 'Completed' })
    expect(screen.queryByRole('button', { name: /^Block task/ })).not.toBeInTheDocument()
  })

  it('Todo rows have a Block button labelled with the title', () => {
    renderRow(todo)
    expect(screen.getByRole('button', { name: 'Block task: Fix login bug' })).toBeInTheDocument()
  })

  it('Block opens a focused reason input (maxLength 200) and Enter sends the trimmed reason once', async () => {
    const { onBlock } = renderRow(todo)
    await userEvent.click(screen.getByRole('button', { name: 'Block task: Fix login bug' }))
    const input = screen.getByRole('textbox', { name: 'Blocked reason, optional' })
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('maxlength', '200')
    expect(screen.queryByRole('button', { name: /^Block task/ })).not.toBeInTheDocument()
    await userEvent.type(input, '  Waiting on Sam {Enter}{Enter}')
    expect(onBlock).toHaveBeenCalledTimes(1)
    expect(onBlock).toHaveBeenCalledWith(todo, 'Waiting on Sam')
    expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
  })

  it('Enter with an empty reason still blocks', async () => {
    const { onBlock } = renderRow(todo)
    await userEvent.click(screen.getByRole('button', { name: 'Block task: Fix login bug' }))
    await userEvent.keyboard('{Enter}')
    expect(onBlock).toHaveBeenCalledWith(todo, '')
  })

  it('Escape cancels without blocking and returns focus to the Block button', async () => {
    const { onBlock } = renderRow(todo)
    await userEvent.click(screen.getByRole('button', { name: 'Block task: Fix login bug' }))
    await userEvent.keyboard('{Escape}')
    expect(onBlock).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Block task: Fix login bug' })).toHaveFocus())
  })

  it('blur cancels without blocking', async () => {
    const { onBlock } = renderRow(todo)
    await userEvent.click(screen.getByRole('button', { name: 'Block task: Fix login bug' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), 'typed')
    await userEvent.click(screen.getByRole('link', { name: 'Fix login bug' }))
    expect(onBlock).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
  })

  it('re-opens the input with the typed text when blocking fails', async () => {
    const onBlock = vi.fn().mockRejectedValue(new Error('nope'))
    renderRow(todo, { onBlock })
    await userEvent.click(screen.getByRole('button', { name: 'Block task: Fix login bug' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), 'Waiting{Enter}')
    const input = await screen.findByRole('textbox', { name: 'Blocked reason, optional' })
    expect(input).toHaveValue('Waiting')
    expect(input).toHaveFocus()
  })

  it('Blocked rows show an Unblock badge button instead of the status cycle control', async () => {
    const { onUnblock, onStatusCycle } = renderRow(blocked)
    const badge = screen.getByRole('button', { name: 'Unblock task: Fix login bug' })
    expect(badge).toHaveTextContent(/blocked/i)
    expect(screen.queryByRole('button', { name: /Click to change/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Block task/ })).not.toBeInTheDocument()
    await userEvent.click(badge)
    expect(onUnblock).toHaveBeenCalledWith(blocked)
    expect(onStatusCycle).not.toHaveBeenCalled()
  })

  it('marks Blocked rows with the row modifier', () => {
    renderRow(blocked)
    expect(screen.getByRole('link', { name: 'Fix login bug' }).closest('tr')?.className).toContain('t-row--blocked')
  })

  it('shows the reason with the full text in the title', () => {
    renderRow(blocked)
    expect(screen.getByText('Waiting on Sam')).toHaveAttribute('title', 'Waiting on Sam')
  })

  it('double-click edits the reason and Enter saves it', async () => {
    const { onEditBlockedReason } = renderRow(blocked)
    await userEvent.dblClick(screen.getByText('Waiting on Sam'))
    const input = screen.getByRole('textbox', { name: 'Blocked reason, optional' })
    expect(input).toHaveValue('Waiting on Sam')
    await userEvent.clear(input)
    await userEvent.type(input, 'Waiting on Alex{Enter}')
    expect(onEditBlockedReason).toHaveBeenCalledWith(blocked, 'Waiting on Alex')
  })

  it('Escape cancels the reason edit without saving', async () => {
    const { onEditBlockedReason } = renderRow(blocked)
    await userEvent.dblClick(screen.getByText('Waiting on Sam'))
    await userEvent.keyboard('{Escape}')
    expect(onEditBlockedReason).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
  })

  it('keeps Block hidden when no block handler is supplied', () => {
    renderRow(todo, { onBlock: undefined })
    expect(screen.queryByRole('button', { name: /^Block task/ })).not.toBeInTheDocument()
  })
})
