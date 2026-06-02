# Technical Brief: Weekday-Only Day and Week Counter

**Branch:** feature/day-counter-only-counts-weekdays
**Date:** 2026-06-01
**Status:** Approved

---

## 1. Overview

The journal header currently counts every calendar day from the project start date, including weekends. This feature adds a user-controlled toggle — "Weekdays only" — that, when enabled, recalculates the displayed Day and Week numbers to count only Monday–Friday. The counter function in `journal-utils.ts` gains a new `weekdaysOnly` variant, the preference is persisted in `localStorage` alongside existing prefs, the `JournalHeader` and `DateNav` components are updated to accept and forward the new prop, and the Settings Drawer exposes the toggle. No backend changes are required.

The assumption is that the project-start date stored in the `projectStart` preference may itself fall on a weekend. The spec accounts for this by normalizing the start date to the nearest preceding Friday (or to the date itself if it is a weekday) inside the calculation function, silently, with no UI guard.

---

## 2. User Story

```
As a TaskFlow user,
I want the journal's Day and Week counters to optionally skip weekends,
So that my day count reflects only working days.
```

**Acceptance criteria:**

1. A "Weekdays only" toggle appears in the Settings Drawer under the Journal section.
2. When the toggle is off, Day/Week numbers match the existing calendar-day behavior exactly.
3. When the toggle is on, Saturday and Sunday are not counted; Day 1 is always the first weekday on or after `projectStart` (after normalization).
4. If `projectStart` falls on a weekend, it is silently normalized to the preceding Friday before counting begins; no error or warning is shown in the UI.
5. The preference persists across page reloads via `localStorage` under the existing key `taskflow_journal_prefs_v1`.
6. The `JournalHeader` and `DateNav` components both receive `weekdaysOnly` as a **required** prop; existing test renders are updated to pass the prop explicitly.
7. Pressing `j` (jump to today) when today is a weekend navigates to today's URL (`/journal/MM-DD-YYYY`); the existing redirect effect in `JournalPage` then redirects to the most-recent Friday as it would for any weekend URL.
8. The auto-dismiss notification dismisses itself after 3 seconds using `setTimeout` + `useState`.

---

## 3. Data Model Changes

No data model changes required. The `weekdaysOnly` preference is a client-side concern stored entirely in `localStorage` via the existing `Prefs` interface. No new EF Core entities, columns, migrations, or indexes are needed.

---

## 4. Backend Changes

No backend changes required.

---

## 5. Frontend Changes

### 5a. API Client

No new endpoints. `npm run gen:api` does not need to be re-run. `src/api/journal.ts` is not touched.

### 5b. Components

**Modified: `src/components/journal/JournalHeader.tsx`**
- Add `weekdaysOnly: boolean` as a **required** field to the `Props` interface.
- Replace `dayWeek(isoDate, projectStart)` with `dayWeekWeekdaysOnly(isoDate, projectStart, weekdaysOnly)`.

**Modified: `src/components/journal/DateNav.tsx`**
- Add `weekdaysOnly: boolean` as a **required** field to the `Props` interface.
- Use `addWeekdays(isoDate, -1)` / `addWeekdays(isoDate, 1)` when `weekdaysOnly` is true, else existing `addDays`.
- The "Today" button behavior is unchanged; weekend redirect is handled by `JournalPage` effect.

**Modified: `src/components/SettingsDrawer.tsx`**
- Destructure `weekdaysOnly` and `setWeekdaysOnly` from `usePrefs()`.
- Add a new `DrawerRow` inside the Journal section (after "Project day 1") with a `settings-toggle` button.

**Modified: `src/pages/JournalPage.tsx`**
- Destructure `weekdaysOnly` from `useOutletContext<AppContext>()`.
- Pass `weekdaysOnly={weekdaysOnly}` to both `<JournalHeader>` and `<DateNav>`.
- Add weekend redirect effect:
  ```ts
  useEffect(() => {
    if (!weekdaysOnly) return
    const day = parseISO(effectiveDate).getDay() // 0=Sun, 6=Sat
    if (day === 0 || day === 6) {
      navigate(`/journal/${isoToUrlDate(prevWeekday(effectiveDate))}`, { replace: true })
    }
  }, [effectiveDate, weekdaysOnly, navigate])
  ```
