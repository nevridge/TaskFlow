import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectForm } from './ProjectForm'

function setup(overrides: Partial<React.ComponentProps<typeof ProjectForm>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <ProjectForm submitLabel="Create project" errorFallback="Could not create project." onSubmit={onSubmit} {...overrides} />,
  )
  return { onSubmit, ...utils }
}

describe('ProjectForm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('submits trimmed name and a description', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.type(screen.getByLabelText('Name'), '  Alpha  ')
    await user.type(screen.getByLabelText('Description'), 'About it')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Alpha', description: 'About it' })
  })

  it('sends an empty description as null', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.type(screen.getByLabelText('Name'), 'Alpha')
    await user.type(screen.getByLabelText('Description'), '   ')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Alpha', description: null })
  })

  it('sends a description with content as typed (untrimmed); whitespace-only becomes null', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.type(screen.getByLabelText('Name'), 'Alpha')
    await user.type(screen.getByLabelText('Description'), '  keep me  ')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).toHaveBeenLastCalledWith({ name: 'Alpha', description: '  keep me  ' })
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), '   ')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).toHaveBeenLastCalledWith({ name: 'Alpha', description: null })
  })

  it('ties the submit error alert to the form via aria-describedby', async () => {
    const user = userEvent.setup()
    setup({ onSubmit: vi.fn().mockRejectedValue({ message: 'Nope' }) })
    await user.type(screen.getByLabelText('Name'), 'X')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('id')
    expect(alert.closest('form')).toHaveAttribute('aria-describedby', alert.id)
  })

  it('clears the form after success when resetOnSuccess', async () => {
    const user = userEvent.setup()
    setup({ resetOnSuccess: true })
    await user.type(screen.getByLabelText('Name'), 'Alpha')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')
  })

  it('rejects an empty name without calling onSubmit', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.')
  })

  it('rejects a whitespace-only name', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.type(screen.getByLabelText('Name'), '    ')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a 101-char name', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.click(screen.getByLabelText('Name'))
    await user.paste('a'.repeat(101))
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/100 characters/)
  })

  it('rejects a 2001-char description', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.type(screen.getByLabelText('Name'), 'Alpha')
    await user.click(screen.getByLabelText('Description'))
    await user.paste('d'.repeat(2001))
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Description')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows the API message and keeps input on failure', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue({ message: 'Name already exists' })
    setup({ onSubmit, resetOnSuccess: true })
    await user.type(screen.getByLabelText('Name'), 'Dup')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name already exists')
    expect(screen.getByLabelText('Name')).toHaveValue('Dup')
  })

  it('uses the fallback when the error has no message', async () => {
    const user = userEvent.setup()
    setup({ onSubmit: vi.fn().mockRejectedValue({}) })
    await user.type(screen.getByLabelText('Name'), 'X')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create project.')
  })

  it('disables Save while submitting', async () => {
    const user = userEvent.setup()
    let resolve: () => void = () => {}
    const onSubmit = vi.fn().mockReturnValue(new Promise<void>((r) => { resolve = r }))
    setup({ onSubmit })
    await user.type(screen.getByLabelText('Name'), 'X')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled()
    resolve()
  })

  it('prefills, focuses the name and supports cancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    setup({ initialName: 'Old', initialDescription: 'Desc', autoFocusName: true, onCancel, submitLabel: 'Save' })
    expect(screen.getByLabelText('Name')).toHaveValue('Old')
    expect(screen.getByLabelText('Name')).toHaveFocus()
    expect(screen.getByLabelText('Description')).toHaveValue('Desc')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
