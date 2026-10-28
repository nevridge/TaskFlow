import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TaskItemResponseDto } from '@/api/journal'
import { __resetCoarsePointerCache } from '@/lib/pointer'

const createTodoMutate = vi.fn()
const toggleTodoMutate = vi.fn()
const editTodoMutate = vi.fn()
const removeTodoMutate = vi.fn()
const blockTodoMutate = vi.fn()
const unblockTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: createTodoMutate, isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: editTodoMutate, isPending: false })),
  useRemoveTodoMutation: vi.fn(() => ({ mutate: removeTodoMutate, isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: blockTodoMutate, isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: unblockTodoMutate, isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel"><button type="button">panel action</button></div>,
}))

vi.mock('@/lib/journal-utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return { ...actual, todayISO: vi.fn(() => '2026-05-28') }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { TodosSection } from './TodosSection'

function row(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Write tests', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}

function load(rows: TaskItemResponseDto[]) {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
}

function setTouch(touch: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: touch }),
    configurable: true,
    writable: true,
  })
  __resetCoarsePointerCache()
}

const renderSection = () => render(<TodosSection entryId={10} isoDate="2026-05-28" sort="manual" />)
const titleButton = (name = 'Write tests') => screen.getByRole('button', { name })

describe('TodosSection title tap-to-edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
    load([row({})])
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    document.body.innerHTML = ''
  })

  it('renders the title as button.edit-trigger.todo-text', () => {
    renderSection()
    const btn = titleButton()
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveClass('edit-trigger', 'todo-text')
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('touch: a single tap enters edit mode once, even for a double-tap', async () => {
    setTouch(true)
    renderSection()
    await userEvent.dblClick(titleButton())
    expect(screen.getAllByDisplayValue('Write tests')).toHaveLength(1)
  })

  it('desktop: a single click does nothing and a double-click edits', async () => {
    setTouch(false)
    renderSection()
    await userEvent.click(titleButton())
    expect(screen.queryByDisplayValue('Write tests')).not.toBeInTheDocument()
    await userEvent.dblClick(titleButton())
    expect(screen.getByDisplayValue('Write tests')).toBeInTheDocument()
  })

  it.each([true, false])('Enter and Space on the focused title edit (touch=%s)', async touch => {
    setTouch(touch)
    renderSection()
    titleButton().focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByDisplayValue('Write tests')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    titleButton().focus()
    await userEvent.keyboard(' ')
    expect(screen.getByDisplayValue('Write tests')).toBeInTheDocument()
  })

  it('tapping the check or a row button does not enter edit mode', async () => {
    setTouch(true)
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    expect(document.querySelector('.todo-edit')).toBeNull()
  })

  it('Enter saves exactly once even with a following blur, and focus returns to the title', async () => {
    setTouch(false)
    renderSection()
    await userEvent.dblClick(titleButton())
    const input = screen.getByDisplayValue('Write tests')
    await userEvent.clear(input)
    await userEvent.type(input, '  New title {Enter}')
    fireEvent.blur(input)
    expect(editTodoMutate).toHaveBeenCalledTimes(1)
    expect(editTodoMutate).toHaveBeenCalledWith({ id: 1, title: 'New title' })
    await waitFor(() => expect(titleButton()).toHaveFocus())
  })

  it('Enter on a row that then re-sorts (non-manual sort) still ends with focus on that title', async () => {
    setTouch(false)
    const alpha = row({ id: 1, title: 'Alpha' })
    const beta = row({ id: 2, title: 'Beta' })
    load([alpha, beta])
    const view = render(<TodosSection entryId={10} isoDate="2026-05-28" sort="open first" />)
    await userEvent.dblClick(titleButton('Alpha'))
    await userEvent.type(screen.getByDisplayValue('Alpha'), '{Enter}')
    // The optimistic update lands after the Enter: Alpha becomes Completed and moves below Beta.
    load([{ ...alpha, status: 'Completed' } as TaskItemResponseDto, beta])
    view.rerender(<TodosSection entryId={10} isoDate="2026-05-28" sort="open first" />)
    const titles = Array.from(document.querySelectorAll('[data-todo-title]')).map(el => el.textContent)
    expect(titles).toEqual(['Beta', 'Alpha'])
    await waitFor(() => expect(titleButton('Alpha')).toHaveFocus())
  })

  it('a newer title focus request wins over a pending check focus request on another row', async () => {
    setTouch(false)
    load([row({ id: 1, title: 'Alpha' }), row({ id: 2, title: 'Waiting', status: 'Blocked', blockedReason: 'r' })])
    renderSection()
    // Unblock requests focus on row 2's check; the later Enter on row 1 then requests focus on its title.
    fireEvent.click(screen.getByRole('button', { name: 'Unblock task' }))
    await userEvent.dblClick(titleButton('Alpha'))
    await userEvent.type(screen.getByDisplayValue('Alpha'), '{Enter}')
    await waitFor(() => expect(titleButton('Alpha')).toHaveFocus())
    await new Promise(r => setTimeout(r, 150))
    expect(titleButton('Alpha')).toHaveFocus()
  })

  it('Escape then blur does not save, and focus returns to the title', async () => {
    setTouch(false)
    renderSection()
    await userEvent.dblClick(titleButton())
    const input = screen.getByDisplayValue('Write tests')
    await userEvent.type(input, ' changed{Escape}')
    fireEvent.blur(input)
    expect(editTodoMutate).not.toHaveBeenCalled()
    await waitFor(() => expect(titleButton()).toHaveFocus())
  })

  it('blur commits once when neither Enter nor Escape fired', async () => {
    setTouch(true)
    renderSection()
    await userEvent.click(titleButton())
    await userEvent.type(screen.getByDisplayValue('Write tests'), '!')
    await userEvent.click(screen.getByPlaceholderText('Add a TODO and press Enter'))
    expect(editTodoMutate).toHaveBeenCalledTimes(1)
    expect(editTodoMutate).toHaveBeenCalledWith({ id: 1, title: 'Write tests!' })
  })

  it('an empty or whitespace title is not saved', async () => {
    setTouch(false)
    renderSection()
    await userEvent.dblClick(titleButton())
    const input = screen.getByDisplayValue('Write tests')
    await userEvent.clear(input)
    await userEvent.type(input, '   {Enter}')
    expect(editTodoMutate).not.toHaveBeenCalled()
    expect(titleButton()).toBeInTheDocument()
  })

  it('a second edit after a cancelled one can still save (guard resets)', async () => {
    setTouch(false)
    renderSection()
    await userEvent.dblClick(titleButton())
    await userEvent.keyboard('{Escape}')
    await userEvent.dblClick(titleButton())
    await userEvent.type(screen.getByDisplayValue('Write tests'), '2{Enter}')
    expect(editTodoMutate).toHaveBeenCalledWith({ id: 1, title: 'Write tests2' })
  })

  it('the edit input asks for a Done key on soft keyboards', async () => {
    setTouch(true)
    renderSection()
    await userEvent.click(titleButton())
    expect(screen.getByDisplayValue('Write tests')).toHaveAttribute('enterkeyhint', 'done')
  })

  it('Enter in the add input still adds the todo', async () => {
    renderSection()
    await userEvent.type(screen.getByPlaceholderText('Add a TODO and press Enter'), 'Buy milk{Enter}')
    expect(createTodoMutate).toHaveBeenCalledWith('Buy milk', expect.any(Object))
  })

  it('delete is immediate with no confirm dialog', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(removeTodoMutate).toHaveBeenCalledWith(1)
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('groups badges and row actions in a .todo-subline after the title', () => {
    renderSection()
    const subline = document.querySelector('.todo-subline')!
    expect(subline.querySelector('.todo-subline-meta .todo-badges')).not.toBeNull()
    const actions = subline.querySelector('.todo-subline-actions')!
    expect(within(actions as HTMLElement).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'History',
      'Block',
      'Delete',
    ])
  })

  it('places the actions before the metadata inside .todo-subline', () => {
    renderSection()
    const subline = document.querySelector('.todo-subline')!
    const actions = subline.querySelector('.todo-subline-actions')!
    const meta = subline.querySelector('.todo-subline-meta')!
    expect(actions.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('renders the Blocked pill and reason of a Blocked subtask inside its own li.todo-child', () => {
    load([
      row({
        id: 1,
        title: 'Parent',
        status: 'Blocked',
        blockedReason: 'parent reason',
        children: [row({ id: 2, title: 'Child', status: 'Blocked', blockedReason: 'child reason', parentTaskItemId: 1 })],
      } as Partial<TaskItemResponseDto>),
    ])
    renderSection()
    const child = document.querySelector('li.todo-child') as HTMLElement
    expect(child).not.toBeNull()
    expect(child.querySelector('.todo-blocked-badge')).not.toBeNull()
    expect(within(child).getByText('Blocked')).toBeInTheDocument()
    const reason = child.querySelector('.todo-block-reason')
    expect(reason).not.toBeNull()
    expect(reason).toHaveTextContent('child reason')
  })
})

describe('TodosSection blocked unblock badge and touch block editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    document.body.innerHTML = ''
  })

  it('a Blocked row has no Block button, so its row actions are History and Delete only', () => {
    load([row({ id: 2, title: 'Waiting', status: 'Blocked', blockedReason: 'r' })])
    renderSection()
    const actions = document.querySelector('.todo-subline-actions') as HTMLElement
    expect(within(actions).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['History', 'Delete'])
  })

  it('Tab order on a Blocked row follows the DOM: History, Delete, then the Unblock task badge', async () => {
    load([row({ id: 2, title: 'Waiting', status: 'Blocked', blockedReason: 'r' })])
    renderSection()
    const user = userEvent.setup()
    const focusOrder: (string | null)[] = []
    for (let i = 0; i < 20 && focusOrder.length < 3; i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      const name = el.getAttribute('aria-label')
      if (name === 'History' || name === 'Delete' || name === 'Unblock task') focusOrder.push(name)
    }
    expect(focusOrder).toEqual(['History', 'Delete', 'Unblock task'])
    expect(screen.getByRole('button', { name: 'Unblock task' })).toHaveFocus()
  })

  it('the badge is named exactly "Unblock task"; the old name no longer matches', async () => {
    load([row({ id: 2, title: 'Waiting', status: 'Blocked', blockedReason: 'r' })])
    renderSection()
    expect(screen.queryByRole('button', { name: 'Unblock' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Unblock task' }))
    expect(unblockTodoMutate).toHaveBeenCalledWith({ id: 2 }, expect.any(Object))
  })

  it('touch: blur keeps the block editor open, Save blocks with the trimmed reason', async () => {
    setTouch(true)
    load([row({})])
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    const input = screen.getByRole('textbox', { name: 'Blocked reason, optional' })
    await userEvent.type(input, ' Waiting ')
    await userEvent.click(screen.getByPlaceholderText('Add a TODO and press Enter'))
    expect(screen.getByRole('textbox', { name: 'Blocked reason, optional' })).toHaveValue(' Waiting ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(blockTodoMutate).toHaveBeenCalledWith({ id: 1, reason: 'Waiting' }, expect.any(Object))
  })

  it('touch: Cancel closes the editor without blocking', async () => {
    setTouch(true)
    load([row({})])
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(blockTodoMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
  })

  it('touch: a failed block re-opens the editor with the draft and Save/Cancel', async () => {
    setTouch(true)
    load([row({})])
    blockTodoMutate.mockImplementation((_vars, opts: { onError: (e: unknown) => void; onSettled: () => void }) => {
      setTimeout(() => {
        opts.onError({ code: 'TASK_BLOCK_DRAFT_NOT_ALLOWED' })
        opts.onSettled()
      }, 0)
    })
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), 'Waiting{Enter}')
    const input = await screen.findByRole('textbox', { name: 'Blocked reason, optional' })
    expect(input).toHaveValue('Waiting')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('touch: tapping the blocked reason enters edit mode', async () => {
    setTouch(true)
    load([row({ id: 2, title: 'Waiting', status: 'Blocked', blockedReason: 'Waiting on Sam' })])
    renderSection()
    await userEvent.click(screen.getByText('Waiting on Sam'))
    expect(screen.getByRole('textbox', { name: 'Blocked reason, optional' })).toHaveValue('Waiting on Sam')
  })
})

describe('TodosSection history sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
    load([row({})])
  })
  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  async function openSheet() {
    const trigger = screen.getByRole('button', { name: 'History' })
    await userEvent.click(trigger)
    return { trigger, dialog: screen.getByRole('dialog') }
  }

  it('is a labelled modal dialog carrying both sheet and j-modal classes', async () => {
    renderSection()
    const { dialog } = await openSheet()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')!
    expect(document.getElementById(labelledBy)).toHaveTextContent('Task history')
    expect(dialog).toHaveClass('sheet', 'j-modal')
    expect(dialog.querySelector('.sheet-header.j-modal-header')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('sheet-close', 'j-modal-close')
    expect(document.querySelector('.sheet-backdrop.j-modal-backdrop')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('moves initial focus to Close and wraps Tab and Shift+Tab inside the dialog', async () => {
    renderSection()
    await openSheet()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'panel action' })).toHaveFocus()
    await userEvent.tab()
    expect(close).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'panel action' })).toHaveFocus()
  })

  it.each(['Escape', 'Close', 'backdrop'])('closes on %s and returns focus to the History trigger', async how => {
    renderSection()
    const { trigger } = await openSheet()
    if (how === 'Escape') await userEvent.keyboard('{Escape}')
    else if (how === 'Close') await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    else fireEvent.click(document.querySelector('.sheet-backdrop')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('falls back to the section when the trigger row has been removed', async () => {
    const { rerender } = renderSection()
    await openSheet()
    load([])
    rerender(<TodosSection entryId={10} isoDate="2026-05-28" sort="manual" />)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('section.todos')).toHaveFocus()
  })
})
