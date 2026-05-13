import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEnsureJournalEntry, useJournalEntries, useJournalTodos } from '@/hooks/useJournal'
import type { JournalEntryResponseDto, TaskItemResponseDto } from '@/api/journal'
import { urlDateToISO, todayISO, isValidISODate } from '@/lib/journal-utils'
import { DateNav } from '@/components/journal/DateNav'
import { JournalHeader } from '@/components/journal/JournalHeader'
import { TodosSection } from '@/components/journal/TodosSection'
import { DailyLogSection } from '@/components/journal/DailyLogSection'
import { NotesSection } from '@/components/journal/NotesSection'
import '@/journal.css'

type SortMode = 'manual' | 'open first' | 'done last'
type HeaderStyle = 'stat' | 'minimal'

const PREFS_KEY = 'taskflow_journal_prefs_v1'

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function JournalPage() {
  const { date: urlDate } = useParams<{ date: string }>()

  const isoDate = useMemo(
    () => urlDateToISO(urlDate ?? ''),
    [urlDate],
  )

  // Fall back to today if the param is missing or malformed
  const effectiveDate = isValidISODate(isoDate) ? isoDate : todayISO()

  const { entry, isLoading, error } = useEnsureJournalEntry(effectiveDate)

  // Resolve today's entry (for carry-forward from past days)
  const allEntriesQuery = useJournalEntries()
  const allEntries = (allEntriesQuery.data?.data as JournalEntryResponseDto[] | undefined) ?? []
  const todayEntry = allEntries.find(e => e.date === todayISO())
  const todayTodosQuery = useJournalTodos(todayEntry?.id)
  const todayTodos = (todayTodosQuery.data?.data as TaskItemResponseDto[] | undefined) ?? []

  // User preferences (persisted to localStorage)
  const [headerStyle, setHeaderStyle] = useState<HeaderStyle>(() => loadPrefs().headerStyle ?? 'stat')
  const [todoSort, setTodoSort] = useState<SortMode>(() => loadPrefs().todoSort ?? 'manual')
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = loadPrefs().dark
    if (saved != null) return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [projectStart, setProjectStart] = useState<string>(() => loadPrefs().projectStart ?? '2026-05-09')

  useEffect(() => {
    const prefs = loadPrefs()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, headerStyle, todoSort, dark: isDark, projectStart }))
  }, [headerStyle, todoSort, isDark, projectStart])

  return (
    <div className={'journal-page' + (isDark ? ' is-dark' : '')}>
      <div className="j-shell">
        <DateNav isoDate={effectiveDate} />

        {error && (
          <div className="j-error">
            Failed to load journal entry. Please refresh.
          </div>
        )}

        <article className="journal">
          <JournalHeader isoDate={effectiveDate} style={headerStyle} projectStart={projectStart} />

          {isLoading && !entry ? (
            <div className="j-loading">Loading…</div>
          ) : entry ? (
            <>
              <section className="j-grid">
                <TodosSection
                  entryId={entry.id}
                  isoDate={effectiveDate}
                  sort={todoSort}
                  todayEntryId={todayEntry?.id}
                  todayTodos={todayTodos}
                />
                <DailyLogSection
                  entryId={entry.id}
                  logEntries={entry.logEntries}
                />
              </section>

              <NotesSection
                key={entry.id}
                entryId={entry.id}
                entryTitle={entry.title}
                initialValue={entry.summary}
              />
            </>
          ) : null}
        </article>

        <PrefsBar
          headerStyle={headerStyle}
          todoSort={todoSort}
          isDark={isDark}
          projectStart={projectStart}
          onHeaderStyle={setHeaderStyle}
          onTodoSort={setTodoSort}
          onDark={setIsDark}
          onProjectStart={setProjectStart}
        />
      </div>
    </div>
  )
}

// ─── Minimal prefs bar ────────────────────────────────────────────────────────

interface PrefsBarProps {
  headerStyle: HeaderStyle
  todoSort: SortMode
  isDark: boolean
  projectStart: string
  onHeaderStyle: (v: HeaderStyle) => void
  onTodoSort: (v: SortMode) => void
  onDark: (v: boolean) => void
  onProjectStart: (v: string) => void
}

function PrefsBar({ headerStyle, todoSort, isDark, projectStart, onHeaderStyle, onTodoSort, onDark, onProjectStart }: PrefsBarProps) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 100 }}>
      {open && (
        <div style={{
          marginBottom: 8,
          padding: '14px 16px',
          background: isDark ? '#1a2438' : '#fff',
          border: '1px solid var(--line)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minWidth: 220,
          fontSize: 13,
          color: 'var(--ink)',
        }}>
          <PrefRow label="Header">
            <SegControl
              options={['stat', 'minimal'] as const}
              value={headerStyle}
              onChange={v => onHeaderStyle(v as HeaderStyle)}
            />
          </PrefRow>
          <PrefRow label="Sort">
            <SegControl
              options={['manual', 'open first', 'done last'] as const}
              value={todoSort}
              onChange={v => onTodoSort(v as SortMode)}
            />
          </PrefRow>
          <PrefRow label="Dark mode">
            <button
              onClick={() => onDark(!isDark)}
              style={{
                width: 32, height: 18, borderRadius: 999,
                background: isDark ? '#34c759' : 'rgba(0,0,0,.15)',
                border: 0, cursor: 'pointer', padding: 0, position: 'relative',
                transition: 'background .15s',
              }}
              aria-label="Toggle dark mode"
              role="switch"
              aria-checked={isDark}
            >
              <span style={{
                position: 'absolute', top: 2, left: isDark ? 16 : 2, width: 14, height: 14,
                borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                transition: 'left .15s',
              }} />
            </button>
          </PrefRow>
          <PrefRow label="Day 1">
            <input
              type="date"
              value={projectStart}
              onChange={e => e.target.value && onProjectStart(e.target.value)}
              style={{
                fontSize: 11.5, padding: '3px 6px', borderRadius: 6,
                border: '1px solid var(--line-2)',
                background: isDark ? '#0b1220' : '#f8fafc',
                color: 'var(--ink)', cursor: 'pointer',
              }}
            />
          </PrefRow>
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          border: 0, cursor: 'pointer', fontSize: 16,
          boxShadow: 'var(--shadow-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        aria-label="Journal settings"
      >
        ⚙
      </button>
    </div>
  )
}

function PrefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontWeight: 500, color: 'var(--muted)' }}>{label}</span>
      {children}
    </div>
  )
}

function SegControl<T extends string>({
  options, value, onChange,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {options.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          style={{
            padding: '3px 8px', borderRadius: 6, border: 0,
            background: o === value ? 'var(--accent)' : 'rgba(0,0,0,.06)',
            color: o === value ? '#fff' : 'var(--ink)',
            cursor: 'pointer', fontSize: 11.5, fontWeight: 500,
          }}
        >
          {o}
        </button>
      ))}
    </div>
  )
}
