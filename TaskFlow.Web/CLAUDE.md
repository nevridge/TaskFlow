# CLAUDE.md

Guidance for working under `TaskFlow.Web/`.

**API client:** Hand-written API modules (e.g. `src/api/journal.ts`) use the same `client` singleton from `client.gen.ts` with the pattern `client.get<{ 200: T }, unknown, true>({ url, path?, body?, headers? })`.

**Error handling:** `throwOnError` is a runtime flag, set once at startup by `configureApiClient()` in `src/api/configure-client.ts` (called from `main.tsx` and the vitest setup), so every 4xx/5xx rejects. The `true` generic in `client.get<..., true>` is type-only and does not set it. Callers that want `{ error, response }` (e.g. the undo-delete commits in `useDeleteTaskUndoable`) pass `throwOnError: false`.

**Journal feature** (`/journal/:date`, URL format MM-DD-YYYY):
- Todos are existing `TaskItem` records linked via a many-to-many join (`JournalEntryTaskItem`)
- Notes are separate `JournalNote` records (add and edit via textarea: Enter saves, Shift+Enter inserts a newline, double-click to edit), shown with a small formatter (`src/lib/notes-format.ts`) that renders `-`/`*` bullet lists and `1.` numbered lists as React elements.
- Tasks-page deletes are undoable (Undo toast, no confirm): pending keys are `task:<id>` (10s) and `tasknote:<id>` (6s), distinct from the journal's `note:`/`log:`/`todo:` keys. Read hooks (`useTasksQuery`, `useTaskQuery`, `useNotesQuery`, `useProjectTasksQuery`, `useJournalTodos`) filter pending ids through `select`
- User preferences (header style, sort, dark mode, project start date) persist to `localStorage` under key `taskflow_journal_prefs_v1`

## Safe Change Rules

- **CSS specificity in journal:** The `.journal-page button` reset rule has specificity `0-1-1`. Any button needing its own `border` or `background` must be scoped as `.journal-page .classname` (`0-2-0`) to win the cascade
- **`gen:api` scope:** Only regenerates `src/api/client/` — hand-written modules in `src/api/journal.ts` must be updated manually and will NOT be touched by the generator

## Testing

**Key patterns:**
- Hook tests wrap `renderHook` in a fresh `QueryClient` via a `makeWrapper()` helper — see `useTasks.test.ts` for the canonical example
- Component tests use role-based queries (`getByRole`, `getByLabelText`) over text or selector queries
- `vi.clearAllMocks()` in `beforeEach` on every test file
- `useJournal.ts` requires **two separate mocks**: `vi.mock('@/api/journal')` for journal-specific functions AND `vi.mock('@/api/client/sdk.gen')` for todo create/toggle mutations that call the SDK directly
- `PrefsContext` tests must clean up DOM side-effects in `afterEach`: `document.documentElement.removeAttribute('data-theme')`, `document.documentElement.classList.remove('is-dark')`, `localStorage.clear()`
- Keyboard shortcut tests use `vi.useFakeTimers()` for chord sequences; clean up with `document.body.innerHTML = ''` in `afterEach`

Test fixtures must use PascalCase status values too (see the enum rule under Safe Change Rules in the root `CLAUDE.md`) — a lowercase `'completed'` fixture silently produces wrong behaviour.
