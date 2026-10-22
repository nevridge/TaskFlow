import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TaskItemResponseDto } from '@/api/journal'

const toggleTodoMutate = vi.fn()
const blockTodoMutate = vi.fn()
const unblockTodoMutate = vi.fn()
const editReasonMutate = vi.fn()
const removeTodoMutate = vi.fn()

vi.mock('@/hooks/useJournal', () => ({
  useJournalTodos: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCreateTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useToggleTodoMutation: vi.fn(() => ({ mutate: toggleTodoMutate, isPending: false })),
  useEditTodoMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveTodoMutation: vi.fn(() => ({ mutate: removeTodoMutate, isPending: false })),
  useBlockTodoMutation: vi.fn(() => ({ mutate: blockTodoMutate, isPending: false })),
  useUnblockTodoMutation: vi.fn(() => ({ mutate: unblockTodoMutate, isPending: false })),
  useEditBlockedReasonTodoMutation: vi.fn(() => ({ mutate: editReasonMutate, isPending: false })),
  openTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status !== 'Completed').length),
  blockedTodoCount: vi.fn((todos: TaskItemResponseDto[]) => todos.filter(t => t.status === 'Blocked').length),
}))

vi.mock('@/components/TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div data-testid="history-panel" />,
}))

vi.mock('@/lib/journal-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/journal-utils')>()
  return { ...actual, todayISO: vi.fn(() => '2026-05-28') }
})

import { useJournalTodos } from '@/hooks/useJournal'
import { TodosSection } from './TodosSection'

function row(overrides: Partial<TaskItemResponseDto>): TaskItemResponseDto {
  return { id: 1, title: 'Write tests', status: 'Todo', priority: 'low', description: null, dueDate: null, ...overrides } as TaskItemResponseDto
}

const todoRow = row({})
const blockedRow = row({
  id: 2,
  title: 'Waiting task',
  status: 'Blocked',
  blockedReason: 'Waiting on Sam',
  blockedAt: '2026-05-27T10:00:00Z',
  previousStatus: 'Todo',
})

function load(rows: TaskItemResponseDto[]) {
  vi.mocked(useJournalTodos).mockReturnValue({ data: { data: rows }, isLoading: false } as never)
}

function renderSection(sort: 'manual' | 'open first' | 'done last' = 'manual') {
  return render(<TodosSection entryId={10} isoDate="2026-05-28" sort={sort} />)
}

function titles() {
  return Array.from(document.querySelectorAll('.todo-list > .todo > .todo-text')).map(n => n.textContent)
}

