import { useState, useRef, useEffect } from 'react'
import { useTasksQuery } from '@/hooks/useTasks'
import type { TaskItemViewModel } from '@/hooks/useTasks'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  onEscape?: () => void
}

export function TaskTypeahead({ value, onChange, onEscape }: Props) {
  const { data: queryResult } = useTasksQuery()
  const tasks: TaskItemViewModel[] = (queryResult?.data as TaskItemViewModel[] | undefined) ?? []

  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync display value when `value` prop changes
  useEffect(() => {
    if (value == null) {
      setInputValue('')
    } else {
      const task = tasks.find(t => Number(t.id) === value)
      if (task) setInputValue(task.title)
    }
  }, [value, tasks])

  const filtered = inputValue.trim()
    ? tasks
        .filter(t => t.title.toLowerCase().includes(inputValue.toLowerCase()))
        .slice(0, 10)
    : tasks.slice(0, 10)

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value)
    setActiveIndex(-1)
    setOpen(true)
  }

  function handleSelect(task: TaskItemViewModel | null) {
    if (task == null) {
      onChange(null)
      setInputValue('')
    } else {
      onChange(Number(task.id))
      setInputValue(task.title)
    }
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleFocus() {
    setOpen(true)
  }

  function handleBlur() {
    setTimeout(() => {
      setOpen(false)
      setActiveIndex(-1)
      // Reset input to selected task title if user typed something partial without selecting
      if (value == null) {
        setInputValue('')
      } else {
        const task = tasks.find(t => Number(t.id) === value)
        setInputValue(task?.title ?? '')
      }
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
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label="Link to task"
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
      />
      {open && (
        <ul className="task-typeahead-dropdown" role="listbox">
          <li
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
              className={`task-typeahead-option${activeIndex === i + 1 ? ' active' : ''}`}
              role="option"
              aria-selected={Number(task.id) === value}
              onClick={() => handleSelect(task)}
            >
              {task.title}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="task-typeahead-empty" role="option" aria-selected={false}>
              No matching tasks
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
