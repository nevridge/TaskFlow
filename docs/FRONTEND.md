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

- Node.js 20+
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

Note: `docker compose up` serves the **production build** of the frontend via `serve -s dist`. For hot-reload development, run `npm run dev` separately and point it at the running API container.

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
├── .env.development                # VITE_API_BASE_URL=http://localhost:8080
├── .env.production                 # VITE_API_BASE_URL=/api
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
- `throwOnError: true` (set at client level) ensures errors propagate to React Query's `error` field rather than silently resolving as success

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

Two routes:
- `/` → `TasksPage` (task list)
- `/tasks/:id` → `TaskDetailPage` (task detail + notes)

## API Client Generation

The `gen:api` npm script invokes `@hey-api/openapi-ts`:

```json
"gen:api": "openapi-ts --input http://localhost:8080/openapi/v1.json --output ./src/api/client --client @hey-api/client-fetch"
```

**When to regenerate:**
- After any change to the API's request/response shapes, routes, or model properties
- When adding new endpoints that the frontend needs to call

**The generated client instance (`client.gen.ts`):**

```typescript
export const client = createClient(createConfig<ClientOptions2>({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  throwOnError: true,
}));
```

- `baseUrl` is injected at build time from `VITE_API_BASE_URL`
- `throwOnError: true` means non-2xx responses throw, which React Query routes to `isError` / `error` rather than treating as success

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

// Delete — invalidates list, removes detail from cache
useDeleteTaskMutation()
```

### Note hooks

```typescript
// Fetch notes for a task (skipped if taskId is invalid)
useNotesQuery(taskId: number)

// Mutations — all invalidate noteKeys.all(taskId)
useCreateNoteMutation(taskId: number)
useUpdateNoteMutation(taskId: number)
useDeleteNoteMutation(taskId: number)
```

## Pages and Components

### TasksPage (`/`)

The task list page. Responsibilities:
- Fetch all tasks via `useTasksQuery`
- Filter by status and priority (client-side, `.toLowerCase()` normalization applied to API values)
- Sort by title, due date, or priority
- Open create/edit modal inline (no separate route)
- Delegate delete to `useDeleteTaskMutation`

The filter dropdowns use lowercase option values (`draft`, `todo`, `completed`) while API values are PascalCase (`Draft`, `Todo`, `Completed`). Normalisation happens at the filter comparison site, not in the hook or component props.

### TaskDetailPage (`/tasks/:id`)

The task detail page. Responsibilities:
- Parse and validate `id` from route params — renders an error state if `Number(id)` is not finite
- Fetch task via `useTaskQuery(taskId)` (`enabled: Number.isFinite(taskId)`)
- Fetch notes via `useNotesQuery(taskId)`
- Inline edit task (replaces title/detail with `TaskForm`)
- Delete task — navigates back to `/` on success
- Inline note creation, editing, and deletion

### TaskCard

Displays a task summary: title (linked to detail page), status and priority badges, due date. Badge classes are keyed on lowercase values; `task.status` and `task.priority` are normalised via `.toLowerCase()` before indexing the class map.

### TaskForm

A controlled form shared by both create and edit flows. Takes an optional `task` prop for edit mode. Key details:
- Status and priority initial state is normalised to lowercase from the API value
- Due date is stored as `YYYY-MM-DD` from `<input type="date">` and sent to the API as `YYYY-MM-DDT00:00:00.000Z` to avoid local timezone drift

### NoteCard / NoteForm

Straightforward note display and edit forms. `NoteCard` shows content and timestamps with edit/delete action buttons. `NoteForm` is used for both create and update.

## Environment Configuration

| File | `VITE_API_BASE_URL` | When used |
|------|-------------------|-----------|
| `.env.development` | `http://localhost:8080` | `npm run dev` |
| `.env.production` | `http://localhost:8080` | `npm run build` (Docker Compose image) |

`VITE_API_BASE_URL` is baked into the bundle at build time by Vite. The value must be the API **origin only** — the generated SDK paths already include `/api/v1/...`, so setting this to `/api` would produce double-prefixed requests like `/api/api/v1/...`.

- **Docker Compose (no reverse proxy):** use `http://localhost:8080` — the browser resolves requests to the API on port 8080.
- **Same-origin production (behind a reverse proxy):** use an empty string — requests resolve against the current origin.
- **Do not** set this to `/api` or any path prefix.

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
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
```

**Key points:**
- `npm ci` (not `npm install`) for reproducible installs in CI and Docker
- `serve -s` enables SPA fallback — all paths serve `index.html` so React Router handles routing
- The build stage bakes `VITE_API_BASE_URL=/api` from `.env.production` into the bundle

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

The web service waits for `taskflow-api` to pass its health check before starting. The frontend image is built with `VITE_API_BASE_URL=http://localhost:8080` baked in from `.env.production`, so the browser makes cross-origin requests directly to the API on port 8080. CORS is handled by the API's `CorsServiceExtensions`, which reads `Cors:AllowedOrigins` from `appsettings.Development.json`.

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
- If `VITE_API_BASE_URL` is wrong in `.env.development`, fix it and restart `npm run dev` (env changes require a restart)

### Status/priority filters not working

The API returns status and priority as PascalCase strings (`"Draft"`, `"High"`) because `TaskItemResponseDto` stores them as `string` via `Status.ToString()`. The frontend normalises to lowercase via `.toLowerCase()` before filter comparisons and badge lookups. If you see this breaking after a `gen:api` regeneration, check whether the API DTO types changed from `string` to an actual enum type.

### API client out of date after backend changes

Run `npm run gen:api` with the API running at `http://localhost:8080` to regenerate. TypeScript errors will surface anywhere the old types are no longer compatible.

### Docker: frontend shows blank page

- Check browser console for network errors
- Verify CORS: the API's `appsettings.Development.json` must include the frontend origin in `Cors:AllowedOrigins`
- Verify `VITE_API_BASE_URL` was correct at build time (it's baked in — rebuild the image if it changed)

---

[← Back to README](../README.md) | [Getting Started →](GETTING_STARTED.md) | [Architecture →](ARCHITECTURE.md)
