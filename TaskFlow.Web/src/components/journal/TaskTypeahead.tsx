import { useState, useRef, useMemo, useEffect, useId } from 'react'
import { useTasksQuery } from '@/hooks/useTasks'
import type { TaskItemViewModel } from '@/hooks/useTasks'
import { BlockIcon } from '@/components/BlockControls'
import { isBlocked } from '@/lib/task-status'
import { isCoarsePointer } from '@/lib/pointer'
import { parseTaskId } from '@/lib/task-id-search'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  onEscape?: () => void
}

function findIdMatch(tasks: TaskItemViewModel[], input: string): TaskItemViewModel | undefined {
  const id = parseTaskId(input)
  return id === null ? undefined : tasks.find(t => Number(t.id) === id)
}

// The ID match (if any) first, then case-insensitive title matches in list order, capped at 10.
function filterTasks(tasks: TaskItemViewModel[], input: string): TaskItemViewModel[] {
  if (!input.trim()) return tasks.slice(0, 10)
  const idMatch = findIdMatch(tasks, input)
  const needle = input.toLowerCase()
  const titleMatches = tasks.filter(t => t !== idMatch && t.title.toLowerCase().includes(needle))
  return (idMatch ? [idMatch, ...titleMatches] : titleMatches).slice(0, 10)
}

// setSelectionRange rather than select(): one primitive for both paths. Skipped for an empty value, where there is
// nothing to select (and jsdom would queue a needless select event).
function selectAll(el: HTMLInputElement) {
  if (el.value.length > 0) el.setSelectionRange(0, el.value.length)
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
  // A refetched task list can remove or reorder the highlighted option, so drop the highlight rather than
  // let Enter select whatever now sits at that index.
  const [seenTasks, setSeenTasks] = useState(tasks)
  if (seenTasks !== tasks) {
    setSeenTasks(tasks)
    setActiveIndex(-1)
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const blurTimer = useRef<number | undefined>(undefined)
  const selectOnClick = useRef(false)
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-opt-${i}`

  const selectedTitle = value == null ? '' : (tasks.find(t => Number(t.id) === value)?.title ?? '')
  const displayValue = open ? inputValue : selectedTitle

  const filtered = filterTasks(tasks, inputValue)

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  // Keep the dropdown clear of the soft keyboard when it opens (touch only: on desktop it could scroll the page
  // in a narrow window), and the highlighted option inside the list.
  useEffect(() => {
    if (open && isCoarsePointer()) listRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])
  useEffect(() => {
    if (open && activeIndex >= 0) listRef.current?.querySelector('.active')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setInputValue(next)
    // An ID-form input with a matching task highlights it (index 1, below "None") so Enter selects it.
    setActiveIndex(findIdMatch(tasks, next) ? 1 : -1)
    setOpen(true)
  }

  function handleSelect(task: TaskItemViewModel | null) {
    onChange(task == null ? null : Number(task.id))
    setInputValue('')
    setOpen(false)
    setActiveIndex(-1)
  }

  // Runs before focus and before the open change applies: true when unfocused or when focused with the list
  // closed (after a selection); false when the list is open, so a second click places the caret.
  function handleMouseDown() {
    selectOnClick.current = !open
  }

  // Selects the prefilled title so the first keystroke replaces it. On a mouse click the browser places the
  // caret after focus and overwrites this; handleClick re-selects.
  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    window.clearTimeout(blurTimer.current)
    setInputValue(selectedTitle)
    setOpen(true)
    selectAll(e.currentTarget)
  }

  // After a selection the input keeps focus, so tapping it again fires no focus event: reopen on click.
  function handleClick(e: React.MouseEvent<HTMLInputElement>) {
    const el = e.currentTarget
    const wantSelect = selectOnClick.current
    selectOnClick.current = false
    if (!open) {
      setInputValue(selectedTitle)
      setOpen(true)
    }
    // Only a collapsed selection (caret placement) becomes select-all, so a drag or double-click selection survives.
    if (wantSelect && el.selectionStart === el.selectionEnd) {
      selectAll(el)
    }
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
        onMouseDown={handleMouseDown}
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
              <span className="task-typeahead-id">#{task.id}</span>{' '}
              {task.title}
              {isBlocked(task.status) && (
                <>
                  {' '}
                  <span className="task-typeahead-blocked">
                    <BlockIcon size={10} /> Blocked
                  </span>
                </>
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
