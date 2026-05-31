import { useState, useRef, useEffect } from 'react'
import { useTasksQuery } from '@/hooks/useTasks'
import type { TaskItemViewModel } from '@/hooks/useTasks'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
}

export function TaskTypeahead({ value, onChange }: Props) {
  const { data: queryResult } = useTasksQuery()
  const tasks: TaskItemViewModel[] = (queryResult?.data as TaskItemViewModel[] | undefined) ?? []

  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        // Reset input to selected task title on blur if user typed something partial
        if (value == null) {
          setInputValue('')
        } else {
          const task = tasks.find(t => Number(t.id) === value)
          setInputValue(task?.title ?? '')
        }
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [value, tasks])

  const filtered = inputValue.trim()
    ? tasks
        .filter(t => t.title.toLowerCase().includes(inputValue.toLowerCase()))
        .slice(0, 10)
    : tasks.slice(0, 10)

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value)
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
  }

  function handleFocus() {
    setOpen(true)
  }

  return (
    <div ref={containerRef} className="task-typeahead">
      <input
        ref={inputRef}
        className="task-typeahead-input"
        type="text"
        placeholder="Link to task…"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        aria-label="Link to task"
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
      />
      {open && (
        <ul className="task-typeahead-dropdown" role="listbox">
          <li
            className="task-typeahead-option task-typeahead-none"
            role="option"
            aria-selected={value == null}
            onMouseDown={() => handleSelect(null)}
          >
            None
          </li>
          {filtered.map(task => (
            <li
              key={task.id}
              className="task-typeahead-option"
              role="option"
              aria-selected={Number(task.id) === value}
              onMouseDown={() => handleSelect(task)}
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
