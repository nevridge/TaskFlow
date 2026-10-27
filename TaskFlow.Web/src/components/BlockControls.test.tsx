import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockedReasonText, BlockReasonInput } from './BlockControls'
import { __resetCoarsePointerCache } from '@/lib/pointer'

function setTouch(touch: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: touch }),
    configurable: true,
    writable: true,
  })
}

function Row({ reason, onEdit }: { reason: string; onEdit: () => void }) {
  return (
    <div>
      <a href="#x">link</a>
      <input type="checkbox" aria-label="done" />
      <button type="button">sibling action</button>
      <BlockedReasonText reason={reason} onEdit={onEdit} />
    </div>
  )
}

describe('BlockedReasonText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoarsePointerCache()
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  const reasonBtn = () => screen.getByRole('button', { name: /blocked reason: waiting/i })

  it('touch: a single tap opens edit', async () => {
    setTouch(true)
    const onEdit = vi.fn()
    render(<Row reason="waiting" onEdit={onEdit} />)
    await userEvent.click(reasonBtn())
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('non-touch: a single click does nothing, a double-click opens edit', async () => {
    setTouch(false)
    const onEdit = vi.fn()
    render(<Row reason="waiting" onEdit={onEdit} />)
    await userEvent.click(reasonBtn())
    expect(onEdit).not.toHaveBeenCalled()
    await userEvent.dblClick(reasonBtn())
    expect(onEdit).toHaveBeenCalled()
  })

  it('works without matchMedia (jsdom) as non-touch', async () => {
    const onEdit = vi.fn()
    render(<Row reason="waiting" onEdit={onEdit} />)
    await userEvent.click(reasonBtn())
    expect(onEdit).not.toHaveBeenCalled()
  })

  it.each([true, false])('Enter and Space open edit (touch=%s)', async touch => {
    setTouch(touch)
    const onEdit = vi.fn()
    render(<Row reason="waiting" onEdit={onEdit} />)
    reasonBtn().focus()
    await userEvent.keyboard('{Enter}')
    expect(onEdit).toHaveBeenCalledTimes(1)
    await userEvent.keyboard(' ')
    expect(onEdit).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])('an empty reason edits on a single click (touch=%s)', async touch => {
    setTouch(touch)
    const onEdit = vi.fn()
    render(<Row reason="" onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add blocked reason' }))
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it('a double-tap leaves one idempotent edit state', async () => {
    setTouch(true)
    function Host() {
      const [editing, setEditing] = useState(false)
      return editing ? (
        <BlockReasonInput className="x" onSubmit={vi.fn()} onCancel={vi.fn()} />
      ) : (
        <BlockedReasonText reason="waiting" onEdit={() => setEditing(true)} />
      )
    }
    render(<Host />)
    await userEvent.dblClick(reasonBtn())
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('other interactive elements in the row do not open edit', async () => {
    setTouch(true)
    const onEdit = vi.fn()
    render(<Row reason="waiting" onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('link', { name: 'link' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'done' }))
    await userEvent.click(screen.getByRole('button', { name: 'sibling action' }))
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('BlockReasonInput blur', () => {
  it('cancels without submitting when blurred with an unchanged value', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<BlockReasonInput className="x" initialValue="same" onSubmit={onSubmit} onCancel={onCancel} />)
    await userEvent.tab()
    expect(onCancel).toHaveBeenCalledWith('same', 'blur')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