- Add auto-dismiss notification (shows when `weekdaysOnly` changes after mount):
  ```ts
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setNotificationMsg(weekdaysOnly ? 'Weekdays only on' : 'Weekdays only off')
    const id = setTimeout(() => setNotificationMsg(null), 3000)
    return () => clearTimeout(id)
  }, [weekdaysOnly])
  ```

### 5c. New Utility Functions in `journal-utils.ts`

**`dayWeekWeekdaysOnly(s: string, startDate: string, weekdaysOnly: boolean): { dayNum: number; weekNum: number }`**
- When `weekdaysOnly` is false, delegates to existing `dayWeek(s, startDate)`.
- When true: normalize `startDate` to preceding Friday if weekend; count only Mon–Fri days; `weekNum = Math.floor(weekdaysDiff / 5) + 1`.

**`addWeekdays(s: string, n: number): string`**
- Advances or retreats by `n` weekdays, skipping Sat/Sun. For prev/next buttons, `n` is `1` or `-1`.
- If input is a weekend and `n = 1`, advance to Monday; `n = -1`, retreat to Friday.

**`prevWeekday(s: string): string`**
- Returns the most-recent weekday. If Sat → Fri (`addDays(s, -1)`). If Sun → Fri (`addDays(s, -2)`). Otherwise returns `s` unchanged.

### 5d. Prefs Shape Changes

**`src/lib/prefs.ts`** — add `weekdaysOnly?: boolean` to `Prefs` interface.

**`src/context/PrefsContextDef.ts`** — add `weekdaysOnly: boolean` and `setWeekdaysOnly: (v: boolean) => void` to `PrefsContextValue`.

**`src/context/PrefsContext.tsx`** — add `useState` defaulting to `initialPrefs.weekdaysOnly ?? false`, add `useEffect` for persistence, include in provider value.

**`src/components/Layout.tsx`** — add `weekdaysOnly: boolean` and `setWeekdaysOnly: (v: boolean) => void` to `AppContext` interface.

### 5e. Styling

Add `.j-notify` class to `src/journal.css` — neutral/amber banner inside `.j-shell` for the transient notification.

---

## 6. Tests Required

### Frontend

- **`src/lib/journal-utils.test.ts`** — add cases for `dayWeekWeekdaysOnly`, `addWeekdays`, `prevWeekday`
- **`src/components/journal/JournalHeader.test.tsx`** — add `weekdaysOnly={false}` to all existing renders; add weekday-count test
- **`src/components/journal/DateNav.test.tsx`** — add `weekdaysOnly={false}` to all existing renders; add skip-weekend tests
- **`src/components/SettingsDrawer.test.tsx`** — add `weekdaysOnly`/`setWeekdaysOnly` to `makePrefs`; add toggle test
- **`src/pages/JournalPage.test.tsx`** — add `weekdaysOnly: false` to outlet context mock; add Saturday-redirect test
- **`src/context/PrefsContext.test.tsx`** — add `weekdaysOnly` to Consumer; add default and persist tests

---

## 7. Files That Will Change

**Modified:**
- `src/lib/journal-utils.ts`
- `src/lib/prefs.ts`
- `src/context/PrefsContextDef.ts`
- `src/context/PrefsContext.tsx`
- `src/components/Layout.tsx`
- `src/components/SettingsDrawer.tsx`
- `src/components/journal/JournalHeader.tsx`
- `src/components/journal/DateNav.tsx`
- `src/pages/JournalPage.tsx`
- `src/journal.css`
- `src/lib/journal-utils.test.ts`
- `src/components/journal/JournalHeader.test.tsx`
- `src/components/journal/DateNav.test.tsx`
- `src/components/SettingsDrawer.test.tsx`
- `src/pages/JournalPage.test.tsx`
- `src/context/PrefsContext.test.tsx`

---

## 8. Implementation Order

1. New utility functions in `journal-utils.ts` + tests
2. `prefs.ts` interface update
3. `PrefsContextDef.ts` + `PrefsContext.tsx` wiring + tests
4. `Layout.tsx` AppContext interface
5. `JournalHeader.tsx` + tests
6. `DateNav.tsx` + tests
7. `SettingsDrawer.tsx` + tests
8. `JournalPage.tsx` + `.j-notify` CSS + tests
9. Full test run + TypeScript check
10. Manual smoke test
