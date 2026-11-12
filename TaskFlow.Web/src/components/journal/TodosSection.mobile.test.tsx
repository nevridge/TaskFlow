import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import { render } from '@/test/renderWithToast'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import type { TaskItemResponseDto } from '@/api/journal'
import { __resetCoarsePointerCache } from '@/lib/pointer'

const createTodoMutate = vi.fn()
const toggleTodoMutate = vi.fn()
const editTodoMutate = vi.fn()
const blockTodoMutate = vi.fn()
const unblockTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  journalKeys: {
    all: ['journal'],
    todos: (id: number) => ['journal', id, 'todos'],
    notes: (id: number) => ['journal', id, 'notes'],
  },
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: createTodoMutate, isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: editTodoMutate, isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: blockTodoMutate, isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: unblockTodoMutate, isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))

vi.mock('@/api/journal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/journal')>()),
  removeJournalTodo: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel"><button type="button">panel action</button></div>,
}))

vi.mock('@/lib/journal-utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return { ...actual, todayISO: vi.fn(() => '2026-05-28') }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { removeJournalTodo } from '@/api/journal'
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

// Every location the router visits. The section stays mounted here (no routes), so its focus-return effect adds a
// replace entry without the query string after a navigation: tests look for the full path, not the last entry.
const seen: { visits: { path: string; state: unknown }[] } = { visits: [] }
function Probe() {
  const l = useLocation()
  useEffect(() => {
    seen.visits.push({ path: l.pathname + l.search, state: l.state })
  }, [l])
  return null
}
const sectionUi = () => (
  <>
    <Probe />
    <TodosSection entryId={10} isoDate="2026-05-28" sort="manual" />
  </>
)
const renderSection = () => render(sectionUi())
const opens = () => seen.visits.filter(v => v.path === opened.path)
const titleButton = (name = 'Write tests') => screen.getByRole('button', { name })
const opened = { path: '/tasks/1?edit=1', state: { from: '/journal/05-28-2026', focusTaskId: 1 } }

describe('TodosSection row click opens the todo (#468)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
    seen.visits = []
    load([row({})])
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    __resetCoarsePointerCache()
    window.getSelection()?.removeAllRanges()
    document.body.innerHTML = ''
  })

  it('renders the title as a plain button with no edit-trigger affordance', () => {
    renderSection()
    const btn = titleButton()
    expect(btn).toHaveClass('todo-text')
    expect(btn).not.toHaveClass('edit-trigger')
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveAttribute('data-todo-title', '1')
  })

  it.each([
    ['empty row space', () => document.querySelector('li.todo') as HTMLElement],
    ['the meta line', () => document.querySelector('.todo-subline-meta') as HTMLElement],
    ['the #id', () => screen.getByLabelText('Task 1')],
  ])('clicking %s opens the edit page with the journal origin', async (_name, target) => {
    renderSection()
    await userEvent.click(target())
    expect(opens()).toHaveLength(1)
    expect(opens()[0].state).toEqual(opened.state)
  })

  it.each([true, false])('a title click navigates exactly once (touch=%s)', async touch => {
    setTouch(touch)
    renderSection()
    await userEvent.click(titleButton())
    // Exactly one navigation: the title handler and the row handler must not both fire.
    expect(opens()).toHaveLength(1)
  })

  it('Enter and Space on the focused title open the todo', async () => {
    renderSection()
    titleButton().focus()
    await userEvent.keyboard('{Enter}')
    expect(opens()).toHaveLength(1)
    titleButton().focus()
    await userEvent.keyboard(' ')
    expect(opens()).toHaveLength(2)
  })

  it('double-clicking the title opens the todo and never an inline editor or a PATCH', async () => {
    renderSection()
    await userEvent.dblClick(titleButton())
    expect(document.querySelector('.todo-edit')).toBeNull()
    expect(editTodoMutate).not.toHaveBeenCalled()
  })

  it('the controls act for themselves and do not open the todo', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    expect(toggleTodoMutate).toHaveBeenCalledOnce()
    expect(opens()).toHaveLength(0)
  })

  it('a click while text is selected does not navigate; a plain click after clearing does', () => {
    renderSection()
    const meta = document.querySelector('.todo-subline-meta') as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(titleButton())
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.click(meta, { detail: 1 })
    fireEvent.click(titleButton(), { detail: 1 })
    expect(opens()).toHaveLength(0)
    window.getSelection()?.removeAllRanges()
    fireEvent.click(meta)
    expect(opens()).toHaveLength(1)
  })

  it('Enter or Space on the title (a click with detail 0) opens the todo even while text is selected', () => {
    renderSection()
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('.todo-subline-meta') as HTMLElement)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.click(titleButton(), { detail: 0 })
    expect(opens()).toHaveLength(1)
    window.getSelection()?.removeAllRanges()
  })

  it('Enter in the add input still adds the todo', async () => {
    renderSection()
    await userEvent.type(screen.getByPlaceholderText('Add a TODO and press Enter'), 'Buy milk{Enter}')
    expect(createTodoMutate).toHaveBeenCalledWith('Buy milk', expect.any(Object))
  })

  it('delete hides the row with no confirm dialog and commits after the undo window', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'Remove from day: Write tests' }))
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument()
    expect(removeJournalTodo).not.toHaveBeenCalled()
    await waitFor(() => expect(removeJournalTodo).toHaveBeenCalledWith(10, 1), { timeout: 7000 })
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  }, 10000)

  it('groups badges and row actions in a .todo-subline after the title', () => {
    renderSection()
    const subline = document.querySelector('.todo-subline')!
    expect(subline.querySelector('.todo-subline-meta .todo-badges')).not.toBeNull()
    const actions = subline.querySelector('.todo-subline-actions')!
    expect(within(actions as HTMLElement).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'History',
      'Block',
      'Remove from day: Write tests',
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
    expect(screen.getByRole('button', { name: 'Remove from day: Write tests' })).toBeInTheDocument()
  })

  it('renders the Blocked pill and reason of a Blocked subtask inside its own li.todo-child', () => {
    load([
      row({
        id: 1,
        title: 'Parent',
        status: 'Blocked',
        blockedReason: 'parent reason',
        openChildCount: 1,
      } as Partial<TaskItemResponseDto>),
      row({ id: 2, title: 'Child', status: 'Blocked', blockedReason: 'child reason', parentTaskItemId: 1 }),
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
    expect(within(actions).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['History', 'Remove from day: Waiting'])
  })

  it('Tab order on a Blocked row follows the DOM: History, Remove from day, then the Unblock task badge', async () => {
    load([row({ id: 2, title: 'Waiting', status: 'Blocked', blockedReason: 'r' })])
    renderSection()
    const user = userEvent.setup()
    const focusOrder: (string | null)[] = []
    for (let i = 0; i < 20 && focusOrder.length < 3; i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      const name = el.getAttribute('aria-label')
      if (name === 'History' || name?.startsWith('Remove from day') || name === 'Unblock task') focusOrder.push(name)
    }
    expect(focusOrder).toEqual(['History', 'Remove from day: Waiting', 'Unblock task'])
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
    rerender(sectionUi())
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('section.todos')).toHaveFocus()
  })
})
