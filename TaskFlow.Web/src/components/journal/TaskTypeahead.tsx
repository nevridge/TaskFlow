import { useState, useRef, useMemo, useEffect, useId } from 'react'
import { useTasksQuery } from '@/hooks/useTasks'
import type { TaskItemViewModel } from '@/hooks/useTasks'
import { BlockIcon } from '@/components/BlockControls'
import { isBlocked } from '@/lib/task-status'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  onEscape?: () => void
}

export function TaskTypeahead({ value, onChange, onEscape }: Props) {
  const { data: queryResult } = useTasksQuery()
  const tasks = useMemo(
    () => (queryResult?.data as TaskItemViewModel[] | undefined) ?? [],
    [queryResult?.data],
  )

  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const blurTimer = useRef<number | undefined>(undefined)
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-opt-${i}`

  const selectedTitle = value == null ? '' : (tasks.find(t => Number(t.id) === value)?.title ?? '')
  const displayValue = open ? inputValue : selectedTitle

  const filtered = inputValue.trim()
    ? tasks
        .filter(t => t.title.toLowerCase().includes(inputValue.toLowerCase()))
        .slice(0, 10)
    : tasks.slice(0, 10)

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  // Keep the dropdown clear of the soft keyboard when it opens, and the highlighted option inside the list.
  useEffect(() => {
    if (open) listRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])
  useEffect(() => {
    if (open && activeIndex >= 0) listRef.current?.querySelector('.active')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value)
    setActiveIndex(-1)
    setOpen(true)
  }

  function handleSelect(task: TaskItemViewModel | null) {
    onChange(task == null ? null : Number(task.id))
    setInputValue('')
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleFocus() {
    window.clearTimeout(blurTimer.current)
    setInputValue(selectedTitle)
    setOpen(true)
  }

  // After a selection the input keeps focus, so tapping it again fires no focus event: reopen on click.
  function handleClick() {
    if (open) return
    setInputValue(selectedTitle)
    setOpen(true)
  }

  function handleBlur() {
    window.clearTimeout(blurTimer.current)
    blurTimer.current = window.setTimeout(() => {
      setOpen(false)
      setActiveIndex(-1)
      setInputValue('')
    }, 150)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setActiveIndex(0)
      } else {
        setActiveIndex(prev => Math.min(prev + 1, filtered.length))
      }
    } else if (e.key === 'ArrowUp') {
      if (!open) return
      e.preventDefault()
      setActiveIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
      if (onEscape) {
        onEscape()
      } else {
        inputRef.current?.blur()
      }
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0) {
        e.preventDefault()
        if (activeIndex === 0) {
          handleSelect(null)
        } else {
          handleSelect(filtered[activeIndex - 1])
        }
      }
    }
  }

  return (
    <div className="task-typeahead">
      <input
        ref={inputRef}
        className="task-typeahead-input"
        type="text"
        placeholder="Link to task…"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onClick={handleClick}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label="Link to task"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
      />
      {open && (
        // Keeping the mousedown default away keeps focus in the input, so its blur (which closes the list)
        // cannot fire before the option's click selects.
        <ul
          ref={listRef}
          id={listboxId}
          className="task-typeahead-dropdown"
          role="listbox"
          onMouseDown={e => e.preventDefault()}
        >
          <li
            id={optionId(0)}
            className={`task-typeahead-option task-typeahead-none${activeIndex === 0 ? ' active' : ''}`}
            role="option"
            aria-selected={value == null}
            onClick={() => handleSelect(null)}
          >
            None
          </li>
          {filtered.map((task, i) => (
            <li
              key={task.id}
              id={optionId(i + 1)}
              className={`task-typeahead-option${activeIndex === i + 1 ? ' active' : ''}`}
              role="option"
              aria-selected={Number(task.id) === value}
              onClick={() => handleSelect(task)}
            >
              {task.title}
              {isBlocked(task.status) && (
                <span className="task-typeahead-blocked">
                  <BlockIcon size={10} /> Blocked
                </span>
              )}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="task-typeahead-empty" role="presentation">
              No matching tasks
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
