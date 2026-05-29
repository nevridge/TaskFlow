import { useEffect, useRef } from 'react'

interface Props {
  onClose: () => void
}

const SHORTCUTS = [
  {
    group: 'Navigation — All Pages',
    items: [
      { keys: ['g', 'h'], description: 'Go to today (home)' },
      { keys: ['g', 't'], description: 'Go to tasks page' },
      { keys: ['?'], description: 'Show / hide this help' },
    ],
  },
  {
    group: 'Journal — Day Navigation',
    items: [
      { keys: ['['], description: 'Previous day' },
      { keys: [']'], description: 'Next day' },
    ],
  },
  {
    group: 'Journal — Actions',
    items: [
      { keys: ['t'], description: 'New todo' },
      { keys: ['l'], description: 'New log entry' },
      { keys: ['n'], description: 'Focus notes' },
      { keys: ['j'], description: 'Go to today' },
    ],
  },
  {
    group: 'Inputs — All Pages',
    items: [
      { keys: ['Esc'], description: 'Cancel / deselect focused field' },
    ],
  },
]

export function KeyboardShortcutsModal({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        closeRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <>
      <div className="j-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="j-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-modal-title"
      >
        <div className="j-modal-header">
          <h3 id="kb-modal-title" className="j-modal-title">Keyboard shortcuts</h3>
          <button ref={closeRef} className="j-modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="kb-groups">
          {SHORTCUTS.map(group => (
            <div key={group.group} className="kb-group">
              <h4 className="kb-group-label">{group.group}</h4>
              <table className="kb-table">
                <tbody>
                  {group.items.map(item => (
                    <tr key={item.description} className="kb-row">
                      <td className="kb-keys">
                        {item.keys.map((k, i) => (
                          <span key={k}>
                            <kbd className="kb-kbd">{k}</kbd>
                            {i < item.keys.length - 1 && (
                              <span className="kb-then">then</span>
                            )}
                          </span>
                        ))}
                      </td>
                      <td className="kb-desc">{item.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
