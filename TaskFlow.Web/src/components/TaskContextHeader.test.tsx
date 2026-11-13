import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { TaskContextHeader } from './TaskContextHeader'

function renderHeader(addSubtaskDisabled: boolean, onAddChild = vi.fn()) {
  render(
    <MemoryRouter>
      <table>
        <tbody>
          <TaskContextHeader
            path={[{ id: 5, title: 'Parent task' }]}
            parentId={5}
            anchor="ctx:active:5"
            sectionLabel="Active"
            isAdding={false}
            onAddChild={onAddChild}
            addSubtaskDisabled={addSubtaskDisabled}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  )
  return onAddChild
}

function StateProbe() {
  const location = useLocation()
  return <div data-testid="state">{JSON.stringify(location.state)}</div>
}

describe('TaskContextHeader parent link (#469)', () => {
  it('links to the parent and passes linkState', async () => {
    render(
      <MemoryRouter>
        <StateProbe />
        <table>
          <tbody>
            <TaskContextHeader
              path={[{ id: 5, title: 'Parent task' }]}
              parentId={5}
              anchor="ctx:active:5"
              sectionLabel="Active"
              isAdding={false}
              onAddChild={vi.fn()}
              linkState={{ from: '/tasks?q=a' }}
            />
          </tbody>
        </table>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Parent task' })
    expect(link).toHaveAttribute('href', '/tasks/5')
    await userEvent.click(link)
    expect(screen.getByTestId('state')).toHaveTextContent('{"from":"/tasks?q=a"}')
  })

  it('marks the nearest parent link, and only it, as the focus target (#479)', () => {
    render(
      <MemoryRouter>
        <table>
          <tbody>
            <TaskContextHeader
              path={[{ id: 3, title: 'Goal' }, { id: 5, title: 'Parent task' }]}
              parentId={5}
              anchor="ctx:active:5"
              sectionLabel="Active"
              isAdding={false}
              onAddChild={vi.fn()}
            />
          </tbody>
        </table>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Parent task' })).toHaveAttribute('data-task-header-id', '5')
    expect(document.querySelectorAll('[data-task-header-id]')).toHaveLength(1)
  })
})

describe('TaskContextHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls onAddChild when not gated', async () => {
    const onAddChild = renderHeader(false)
    const button = screen.getByRole('button', { name: /Add subtask to Parent task/ })
    expect(button).not.toHaveAttribute('aria-disabled')
    await userEvent.click(button)
    expect(onAddChild).toHaveBeenCalledTimes(1)
  })

  it('gates Add subtask with aria-disabled, keeps one focusable button and calls no handler', async () => {
    const onAddChild = renderHeader(true)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    const button = screen.getByRole('button', { name: /Add subtask to Parent task/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('title', "Completed tasks can't take new subtasks")
    expect(button).toHaveAccessibleDescription("Completed tasks can't take new subtasks")
    await userEvent.tab()
    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    await userEvent.click(button)
    expect(onAddChild).not.toHaveBeenCalled()
  })
})
