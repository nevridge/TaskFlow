import { useMemo, useRef } from 'react'
import { useParams, useOutletContext, useNavigate } from 'react-router-dom'
import { useEnsureJournalEntry } from '@/hooks/useJournal'
import { urlDateToISO, todayISO, isValidISODate, addDays, isoToUrlDate } from '@/lib/journal-utils'
import { DateNav } from '@/components/journal/DateNav'
import { JournalHeader } from '@/components/journal/JournalHeader'
import { TodosSection } from '@/components/journal/TodosSection'
import type { TodosSectionHandle } from '@/components/journal/TodosSection'
import { DailyLogSection } from '@/components/journal/DailyLogSection'
import type { DailyLogSectionHandle } from '@/components/journal/DailyLogSection'
import { NotesSection } from '@/components/journal/NotesSection'
import type { NotesSectionHandle } from '@/components/journal/NotesSection'
import { useJournalKeyboardShortcuts } from '@/hooks/useJournalKeyboardShortcuts'
import type { AppContext } from '@/components/Layout'
import '@/journal.css'

export function JournalPage() {
  const { date: urlDate } = useParams<{ date: string }>()
  const navigate = useNavigate()

  const isoDate = useMemo(
    () => (urlDate ? urlDateToISO(urlDate) : todayISO()),
    [urlDate],
  )

  // Fall back to today if the param is missing or malformed
  const effectiveDate = isValidISODate(isoDate) ? isoDate : todayISO()

  const { entry, isLoading, error } = useEnsureJournalEntry(effectiveDate)

  const { isDark, headerStyle, todoSort, projectStart } = useOutletContext<AppContext>()

  const todosSectionRef = useRef<TodosSectionHandle>(null)
  const logSectionRef = useRef<DailyLogSectionHandle>(null)
  const notesSectionRef = useRef<NotesSectionHandle>(null)

  useJournalKeyboardShortcuts({
    onNewTodo: () => todosSectionRef.current?.focusDraftInput(),
    onNewLog: () => logSectionRef.current?.focusDraftInput(),
    onNewNote: () => notesSectionRef.current?.focusNewNote(),
    onPrevDay: () => navigate(`/journal/${isoToUrlDate(addDays(effectiveDate, -1))}`),
    onNextDay: () => navigate(`/journal/${isoToUrlDate(addDays(effectiveDate, 1))}`),
  })

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
                  ref={todosSectionRef}
                  entryId={entry.id}
                  isoDate={effectiveDate}
                  sort={todoSort}
                />
                <DailyLogSection
                  ref={logSectionRef}
                  entryId={entry.id}
                  logEntries={entry.logEntries}
                />
              </section>

              <NotesSection
                ref={notesSectionRef}
                key={entry.id}
                entryId={entry.id}
              />
            </>
          ) : null}
        </article>
      </div>

    </div>
  )
}
