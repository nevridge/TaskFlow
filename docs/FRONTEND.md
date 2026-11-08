# Frontend Guide (TaskFlow.Web)

> **📖 Reference Documentation** — For quick setup, see [Getting Started](GETTING_STARTED.md#running-the-frontend). For the project's technical rationale, see [Architecture](ARCHITECTURE.md#frontend-architecture).

This guide covers the frontend in depth: project decisions, component structure, API client generation, environment configuration, testing, and Docker.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Technology Decisions](#technology-decisions)
- [API Client Generation](#api-client-generation)
- [TanStack Query Hooks](#tanstack-query-hooks)
- [Pages and Components](#pages-and-components)
- [Environment Configuration](#environment-configuration)
- [Vite Dev Server Proxy](#vite-dev-server-proxy)
- [Testing](#testing)
- [Docker](#docker)
- [CI Integration](#ci-integration)
- [Troubleshooting](#troubleshooting)

## Overview

TaskFlow.Web is a React 19 + TypeScript SPA that provides the task management UI. The key architectural choices are:

- **Type safety end-to-end** — the API client is generated from the live OpenAPI spec, so TypeScript types always reflect the actual backend contract
- **TanStack Query for server state** — caching, background refetch, optimistic invalidation, and loading/error states are handled by the library, not manual `useState`/`useEffect`
- **Thin pages, fat hooks** — pages are mostly composition; data fetching and mutation logic lives in hooks
- **No global state management library** — TanStack Query's cache is the only "store"; component state handles UI-only concerns (modals, editing flags)

## Getting Started

### Prerequisites

- Node.js 26+
- `npm` (bundled with Node.js)
- TaskFlow.Api running at `http://localhost:8080`

### Run the frontend standalone

```bash
cd TaskFlow.Web
npm install
npm run dev
```

Open **http://localhost:5173**. The dev server proxies API calls to `http://localhost:8080` automatically.

### Run the full stack with Docker Compose

From the repo root:

```bash
docker compose up
```

| Service | URL |
|---------|-----|
| Frontend (production build) | http://localhost:3000 |
| API | http://localhost:8080 |
| Seq (log viewer) | http://localhost:5380 |

Note: `docker compose up` serves the **production build** of the frontend via `vite preview` (with a proxy for `/api` and `/openapi`). For hot-reload development, run `npm run dev` separately and point it at the running API container.

## Project Structure

```
TaskFlow.Web/
├── src/
│   ├── api/
│   │   └── client/                 # Auto-generated — do not edit manually
│   │       ├── client.gen.ts       # Configured client singleton
│   │       ├── sdk.gen.ts          # One typed function per API endpoint
│   │       └── types.gen.ts        # All request/response TypeScript types
│   │
│   ├── hooks/
│   │   ├── useTasks.ts             # All task query + mutation hooks
│   │   ├── useTasks.test.ts        # Hook tests
│   │   ├── useNotes.ts             # All note query + mutation hooks
│   │   └── useNotes.test.ts        # Hook tests
│   │
│   ├── pages/
│   │   ├── TasksPage.tsx           # Task list — filter, sort, create, edit, delete
│   │   └── TaskDetailPage.tsx      # Single task + inline note management
│   │
│   ├── components/
│   │   ├── TaskCard.tsx            # Task summary card with status/priority badges
│   │   ├── TaskCard.test.tsx
│   │   ├── TaskForm.tsx            # Shared create/edit form for tasks
│   │   ├── TaskForm.test.tsx
│   │   ├── NoteCard.tsx            # Note display with edit/delete buttons
│   │   ├── NoteCard.test.tsx
│   │   ├── NoteForm.tsx            # Shared create/edit form for notes
│   │   └── NoteForm.test.tsx
│   │
│   ├── lib/
│   │   └── utils.ts                # cn() (clsx helper), formatDate()
│   │
│   ├── test/
│   │   └── setup.ts                # Vitest setup (@testing-library/jest-dom)
│   │
│   ├── App.tsx                     # React Router setup (two routes)
│   ├── main.tsx                    # React root — QueryClientProvider, RouterProvider
│   └── index.css                   # Tailwind base import
│
├── .env.development                # (empty — Vite proxy handles /api → localhost:8080)
├── .env.production                 # (empty — reverse proxy handles /api routing)
├── vite.config.ts                  # @ path alias, dev proxy, vitest config
├── tsconfig.app.json               # App TypeScript config
├── tsconfig.node.json              # Node/tooling TypeScript config
├── eslint.config.js                # ESLint config
├── Dockerfile                      # Multi-stage build
└── package.json
```

## Technology Decisions

### React 19 + Vite 8

Vite provides near-instant dev server startup and HMR, a significant improvement over CRA or webpack-based setups. React 19 brings the new compiler and improved server component primitives (not used here, but future-ready).

### Tailwind CSS v4

Tailwind v4 ships as a Vite plugin (`@tailwindcss/vite`) — no `tailwind.config.js` required. Utility classes keep styles co-located with markup and eliminate unused CSS via tree-shaking at build time.

### TanStack Query v5

Server state (loading, error, data, caching, refetch) is fundamentally different from UI state. TanStack Query separates these concerns cleanly:

- Queries automatically cache and deduplicate requests
- Mutations can invalidate or remove related queries on success
- `enabled` flag prevents queries from firing with invalid inputs (e.g. NaN task IDs)
- `throwOnError` is a runtime flag, set once at app startup by `configureApiClient()` in `src/api/configure-client.ts` (called from `main.tsx`, and from the vitest setup), so non-2xx responses reject and reach React Query's `error` field instead of silently resolving as success. The `true` generic on `client.get<..., true>` is type-only. A caller that needs `{ error, response }` (the undo-delete commits) must pass `throwOnError: false`.

### hey-api/openapi-ts (Generated API Client)

Rather than hand-writing fetch calls, the client is generated from the live OpenAPI spec:

```bash
npm run gen:api
# Reads: http://localhost:8080/openapi/v1.json
# Writes: src/api/client/
```

This means:
- TypeScript types for every request and response are always in sync with the backend
- When the API changes, a `gen:api` run surfaces type errors in pages/hooks immediately
- No manual type maintenance

The client is committed to source control so CI doesn't need a running API server.

### React Router v7

Key routes (see `src/App.tsx`):
- `/` → redirects to today's journal
- `/tasks` → `TasksPage` (task list)
- `/tasks/:id` → `TaskDetailPage` (task detail + notes)

## API Client Generation

The `gen:api` npm script invokes `@hey-api/openapi-ts` using the configuration in `openapi-ts.config.ts`:

```json
"gen:api": "openapi-ts"
```

The config file sets `baseUrl: false` on the `@hey-api/client-fetch` plugin so the generator never bakes a hardcoded server URL into `client.gen.ts`. The generated client uses relative paths by default, which route through whatever proxy is in front (Vite in dev, the production reverse proxy in prod).

**When to regenerate:**
- After any change to the API's request/response shapes, routes, or model properties
- When adding new endpoints that the frontend needs to call

**The generated client instance (`client.gen.ts`):**

```typescript
export const client = createClient(createConfig<ClientOptions2>());
```

With no `baseUrl` argument, `@hey-api/client-fetch` defaults to relative paths. All API call URLs (`/api/v1/...`) resolve against the current page origin.

## TanStack Query Hooks

### Query keys

```typescript
// useTasks.ts
export const taskKeys = {
  all: ['tasks'] as const,
  detail: (id: number) => ['tasks', id] as const,
}

// useNotes.ts
export const noteKeys = {
  all: (taskId: number) => ['tasks', taskId, 'notes'] as const,
}
```

Consistent key structure means mutations can target specific slices of the cache for invalidation or removal.

### Task hooks

```typescript
// Fetch list
useTasksQuery()

// Fetch single (skipped if id is NaN/Infinity)
useTaskQuery(id: number)

// Create — invalidates task list
useCreateTaskMutation()

// Update — invalidates list + specific detail
useUpdateTaskMutation()

// Delete — UI deletes go through useDeleteTaskUndoable (Undo toast, 10s window).
// useDeleteTaskMutation remains for direct use (rejects on HTTP errors by default); invalidates list, removes detail from cache
useDeleteTaskMutation()
```

### Note hooks

```typescript
// Fetch notes for a task (skipped if taskId is invalid)
useNotesQuery(taskId: number)

// Mutations — all invalidate noteKeys.all(taskId)
useCreateNoteMutation(taskId: number)
useUpdateNoteMutation(taskId: number)
useDeleteNoteMutation(taskId: number) // UI deletes use useDeleteNoteUndoable (Undo toast, 6s window); this remains for direct use (rejects on HTTP errors by default)
```

## Pages and Components

### TasksPage (`/tasks`)

The task list page. Responsibilities:
- Fetch all tasks via `useTasksQuery`
- Filter client-side by view chips (All / Active today / Scheduled future / Completed history), Status, Project and title search
- Sort by title, status, priority, or due date
- New Task opens inline; Edit navigates to `/tasks/:id?edit=1` (the task detail page in edit mode)
- Delete is undoable: `useDeleteTaskUndoable` hides the task (pending key `task:<id>`) and sends the DELETE after a 10s Undo toast window; no confirm dialog. A parent with subtasks has an `aria-disabled` Delete ("Delete subtasks first (N)")

The **Status** filter is a multi-select group of checkboxes (Draft, To-do, Completed) labelled "Status". It defaults to Draft and To-do selected, so completed tasks are hidden until Completed is checked. There is no "All" option: selecting all three shows everything, and an empty selection (all unchecked) applies no restriction and also shows every task. The selection is page state only (not persisted) and resets to Draft + To-do whenever the page is reopened. It does not affect the view chips, so the Completed history chip is empty until Completed is checked.

Status values are lowercase in the filter (`draft`, `todo`, `completed`) while API values are PascalCase (`Draft`, `Todo`, `Completed`). Normalisation (`.toLowerCase()`) happens at the filter comparison site, not in the hook or component props.

### TaskDetailPage (`/tasks/:id`)

The task detail page. Responsibilities:
- Parse and validate `id` from route params — renders an error state if `Number(id)` is not finite
- Fetch task via `useTaskQuery(taskId)` (`enabled: Number.isFinite(taskId)`)
- Fetch notes via `useNotesQuery(taskId)`
- Edit task (replaces title/detail with `TaskForm`). Edit mode is driven by the `?edit=1` URL param, not local state; the in-page Edit button sets it too
- Delete task — starts the undoable delete and navigates to `/tasks` at once (`replace`, with `state.focusNewTask` so New Task takes focus); the Undo toast persists across the navigation
- Inline note creation and editing; note delete is undoable (pending key `tasknote:<id>`, 6s window)

#### Origin state and back link (#404)

Journal rows link to `/tasks/:id` with router state `{ from?: string, focusTaskId?: number }` (helpers in `src/lib/task-origin.ts`). The origin state lives only in `history.state`; nothing about the origin is read from the URL. The one URL input is the `edit` param (see below).

- `from` is built from the journal's `isoDate` prop (`/journal/MM-DD-YYYY`), never from `location.pathname`. The context-header "Parent task" link carries `from` only. The Tasks page links, including the Edit button (`/tasks/:id?edit=1`), carry no state.
- `from` is valid only if it is a string starting `/journal/` containing no `//`, `\` or `:`.

| State on `/tasks/:id` | Back link target | Label |
| --- | --- | --- |
| valid `from` | `from` (plain `<Link>`, state `{ focusTaskId }`) | "← Back to Journal" |
| missing or invalid (direct load, Tasks page) | `/tasks` | "← Back to Tasks" |

Computed synchronously on first render, so a refresh keeps the origin. Deleting from the detail page still navigates to `/tasks` with `{ replace: true, state: { focusNewTask: true } }`.

One-shot focus return: `TodosSection` reads `focusTaskId` once into `returnFocusRef` (separate from `pendingFocus`, which expires after 100ms and is cleared by key and pointer events). When loading ends it focuses `[data-todo-details="<id>"]` if the row exists, and abandons the request without forcing focus if it does not. It then clears only the focus key (`navigate(pathname, { replace: true, state: rest or null })`), so `weekendRedirect` survives and a refresh does not refocus.

The weekend-to-Friday redirect in `JournalPage` spreads the incoming `location.state` and sets `weekendRedirect: true` last, so `focusTaskId` survives it. Any future one-shot state key set on a weekend navigation survives it too.

Shortcuts are unchanged: `t l n [ ] j` (journal) and the global `?` and `g` chord still fire while the details link is focused; `Enter` is unbound.

#### Edit mode: `?edit=1` (#421)

The URL is the single source of truth for edit mode on `/tasks/:id`; there is no local `editingTask` state. Helpers live in `src/lib/task-origin.ts` (`isEditRequested`, `withEditParam`, `withoutEditParam`, `taskEditPath`).

- **Strict parsing:** edit mode is on only when `searchParams.getAll('edit')` is exactly `['1']`. `edit=0`, `edit=true`, `edit=`, `edit=1&edit=2` and `?Edit=1` stay in read mode. Other params are preserved.
- **Entry points:** the Tasks page row Edit button (`navigate(taskEditPath(id))`, no state), the journal details link (`/tasks/:id?edit=1` with state `{ from, focusTaskId }`; its accessible name is "Edit details: <title>") and the in-page Edit button.
- **Replace navigation:** the in-page Edit button, Save success and Cancel all use `setSearchParams(..., { replace: true, state: location.state })`, so opening and closing add no history entries, and Back and refresh never reopen a closed form. `state` is passed explicitly because router v7 would otherwise reset it to null and "Back to Journal" would lose `focusTaskId`. Refreshing while editing reopens the form.
- **Independent of origin:** `readJournalOrigin` reads only state, so `?edit=1` does not change the back link.
- **Focus:** the title is focused once the task has loaded and the form is open (a single `taskReady` source drives both the form render and the focus effect, so a deep link with a cold cache focuses after load and background refetches never re-steal focus). When the form closes, focus moves to the Edit button, except while a delete is leaving the page. The shortcut hooks ignore keystrokes in the focused title via `isInputFocused()`.
- **Failed save:** the form and `?edit=1` stay, and the existing `role="alert"` message announces the error. A not-found id shows "Task not found." with no form. Derived or locked tasks open the form with the status select disabled.

**Return to Tasks:** the Tasks page no longer restores focus, filters or scroll after an edit. Returning from the detail page lands on an unfiltered list at the top, with focus at the document start. This is accepted, not a bug. `data-task-edit-id` on the row Edit button is kept as a stable hook for a possible follow-up that restores them.

### Current Tasks + Journal behavior (May 2026)

Recent UX additions that are now part of the app flow:

- Tasks table supports hierarchy rendering (parent row + indented child rows).
- Parent rows can expand/collapse subtasks.
- Quick-add subtask is available inline from each row.
- Task history can be opened from:
  - Tasks list rows
  - Task detail page
  - Journal todo rows
- History modals support keyboard close (`Escape`) and focus the close action on open.
- Journal todo creation uses `journalDate` in task create payloads (instead of a manual create-then-link flow).

#### Completion-day attribution in the journal (#367)

- A task completed on a day shows on that day's journal as a completed row labelled "Completed here". Journal reads (entries and todos) send `timezoneOffsetMinutes` so the server attributes the day in the user's timezone; the todos query key stays `['journal', entryId, 'todos']` (the offset is not in the key).
- Completing a task from a past day is optimistic: the row leaves the viewed day, joins the completed tier of today's cached list, and `completedAt` is set locally. Failure restores both caches; `['journal']` is invalidated on settle.
- A completed row with `completedAt` has no "Remove from day" control (history). One without `completedAt` keeps it.
- `isReopenBlocked` (`src/lib/journal-utils.ts`) mirrors the server's reopen rule (#350): a completed task whose completion day (from `completedAt`, else the linked day) is before the user's today. Its checkbox is a disabled `role="checkbox"` with an accessible explanation; a stale view that still reopens gets the server's 422 and the existing inline error.

#### Flat journal rows and parent context headers (#387)

- `GET /JournalEntries/{id}/todos` returns a flat list: one row per attributed task, roots and subtasks alike (`children` is never populated). Subtask rows carry `parentTaskItemId` and `parentTitle` (even when the parent is not a row of the day); every row carries `childTaskCount` and `openChildCount` (subtasks not Completed; Blocked counts as open; the generated client types it `number | string`, so `hasOpenChildren` coerces with `Number`).
- `buildJournalBlocks` (`src/lib/journal-rows.ts`) turns the rows (after undo-pending hiding) into display blocks. A parent with at least one visible open subtask row (`getOpenParentIds` in `src/lib/task-sections.ts`, the same rule as the Tasks page) is not a row: it renders as a context header, an `li.todo-context-header` with a link to `/tasks/:parentId` and "N/M subtasks complete". N/M count only that day's visible subtask rows. A parent whose open subtasks are all hidden or on other days stays a normal row. A Completed parent with Completed same-day subtasks keeps its row and also gets a header. A subtask whose parent is not a row of the day takes the header title from `parentTitle`.
- Headers are never sorted as todos: each sits at the position of its first subtask row, and its subtask rows (`li.todo-in-group`, flat siblings with an indent and a thin rule, no nested list) follow it. The header has no checkbox, id, history, block or remove control, and focus never lands on it.
- The TODOs counter (`total`, remaining, blocked) is computed from the rendered work rows only; subtask rows count as todos, headers never do. "No TODOs yet" shows only when there are no rows and no headers.
- A parent with `openChildCount > 0` has a derived status and gets no Block button and no Unblock badge in any form (header, a normal row because filters hide its subtasks, or a stale link). The predicate `hasOpenChildren` lives next to `canBlock` in `src/lib/task-status.ts`.
- `TASK_PLAN_HAS_OPEN_SUBTASKS` and `TASK_PARENT_STATUS_DERIVED` show inline messages from the code alone (the journal date in the error details is not read). Removing a parent row unlinks only that row; its subtask rows are not removed optimistically.

#### Settings-driven hierarchy behavior

The settings drawer now includes:

- `Auto-complete parent when all subtasks are done` (default off)

When enabled, task update payloads include `autoCompleteParentWhenChildrenDone`, and backend logic auto-completes a parent when the last direct child is completed.

#### Frontend error-code handling

Tasks pages map backend business-rule codes to user-friendly inline errors, including:

- `TASK_CREATION_PAST_DAY_NOT_ALLOWED`
- `TASK_REOPEN_PAST_DAY_NOT_ALLOWED`: a completed task cannot be reopened once its completion day is before the user's today. The completion day is the local day of the task's `completedAt` (derived with the `timezoneOffsetMinutes` the client sends), or, for legacy tasks with no `completedAt`, the journal day it is linked to. A task with neither is exempt and can always be reopened. `details.assignedDate` holds that day.
- `TASK_PLAN_COMPLETED_NOT_ALLOWED`: a task with a `completedAt` cannot be planned onto a `journalDate` that differs from its current link, because the journal shows it on its completion day. Sending the current link or no `journalDate` is fine. Reopen first, then plan.
- `TASK_PLAN_HAS_OPEN_SUBTASKS`: a parent with open subtasks cannot be planned onto a journal day (plan the subtasks instead). Its message is mapped only in the journal's own `getTaskActionErrorMessage` (`TodosSection.tsx`); `lib/task-errors.ts` `getTaskMutationErrorMessage` intentionally has no mapping because the Tasks page does not plan.
- `TASK_PARENT_NOT_FOUND`
- `TASK_PARENT_SELF_NOT_ALLOWED`
- `TASK_PARENT_DEPTH_NOT_ALLOWED`
- `TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN`
- `TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN`
- `TASK_PARENT_COMPLETED_NOT_ALLOWED`: mapped by `getTaskMutationErrorMessage` (not `getBlockErrorMessage`) to "A completed task can't have open subtasks. Reopen the parent first, or keep this subtask completed." Shown in the form's error banner; the form clears it when the parent or status select changes, and the update mutation refetches the task queries.
- `TASK_PARENT_STATUS_DERIVED`: mapped by `getBlockErrorMessage` to "This task's status follows its open subtasks. Complete or remove them to change it." Only reachable on a race with stale data; the optimistic change rolls back and the task queries are invalidated.

### Derived parent status (Tasks page and task detail page)

A parent with at least one open subtask (stored status not Completed) displays a status derived from its open subtasks: any In Progress gives In Progress; all Blocked gives Blocked; all Draft gives Draft; otherwise To-do. Inner parents use their own derived status, so it recurses through every level. A parent whose subtasks are all Completed, or that has none, shows its stored status and is editable.

- `src/lib/task-derived-status.ts` (`deriveTaskStatuses`) computes it in render with `useMemo` over the full, unfiltered task list. It is never written to the query cache and the stored status is never changed, so an optimistic child change updates the parent at once and rolls back with the cache. Sections, the status filter, sorting, the Blocked count and the view filter all use the derived status.
- While locked, the row badge is a non-interactive dashed `<span>` (class `t-badge-derived`), Block/Unblock are hidden, the TaskForm status select is disabled (with a helper line) and the page handlers return early. The stored blocked reason is hidden, not deleted; it shows again once every subtask is Completed and the stored status is Blocked.
- `TaskForm` always receives the stored task. When `statusLocked` it displays `displayStatus`, submits the stored status unchanged and omits `blockedReason`.
- The context header shows direct-subtask progress (`getParentProgressLabel`), e.g. "1 of 4 done · 1 in progress" (total includes Completed; the suffix appears only when at least one is In Progress).
- The journal is unchanged and keeps using the stored status.
- The derived status only drives display. The STORED status gates "Add subtask" (row and context header: `aria-disabled`, focusable, no-op, reason in `title` and a hidden description) and the Parent Task picker (`src/lib/parent-options.ts`: Completed parents are disabled and labelled "(completed)" in all three pickers; the currently selected parent stays enabled, and a selected id missing from the list shows a disabled "Current parent" option). So a Completed parent with an open child is still gated, and an open-stored parent whose derived status is Completed is not.

### TaskCard

Displays a task summary: title (linked to detail page), status and priority badges, due date. Badge classes are keyed on lowercase values; `task.status` and `task.priority` are normalised via `.toLowerCase()` before indexing the class map.

### TaskForm

A controlled form shared by both create and edit flows. Takes an optional `task` prop for edit mode. Key details:
- Status and priority initial state is normalised to lowercase from the API value
- Due date is stored as `YYYY-MM-DD` from `<input type="date">` and sent to the API as `YYYY-MM-DDT00:00:00.000Z` to avoid local timezone drift

### NoteCard / NoteForm

Straightforward note display and edit forms. `NoteCard` shows content and timestamps with edit/delete action buttons. `NoteForm` is used for both create and update.

## Environment Configuration

No frontend environment variables are required. Both `.env.development` and `.env.production` are empty.

The generated API client uses relative paths (`/api/v1/...`) by default, and routing is handled entirely by the proxy layer:

- **Dev (`npm run dev`):** Vite's dev server proxies `/api` and `/openapi` to `http://localhost:8080` — same-origin to the browser, no CORS needed.
- **Docker Compose / production:** `vite preview` (or the production reverse proxy) proxies `/api` and `/openapi` to the API container — same-origin to the browser, no CORS needed.

## Vite Dev Server Proxy

`vite.config.ts` proxies two prefixes to the API server:

```typescript
proxy: {
  '/api':     { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
  '/openapi': { target: process.env.API_TARGET ?? 'http://localhost:8080', changeOrigin: true },
},
```

- Default target: `http://localhost:8080` (API running directly on the host)
- Override for Docker: `API_TARGET=http://taskflow-api:8080 npm run dev`

This proxy means CORS is not needed when running `npm run dev` — the browser sees all requests as same-origin.

## Testing

### Running tests

```bash
# Single run (CI mode)
npm run test -- --run

# Watch mode
npm run test

# Type-check only
npm run type-check
```

### Test structure

Tests are co-located with source files as `*.test.ts(x)`. Vitest is configured in `vite.config.ts` with `globals: true` and `environment: 'jsdom'`, so tests have access to `describe`, `it`, `expect` without imports.

### Component tests

Component tests use React Testing Library. They render components with a minimal wrapper and assert on rendered output and user interactions.

```typescript
// Example: TaskCard renders title and status badge
it('renders the task title', () => {
  render(<TaskCard task={mockTask} onEdit={vi.fn()} onDelete={vi.fn()} />)
  expect(screen.getByText('My Task')).toBeInTheDocument()
})
```

### Hook tests

Hook tests use `renderHook` from `@testing-library/react` with a `QueryClientProvider` wrapper. The SDK module is mocked with `vi.mock`, allowing assertion on which function was called with which arguments without making real HTTP requests.

```typescript
vi.mock('@/api/client/sdk.gen', () => ({
  getApiV1TaskItems: vi.fn(),
  // ...
}))

it('calls getApiV1TaskItems', async () => {
  vi.mocked(sdk.getApiV1TaskItems).mockResolvedValue({ data: [], response: new Response() } as never)
  const { result } = renderHook(() => useTasksQuery(), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(sdk.getApiV1TaskItems).toHaveBeenCalledOnce()
})
```

### Coverage

There are 24 tests covering all components and all query/mutation hooks. The CI `taskflow-web` job runs tests as part of the lint → type-check → test → build pipeline.

## Docker

### Dockerfile

```dockerfile
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY vite.preview.config.js ./
EXPOSE 3000
CMD ["node_modules/.bin/vite", "preview", "--config", "vite.preview.config.js", "--host", "0.0.0.0", "--port", "3000"]
```

**Key points:**
- `npm ci` (not `npm install`) for reproducible installs in CI and Docker
- `vite preview` serves the built files and handles SPA fallback (all unmatched paths → `index.html`)
- The API client uses relative paths by default — no env var needed at build time
- `vite.preview.config.js` is copied into the runtime stage to configure the preview server proxy

### docker-compose.yml integration

```yaml
taskflow-web:
  container_name: taskflow-web
  image: taskflow-web:dev
  build:
    context: ./TaskFlow.Web
    dockerfile: Dockerfile
  ports:
    - "3000:3000"
  restart: unless-stopped
  depends_on:
    taskflow-api:
      condition: service_healthy
```

The web service waits for `taskflow-api` to pass its health check before starting. The API client uses relative paths by default, so the browser sends same-origin requests to the `vite preview` server (port 3000). That server proxies `/api` and `/openapi` to `http://taskflow-api:8080` inside the Docker network via `vite.preview.config.js`. CORS configuration is not needed since all requests appear same-origin to the browser.

> **Note for local dev:** Running `npm run dev` and `docker compose up` simultaneously may cause port conflicts on 5173 vs 3000 but not on 8080. The dev server proxies to port 8080 either way.

## CI Integration

The `taskflow-web` CI job runs in parallel with the existing `lint` job:

```yaml
taskflow-web:
  runs-on: ubuntu-latest
  steps:
    - npm ci
    - npm run lint
    - npm run type-check
    - npm run test -- --run
    - npm run build
```

Failures in any step block the PR. The build step verifies the production bundle compiles cleanly with the production env vars.

## Troubleshooting

### "Failed to load tasks" / API calls returning 404

- Confirm the API is running: `curl http://localhost:8080/health`
- If using `npm run dev`, check the Vite proxy is targeting the right host (default: `localhost:8080`)
- If the Vite proxy is not routing correctly, check `vite.config.ts` — the proxy target defaults to `http://localhost:8080` and can be overridden with `API_TARGET`

### Status filter not working

The API returns status and priority as PascalCase strings (`"Draft"`, `"High"`) because `TaskItemResponseDto` stores them as `string` via `Status.ToString()`. The frontend normalises to lowercase via `.toLowerCase()` before the Status filter comparison and badge lookups. All five statuses are checked by default, so Completed tasks are listed, in a collapsed Completed section at the bottom of the page. If you see this breaking after a `gen:api` regeneration, check whether the API DTO types changed from `string` to an actual enum type.

### Tasks page sections and context headers

`/tasks` groups work rows by each task's own status and priority (`src/lib/task-sections.ts`). Sections appear in this order, and empty sections are hidden: In Progress, High, Medium, Low, Blocked, Draft, Completed. Todo tasks (and tasks with an unrecognized status) go to a priority section; a missing or unrecognized priority counts as High. Blocked and Completed start collapsed. The collapse choice is stored under `taskflow_tasks_section_collapse_v2` and written only when the user toggles a section; the old `taskflow_tasks_collapsed_groups_v1` key is ignored. Section and footer counts are work rows only.

A parent with at least one open subtask (anything not Completed, so Blocked counts as open) has no work row. It appears as a context header above its subtasks in every section that holds one: the path from the top-level goal to the nearest parent, a link to the nearest parent's detail page and an Add subtask button. Headers have no status, Edit, Delete or collapse control. A parent with no open subtasks is a normal row, and its completed subtasks sit in Completed under a header for it. If filters hide all of a parent's open subtasks, the parent stays a normal row so it doesn't vanish from the list.

Changing a row's status re-sections it at once and keeps focus on its status control (`data-task-status-id`). When the destination section is collapsed, focus goes to that section's toggle (`data-section-toggle`) and the section is not expanded.

### API client out of date after backend changes

Run `npm run gen:api` with the API running at `http://localhost:8080` to regenerate. TypeScript errors will surface anywhere the old types are no longer compatible.

### Docker: frontend shows blank page

- Check browser console for network errors
- Verify CORS: the API's `appsettings.Development.json` must include the frontend origin in `Cors:AllowedOrigins`
- Verify `vite.preview.config.js` proxy is pointing at the correct API target (`API_TARGET` env var, default `http://taskflow-api:8080`)

---

[← Back to README](../README.md) | [Getting Started →](GETTING_STARTED.md) | [Architecture →](ARCHITECTURE.md)