describe('TodosSection blocked tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    load([])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('Block button', () => {
    it('is a real, tabbable button on Todo rows, between History and Delete', async () => {
      load([todoRow])
      renderSection()
      const block = screen.getByRole('button', { name: 'Block' })
      expect(block).toBeEnabled()
      expect(block).not.toHaveAttribute('tabindex', '-1')
      screen.getByRole('button', { name: 'History' }).focus()
      await userEvent.tab()
      expect(block).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    })

    it('is revealed by CSS on focus-within, so keyboard focus on any row control reaches it', () => {
      load([todoRow])
      renderSection()
      // jsdom cannot evaluate the stylesheet; the contract is that it is a sibling of the row controls inside .todo.
      const li = screen.getByText('Write tests').closest('li') as HTMLElement
      expect(within(li).getByRole('button', { name: 'Block' }).className).toContain('todo-block')
    })

    it('is absent on Draft, Completed and Blocked rows', () => {
      load([
        row({ id: 1, title: 'A', status: 'Draft' }),
        row({ id: 2, title: 'B', status: 'Completed' }),
        blockedRow,
      ])
      renderSection()
      expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument()
    })

    it('opens a focused reason input and hides the Block button while it is open', async () => {
      load([todoRow])
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      const input = screen.getByRole('textbox', { name: 'Blocked reason, optional' })
      expect(input).toHaveFocus()
      expect(input).toHaveAttribute('maxlength', '200')
      expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument()
    })

    it('Enter saves the trimmed reason, closes the input and returns focus to the row checkbox', async () => {
      load([todoRow])
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), '  Waiting on Sam {Enter}')
      expect(blockTodoMutate).toHaveBeenCalledTimes(1)
      expect(blockTodoMutate).toHaveBeenCalledWith({ id: 1, reason: 'Waiting on Sam' }, expect.any(Object))
      expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mark done' })).toHaveFocus()
    })

    it('Enter with an empty reason still blocks', async () => {
      load([todoRow])
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.keyboard('{Enter}')
      expect(blockTodoMutate).toHaveBeenCalledWith({ id: 1, reason: '' }, expect.any(Object))
    })

    it('a rapid double Enter sends exactly one request', async () => {
      load([todoRow])
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.keyboard('{Enter}{Enter}')
      expect(blockTodoMutate).toHaveBeenCalledTimes(1)
    })

    it('Escape cancels without a request and returns focus to the Block button', async () => {
      load([todoRow])
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), 'draft')
      await userEvent.keyboard('{Escape}')
      expect(blockTodoMutate).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Block' })).toHaveFocus()
    })

    it('blur (clicking elsewhere) cancels and never saves', async () => {
      load([todoRow])
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), 'draft')
      await userEvent.click(screen.getByPlaceholderText('Add a TODO and press Enter'))
      expect(blockTodoMutate).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox', { name: 'Blocked reason, optional' })).not.toBeInTheDocument()
    })

    it('typed characters do not reach global keyboard shortcuts', async () => {
      load([todoRow])
      const globalKey = vi.fn()
      document.addEventListener('keydown', globalKey)
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.keyboard('g')
      document.removeEventListener('keydown', globalKey)
      expect(globalKey).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'Blocked reason, optional' })).toHaveValue('g')
    })

    it('a failed block re-opens the input with the typed text, shows an alert and keeps the message plain', async () => {
      load([todoRow])
      blockTodoMutate.mockImplementation((_vars, opts: { onError: (e: unknown) => void; onSettled: () => void }) => {
        // Real failures arrive asynchronously, after the input has closed.
        setTimeout(() => {
          opts.onError({ code: 'TASK_BLOCK_DRAFT_NOT_ALLOWED' })
          opts.onSettled()
        }, 0)
      })
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.type(screen.getByRole('textbox', { name: 'Blocked reason, optional' }), 'Waiting on Sam{Enter}')
      const input = await screen.findByRole('textbox', { name: 'Blocked reason, optional' })
      expect(input).toHaveValue('Waiting on Sam')
      expect(input).toHaveFocus()
      expect(screen.getByRole('alert')).toHaveTextContent('Only open Todo tasks can be blocked.')
    })

    it('announces the result in a persistent polite live region', async () => {
      load([todoRow])
      blockTodoMutate.mockImplementation((_vars, opts: { onSuccess: () => void; onSettled: () => void }) => {
        opts.onSuccess()
        opts.onSettled()
      })
      renderSection()
      const region = screen.getByRole('status')
      expect(region).toHaveTextContent('')
      await userEvent.click(screen.getByRole('button', { name: 'Block' }))
      await userEvent.keyboard('{Enter}')
      expect(region).toHaveTextContent('Task blocked: Write tests')
    })
  })

  describe('Blocked rows', () => {
    it('shows the blocked glyph, label, class and keeps the title unstruck', () => {
      load([blockedRow])
      renderSection()
      const check = screen.getByRole('button', { name: 'Mark done (blocked)' })
      expect(check.querySelector('svg')).not.toBeNull()
      const li = screen.getByText('Waiting task').closest('li') as HTMLElement
      expect(li.className).toContain('is-blocked')
      expect(li.className).not.toContain('is-done')
    })

    it('checking a Blocked row completes it (done: true)', async () => {
      load([blockedRow])
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Mark done (blocked)' }))
      expect(toggleTodoMutate).toHaveBeenCalledWith({ id: 2, done: true }, expect.any(Object))
    })

    it('the badge is a real Unblock button that unblocks and returns focus to the checkbox', async () => {
      load([blockedRow])
      renderSection()
      const badge = screen.getByRole('button', { name: 'Unblock' })
      expect(badge).toHaveTextContent('Blocked')
      expect(badge).toHaveAttribute('title', 'Unblock')
      await userEvent.click(badge)
      expect(unblockTodoMutate).toHaveBeenCalledTimes(1)
      expect(unblockTodoMutate).toHaveBeenCalledWith({ id: 2 }, expect.any(Object))
      expect(screen.getByRole('button', { name: 'Mark done (blocked)' })).toHaveFocus()
    })

    it('a failed unblock shows an alert', async () => {
      load([blockedRow])
      unblockTodoMutate.mockImplementation((_vars, opts: { onError: (e: unknown) => void }) => opts.onError({}))
      renderSection()
      await userEvent.click(screen.getByRole('button', { name: 'Unblock' }))
      expect(screen.getByRole('alert')).toHaveTextContent('Unable to save task changes')
    })

    it('shows the reason with the full text in the title', () => {
      load([blockedRow])
      renderSection()
      const reason = screen.getByText('Waiting on Sam')
      expect(reason).toHaveAttribute('title', 'Waiting on Sam')
      expect(reason.tagName).toBe('BUTTON')
    })

    it('shows no reason element when there is no reason', () => {
      load([{ ...blockedRow, blockedReason: null }])
      renderSection()
      expect(document.querySelector('.todo-block-reason')).toBeNull()
    })

    it('double-click opens the editor; Enter saves the new reason via a reason-only mutation', async () => {
      load([blockedRow])
      renderSection()
      await userEvent.dblClick(screen.getByText('Waiting on Sam'))
      const input = screen.getByRole('textbox', { name: 'Blocked reason, optional' })
      expect(input).toHaveValue('Waiting on Sam')
      await userEvent.clear(input)
      await userEvent.type(input, 'Waiting on Alex{Enter}')
      expect(editReasonMutate).toHaveBeenCalledWith({ id: 2, reason: 'Waiting on Alex' }, expect.any(Object))
      expect(toggleTodoMutate).not.toHaveBeenCalled()
      expect(blockTodoMutate).not.toHaveBeenCalled()
    })

    it('Enter on the focused reason opens the editor (keyboard path); Escape cancels and refocuses it', async () => {
      load([blockedRow])
      renderSection()
      screen.getByText('Waiting on Sam').focus()
      await userEvent.keyboard('{Enter}')
      const input = screen.getByRole('textbox', { name: 'Blocked reason, optional' })
      expect(input).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(editReasonMutate).not.toHaveBeenCalled()
      expect(screen.getByText('Waiting on Sam')).toHaveFocus()
    })

    it('saving an unchanged reason sends nothing; clearing it sends an empty reason', async () => {
      load([blockedRow])
      renderSection()
      await userEvent.dblClick(screen.getByText('Waiting on Sam'))
      await userEvent.keyboard('{Enter}')
      expect(editReasonMutate).not.toHaveBeenCalled()
      await userEvent.dblClick(screen.getByText('Waiting on Sam'))
      await userEvent.clear(screen.getByRole('textbox', { name: 'Blocked reason, optional' }))
      await userEvent.keyboard('{Enter}')
      expect(editReasonMutate).toHaveBeenCalledWith({ id: 2, reason: '' }, expect.any(Object))
    })

    it('subtasks can be blocked and unblocked too', async () => {
      const child = row({ id: 7, title: 'Sub', parentTaskItemId: 1 })
      const blockedChild = row({ id: 8, title: 'Blocked sub', parentTaskItemId: 1, status: 'Blocked', blockedReason: 'r' })
      load([{ ...todoRow, children: [child, blockedChild] }])
      renderSection()
      const subLi = screen.getByText('Sub').closest('li') as HTMLElement
      await userEvent.click(within(subLi).getByRole('button', { name: 'Block' }))
      await userEvent.keyboard('{Enter}')
      expect(blockTodoMutate).toHaveBeenCalledWith({ id: 7, reason: '' }, expect.any(Object))
      const blockedLi = screen.getByText('Blocked sub').closest('li') as HTMLElement
      expect(blockedLi.className).toContain('is-blocked')
      await userEvent.click(within(blockedLi).getByRole('button', { name: 'Unblock' }))
      expect(unblockTodoMutate).toHaveBeenCalledWith({ id: 8 }, expect.any(Object))
    })
  })

  describe('counts and progress', () => {
    it('shows "X/Y" and "· M blocked" only when M > 0, counting Blocked as not done', () => {
      load([todoRow, blockedRow, row({ id: 3, title: 'Done', status: 'Completed' })])
      renderSection()
      expect(screen.getByText('1/3')).toBeInTheDocument()
      expect(screen.getByText('· 1 blocked')).toBeInTheDocument()
    })

    it('hides the blocked suffix when nothing is blocked', () => {
      load([todoRow])
      renderSection()
      expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument()
    })

    it('subtask progress reads "N/M done" with ", K blocked" only when K > 0', () => {
      const done = row({ id: 7, title: 'S1', status: 'Completed', parentTaskItemId: 1 })
      const open = row({ id: 8, title: 'S2', parentTaskItemId: 1 })
      const blocked = row({ id: 9, title: 'S3', status: 'Blocked', parentTaskItemId: 1 })
      load([{ ...todoRow, children: [done, open, blocked] }])
      const { unmount } = renderSection()
      expect(screen.getByText('1/3 done, 1 blocked')).toBeInTheDocument()
      unmount()
      load([{ ...todoRow, children: [done, open] }])
      renderSection()
      expect(screen.getByText('1/2 done')).toBeInTheDocument()
    })
  })

  describe('sort tiers', () => {
    const open = row({ id: 1, title: 'Open A' })
    const blocked = row({ id: 2, title: 'Blocked B', status: 'Blocked' })
    const done = row({ id: 3, title: 'Done C', status: 'Completed' })
    const open2 = row({ id: 4, title: 'Open D' })
    const blocked2 = row({ id: 5, title: 'Blocked E', status: 'Blocked' })

    it.each(['open first', 'done last'] as const)('%s orders open, blocked, completed and is stable within a tier', mode => {
      load([done, blocked, open, blocked2, open2])
      renderSection(mode)
      expect(titles()).toEqual(['Open A', 'Open D', 'Blocked B', 'Blocked E', 'Done C'])
    })

    it('manual keeps the given order', () => {
      load([done, blocked, open, blocked2, open2])
      renderSection('manual')
      expect(titles()).toEqual(['Done C', 'Blocked B', 'Open A', 'Blocked E', 'Open D'])
    })

    it('children stay under their parent when the parent moves tier', () => {
      const child = row({ id: 10, title: 'Child X', parentTaskItemId: 2 })
      load([{ ...blocked, children: [child] }, open])
      renderSection('open first')
      expect(titles()).toEqual(['Open A', 'Blocked B'])
      const parentLi = screen.getByText('Blocked B').closest('li') as HTMLElement
      expect(within(parentLi).getByText('Child X')).toBeInTheDocument()
    })

    it('keeps focus on the right checkbox by id when blocking re-sorts the list', async () => {
      load([open, open2])
      const { rerender } = renderSection('open first')
      const li = screen.getByText('Open D').closest('li') as HTMLElement
      await userEvent.click(within(li).getByRole('button', { name: 'Block' }))
      await userEvent.keyboard('{Enter}')
      load([open, { ...open2, status: 'Blocked' }])
      rerender(<TodosSection entryId={10} isoDate="2026-05-28" sort="open first" />)
      const blockedLi = screen.getByText('Open D').closest('li') as HTMLElement
      expect(within(blockedLi).getByRole('button', { name: 'Mark done (blocked)' })).toBeInTheDocument()
      expect(document.querySelector('[data-todo-check="4"]')).toHaveFocus()
    })
  })
})
