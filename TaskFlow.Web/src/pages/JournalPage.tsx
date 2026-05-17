import { useMemo } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import { useEnsureJournalEntry } from '@/hooks/useJournal'
import { urlDateToISO, todayISO, isValidISODate } from '@/lib/journal-utils'
import { DateNav } from '@/components/journal/DateNav'
import { JournalHeader } from '@/components/journal/JournalHeader'
import { TodosSection } from '@/components/journal/TodosSection'
import { DailyLogSection } from '@/components/journal/DailyLogSection'
import { NotesSection } from '@/components/journal/NotesSection'
import type { AppContext } from '@/components/Layout'
import '@/journal.css'

export function JournalPage() {
  const { date: urlDate } = useParams<{ date: string }>()

  const isoDate = useMemo(
    () => (urlDate ? urlDateToISO(urlDate) : todayISO()),
    [urlDate],
  )

  // Fall back to today if the param is missing or malformed
  const effectiveDate = isValidISODate(isoDate) ? isoDate : todayISO()

  const { entry, isLoading, error } = useEnsureJournalEntry(effectiveDate)

  const { isDark, headerStyle, todoSort, projectStart } = useOutletContext<AppContext>()

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
      </div>
    </div>
  )
}
