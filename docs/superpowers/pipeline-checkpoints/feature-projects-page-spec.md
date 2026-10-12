# Technical Brief: Projects Page (Story A, issue #225)

**Date:** 2026-10-12
**Status:** Draft (open questions resolved)
**Author:** Spec Writer Agent
**Branch:** `feature/projects-page`. Frontend-only. Story B (#228) owns the assignment UI.

## 0. Corrections to the researcher findings (read first)

I verified these in the source. They change the implementation.

1. **Errors do NOT throw at runtime unless `throwOnError: true` is passed per call.**
   - `client.gen.ts` is `createClient(createConfig<ClientOptions2>())`. Nothing in `src/` calls `setConfig` or registers an interceptor.
   - `client/client/client.gen.ts:75` reads `options.throwOnError ?? _config.throwOnError`. That is `undefined` today.
   - At line 210, `if (throwOnError) throw finalError`. Otherwise it returns `{ error, request, response }` with `data` undefined (lines 215-221).
   - The `true` in `client.get<{200:T}, unknown, true>` in `journal.ts` and `tasks.ts` is a type-level generic only. It does not set the runtime flag.
   - Consequence: a bare `client.put<..., true>({...})` that gets a 409 **resolves successfully** with `{ error: { message } }`. `useMutation.onError` never fires and the list would look saved.
   - The existing `getErrorCode` helpers probably never see a real error for the same reason. That is an existing latent issue and out of scope (see Follow-up).
   - **Requirement:** every function in `projects.ts` passes `throwOnError: true` in its options object. With that flag, the thrown value is `jsonError ?? textError`, so the 409 gives `{ message: string }`, as the researcher said. A 404 on `GET /Projects/{id}` also throws, which gives `isError` for the not-found state.
   - Add a test in `projects.test.ts` that the options include `throwOnError: true`.
   - Add an integration-style test with a mocked `fetch` returning 409 JSON, to prove the rejection end to end.
2. **The 400 body is not `{ message }`.** `ProjectsController` returns `BadRequest(validationResult.Errors)`, a FluentValidation array of `{ propertyName, errorMessage, ... }` (camel-cased by JSON).
   - The shared helper must also handle arrays.
   - Client-side validation prevents most 400s. Treat a 400 as the fallback "Could not save project".
3. **The server trims `Name`** (`Name?.Trim()`). A whitespace-only name becomes empty and returns 400.
   - Client rule: trim before validating, so whitespace-only is "empty".
   - Length is measured on the trimmed value. Description is not trimmed server-side.
4. **`GET /Projects/{id}/tasks` returns `TaskItemResponseDto` with `projectId` and `projectName`.** These fields may be absent from today's generated `types.gen.ts` and will appear after `gen:api`. Task `status` and `priority` are PascalCase strings (`t.Status.ToString()`).
5. **The 404 for a missing project on `/tasks` and `PUT` is a bare `NotFound()`**, with an empty or ProblemDetails body. The thrown value may be an object without `message`, or a string. The helper falls back to a generic string.
6. **The generated `id` and count types are loose** (`number | string`, as in `TaskItemResponseDto`). `projects.ts` defines its own strict types, as `journal.ts` does, so the UI does not depend on them.

## 1. Overview

Add a Projects area to the web app. `/projects` lists projects with name and open/completed counts, and has a create form, inline rename/description edit, archive/unarchive, and a client-side "Show archived" toggle. `/projects/:id` shows the project header and its tasks, with empty and not-found states. A new `projects.ts` API module and `useProjects` hook are built for Story B to reuse. This includes assign/unassign mutations that have no UI in this story.

**Assumptions and decisions**
- A1: Hand-written `projects.ts` defines its own DTO types (the `journal.ts` pattern). `gen:api` is still run and committed (only `src/api/client/**`), but app code does not import the generated project types.
- A2 (decided): Editing is available from both the list row and `/projects/:id`, using the shared `ProjectForm` with Save/Cancel.
- A3: Project rows link to `/projects/:id`.
- A4: Archive/unarchive is a button that sends a full PUT with the current name and description and the flipped `isArchived`.
- A5: The "Show archived" toggle is a labeled checkbox, `useState(false)`.
- A6: Tasks on the detail page are read-only rows (title, status badge, priority, due date). Each row links to `/tasks/:id`. No project column.
- A7: The 30s `staleTime` and `retry: 1` defaults in `main.tsx` apply, except where overridden below. The single-project and project-tasks queries use `retry: false`.
- A8 (decided): A trimmed-empty description is sent as `null`, never `""`.
- A9 (decided): The detail page shows one generic "Project not found." state for any project-query error, including network failures.
- A10 (decided): Count freshness is handled on the Projects list only. The list query uses a short `staleTime` and `refetchOnMount`. Existing task hooks are not touched.

## 2. Scope and non-goals

**In scope:** ACs 1-7, Nav item, routes, CSS, tests, `gen:api` regeneration, the shared error helper.

**Non-goals:** assigning, moving or unassigning tasks (including any UI for the mutations that are built). Project display on TaskCard, TaskListRow or TaskDetailPage. A TasksPage filter. ProjectChanged history. Deleting a project from the UI (`deleteProject` is in the API module and hook for completeness only, with no button). API changes. The journal TodosSection tag. Analytics and notifications. Persisting the toggle. Changes to the existing `getErrorCode` helpers or to task hooks.

## 3. Files

**New**
- `TaskFlow.Web/src/api/projects.ts`: types and functions (section 4).
- `TaskFlow.Web/src/api/projects.test.ts`: URL, method, body, `throwOnError` and path assertions with `client` mocked.
- `TaskFlow.Web/src/hooks/useProjects.ts` and `useProjects.test.ts`.
- `TaskFlow.Web/src/lib/api-error.ts` and `api-error.test.ts`: shared `getApiErrorMessage(error, fallback)` helper.
- `TaskFlow.Web/src/lib/project-validation.ts` and test: `validateProject({name, description})` returning `{ name?: string; description?: string }`.
- `TaskFlow.Web/src/pages/ProjectsPage.tsx` and `.test.tsx`.
- `TaskFlow.Web/src/pages/ProjectDetailPage.tsx` and `.test.tsx`.
- `TaskFlow.Web/src/components/ProjectForm.tsx` and `.test.tsx`: used for create, and for edit on both the list and the detail page.
- `TaskFlow.Web/src/components/ProjectRow.tsx` and `.test.tsx`: row with name link, counts, description, Edit and Archive/Unarchive buttons.
- `TaskFlow.Web/src/projects.css`: `.projects-page` scope.

**Modified**
- `TaskFlow.Web/src/App.tsx`: inside `<Route element={<Layout />}>` add `/projects` and `/projects/:id`. Order does not matter.
- `TaskFlow.Web/src/components/Nav.tsx`: add `isProjects = pathname.startsWith('/projects')` and a Projects `Link` after Tasks, with the same `app-nav-link` and `is-active` pattern.
- `TaskFlow.Web/src/components/Nav.test.tsx`: new cases. Existing queries use `/tasks/i` and `/journal/i`, and "Projects" matches neither, so they stay valid. Use `{ name: /^projects$/i }` for the new link.

**Regenerated (never hand-edit)**
- `TaskFlow.Web/src/api/client/sdk.gen.ts` and `types.gen.ts` (and any other file the generator rewrites under `src/api/client/`). Run `npm run gen:api` with the API running on `localhost:8080`. Do not change `openapi-ts.config.ts`. Check `git diff` contains only `src/api/client/**`. If the diff is huge, the generator version has drifted. Flag it in the PR.

Other: do not touch `docker-compose.yml`. Add no `localStorage` keys. Do not modify `TasksPage.tsx`, `TaskDetailPage.tsx`, `TodosSection.tsx` or `useTasks.ts`.

## 4. API module: `src/api/projects.ts`

```ts
import { client } from './client/client.gen'

export type ProjectResponseDto = {
  id: number
  name: string
  description?: string | null
  isArchived: boolean
  createdAt: string
  updatedAt?: string | null
  openTaskCount: number
  completedTaskCount: number
}
export type CreateProjectDto = { name: string; description?: string | null }
export type UpdateProjectDto = { name: string; description?: string | null; isArchived: boolean }
export type ProjectTaskDto = {                 // PascalCase enums on the wire
  id: number; title: string; description?: string | null
  isComplete: boolean; dueDate?: string | null
  status: 'Draft' | 'Todo' | 'Completed'       // verified against TaskFlow.Api/Models; no 'InProgress'
  priority: 'Low' | 'Medium' | 'High'
  parentTaskItemId?: number | null
  projectId?: number | null; projectName?: string | null
}
const J = { 'Content-Type': 'application/json' }
const T = { throwOnError: true } as const

getProjects(): client.get<{200: ProjectResponseDto[]}, unknown, true>({ url:'/api/v1/Projects', ...T })
getProject(id: number)                      // GET /api/v1/Projects/{id}, path:{id}
getProjectTasks(id: number)                 // GET /api/v1/Projects/{id}/tasks -> ProjectTaskDto[]
createProject(body: CreateProjectDto)       // POST, 201, headers J
updateProject(id: number, body: UpdateProjectDto)  // PUT, 200, headers J
deleteProject(id: number)                   // DELETE, 204 (no UI this story)
assignTaskToProject(id: number, taskItemId: number)   // POST /{id}/tasks body {taskItemId}, 204
unassignTaskFromProject(id: number, taskItemId: number) // DELETE /{id}/tasks/{taskItemId}, 204
```

Notes:
- Return types follow the existing modules: the raw client result `{ data }`, with consumers using `result.data`, as `TasksPage` does at `data?.data`.
- Delete, assign and unassign return 204, so `data` is `{}` or undefined (the client returns `{}` for an empty body). Do not read it.
- Status badge rendering must cover all three values: `Draft`, `Todo`, `Completed`. Use strict PascalCase comparisons.

## 5. Hook API: `src/hooks/useProjects.ts`

```ts
export const projectKeys = {
  all: ['projects'] as const,                          // list
  detail: (id: number) => ['projects', id] as const,
  tasks: (id: number) => ['projects', id, 'tasks'] as const,
}
useProjectsQuery()             // key all, fn getProjects, short staleTime (e.g. 5_000) and refetchOnMount: 'always'
useProjectQuery(id)            // key detail(id), enabled Number.isFinite(id), retry: false
useProjectTasksQuery(id)       // key tasks(id), enabled Number.isFinite(id), retry: false
useCreateProjectMutation()
useUpdateProjectMutation()     // vars { id, data: UpdateProjectDto }
useDeleteProjectMutation()     // vars id
useAssignProjectTaskMutation() // vars { projectId, taskItemId }
useUnassignProjectTaskMutation()
```

Count freshness (decided): task mutations elsewhere do not invalidate project keys, and they stay untouched. `useProjectsQuery` overrides the global 30s `staleTime` with a short value and `refetchOnMount: 'always'`, so navigating to `/projects` always refetches counts. Story B can add cross-invalidation if needed.

Invalidation note: TanStack prefix matching means `invalidateQueries({queryKey: ['projects']})` also invalidates the detail and tasks keys. List the specific keys explicitly anyway for readability, as `useUpdateTaskMutation` does.

**Invalidation matrix**

| Mutation | Invalidate | Other |
|---|---|---|
| create | `projectKeys.all` | none |
| update | `projectKeys.all`, `projectKeys.detail(id)` | none |
| delete | `projectKeys.all` | `removeQueries` for `detail(id)` and `tasks(id)`. Also invalidate `taskKeys.all` (imported from `useTasks.ts`, read-only import), because tasks lose their project |
| assign | `projectKeys.all` (counts), `projectKeys.tasks(projectId)` | `taskKeys.all` so task `projectName` refreshes |
| unassign | same as assign | same |

- **Two quick edits (full-replace overwrite):** controls are disabled while the mutation is `isPending`, and the edit form seeds from the latest server data on open. That limits but does not eliminate lost updates (a second tab can still overwrite). The API has no concurrency token (see risk 5).

## 6. Shared error helper: `src/lib/api-error.ts`

```ts
export function getApiErrorMessage(error: unknown, fallback: string): string
```
- If `error` is a non-empty string, return it only when it is short plain text. A string that looks like HTML (starts with `<`) or is longer than about 200 chars returns the fallback.
- If an object with a non-empty string `message`, return that. This is the 409 case.
- If an array whose first element has a string `errorMessage` (FluentValidation 400), return that.
- Otherwise return `fallback`.
- The three private `getErrorCode` copies are not migrated in this PR (see Follow-up).

Tests: object with message, plain string, HTML string, empty/undefined/null/number, array of validation errors, object without message, empty-string message.

## 7. Page and component behavior

**ProjectsPage (`/projects`)**
- Wrapper: `<div className="projects-page"><div className="p-shell">…`. Do not import `tasks.css`; use `p-` prefixed classes in `projects.css`.
- Heading `h1` "Projects". Create form: Name input (no native `maxLength`, so the validation message can show), Description textarea, "Create project" button.
- "Show archived" checkbox, label text exactly `Show archived`, unchecked by default, session-only `useState`.
- Filtering: `visible = showArchived ? projects : projects.filter(p => !p.isArchived)`. The API orders by Name, so no client sort is needed. Archived rows get a visible "Archived" badge, and the action button reads "Unarchive".
- States:
  - **Loading:** `role="status"` "Loading projects…".
  - **Error:** `role="alert"` "Failed to load projects." with a Retry button (`refetch`).
  - **Empty, none at all:** "No projects yet. Create one above."
  - **Empty, only archived with toggle off:** "No active projects. Turn on "Show archived" to see N archived project(s)." Use `projects.length > 0 && visible.length === 0`.
  - **Normal:** `ul` of rows: name (link), "{open} open · {completed} completed", description (truncated).
- Long text: `overflow-wrap: anywhere` on name and description, and a CSS line-clamp on description in the list (full text on the detail page and in the edit form).
- Create flow: validate with `validateProject`. On invalid, show per-field messages, set `aria-invalid`, and do not call the API. On submit, call the mutation. A trimmed-empty description is sent as `null`. On success, clear the form. On error, show `getApiErrorMessage(err, 'Could not create project.')` in a `role="alert"` region and keep the user's input. No duplicate row appears because nothing is added to the cache on error.
- Edit flow: Edit button opens `ProjectForm` prefilled (name, description). Save sends **all three** fields (`name`, `description`, `isArchived` from the current server value). Cancel discards. 409 shows the API message inline and keeps the form open.
- Archive toggle button: sends a full PUT with the flipped flag. On error, show the message on that row.
- Save and archive buttons are disabled while their mutation is pending.

**ProjectDetailPage (`/projects/:id`)**
- Parse `Number(useParams().id)`. A non-finite id renders the not-found state without a fetch (the queries are `enabled: Number.isFinite`).
- Loading: `role="status"`. Not-found (project query `isError`, any cause, including 404, deleted elsewhere, and network failure): `role="alert"` "Project not found." with a link back to `/projects`. No separate network-error message.
- Success: `h1` project name, "Archived" badge if applicable, description, counts, an Edit button that opens the shared `ProjectForm` (same save/409/validation behavior as the list), and a "Back to projects" link.
- Tasks section: heading "Tasks". Loading, then error ("Failed to load tasks."), then empty state with the exact copy **"No tasks in this project yet"** (no trailing period, no extra text), else a list.
- Task row: title linking to `/tasks/:id`, a status badge from `task.status` (`Draft`, `Todo`, `Completed`; strict PascalCase compare), priority (`Low`, `Medium`, `High`), due date if any.
- If the tasks query errors with the project still cached (for example deleted elsewhere), show the not-found state.

**Accessibility**
- One `h1` per page.
- Every input has a `<label>` ("Name", "Description").
- Errors use `role="alert"` and `aria-describedby`/`aria-invalid` on the field.
- The toggle is a real `<input type="checkbox">` with a label.
- Buttons have unique accessible names: `aria-label="Edit {name}"`, `"Archive {name}"`, `"Unarchive {name}"`.
- Nav: the Projects link keeps the `app-nav-link` and `is-active` pattern, consistent with the existing links.
- Focus: after opening edit, focus the Name input. After cancel or save, return focus to the Edit button.
- Lists are semantic `ul`/`li`. Counts are text, not color-only. The Archived badge has text.

**Styling**
- `src/projects.css` scoped under `.projects-page`, with `--bg --ink --line --paper --shadow-md --radius --accent` custom properties. Check `tasks.css:3-14` for the `.tasks-page` and `.tasks-page button` reset pattern and mirror it. If you add a `.projects-page button` reset (specificity 0-1-1), every button with its own border or background must use `.projects-page .p-btn` (0-2-0). Inputs and textareas need the same care.
- The `is-dark` / `data-theme` handling comes from `PrefsContext` on `documentElement`. Use the shared custom properties and verify in dark mode.
- Import `'@/projects.css'` from both pages, as the tasks pages do with `tasks.css`.

## 8. Test plan (Vitest, jsdom, colocated)

Conventions: `vi.clearAllMocks()` in `beforeEach`. Hook tests use `makeWrapper()` (copy from `useTasks.test.ts`). Role-based queries. PascalCase fixtures (`status: 'Draft' | 'Todo' | 'Completed'`, `priority: 'Low' | 'Medium' | 'High'`). Page tests use `MemoryRouter` with `Routes` for `:id`, and mock `@/hooks/useProjects` or `@/api/projects`.

| AC | Test (file) | Verifies |
|---|---|---|
| 1 | ProjectsPage: "lists active projects with name, open and completed counts" | rows and counts |
| 1 | Nav.test: "renders Projects link to /projects", "marks Projects active on /projects and /projects/3" | Nav item |
| 2 | ProjectsPage: "hides archived by default", "shows archived when 'Show archived' is checked", "toggle defaults unchecked and writes nothing to localStorage" | AC2 |
| 3 | ProjectForm/ProjectsPage: "creates project with name and description", "clears form after success", "empty description sent as null" | AC3 |
| 3/7 | validation: name length 1 and 100 pass, 101 fails, description 2000 passes, 2001 fails | AC3/7 |
| 4 | ProjectsPage/ProjectRow/ProjectDetailPage: "rename sends name, description and isArchived", "edit description sends all three fields", "archive sends isArchived true with current name/description", "unarchive sends false", "edit from detail page uses same full-replace payload" | AC4 (assert exact `updateProject` args) |
| 5 | ProjectsPage: "create 409 shows API message and adds no row", "rename 409 shows API message, form stays open, list unchanged" | AC5 |
| 5 | api-error.test, projects.test | thrown shapes, and `throwOnError: true` (section 0) |
| 6 | ProjectDetailPage: "lists tasks from the project", "shows 'No tasks in this project yet' when empty", "shows 'Project not found.' when project query errors (including network error)", "invalid id shows not-found", "Completed task renders Completed badge", "Draft and Todo render their badges" | AC6 |
| 7 | ProjectForm/ProjectsPage: "empty name not saved and error shown", "whitespace-only name rejected", "101-char name rejected", "2001-char description rejected" (assert the mutation/API is not called) | AC7 |
| edge | ProjectsPage: "no projects empty state", "only archived with toggle off shows archived hint", "long name renders with wrap class", "pending state disables Save" | edge cases |
| hooks | `useProjects.test.ts`: each query calls the right API with the id, `enabled` false for NaN, list query uses short staleTime/refetchOnMount, and per mutation the **invalidation matrix** (spy on `invalidateQueries` and `removeQueries`) | section 5 |

**Coverage impact:** roughly 600-800 new lines of source, all with direct tests. Expect the new files at 90%+ line coverage, so the global 80% gate should hold or improve. `src/api/client/**` is excluded from coverage (`vite.config.ts`), so the regenerated code does not dilute it. `projects.ts` is not excluded, so it needs its own test (included above). Run `npm run test -- --run --coverage` before the PR.

## 9. Implementation order

1. Start the API and run `npm run gen:api`. Review that the diff is limited to `src/api/client/**`. Commit as `chore: regenerate api client for projects`.
2. `lib/api-error.ts` and `lib/project-validation.ts`, with tests.
3. `api/projects.ts` and tests (with `throwOnError: true`).
4. `hooks/useProjects.ts` and tests (invalidation matrix).
5. `projects.css`, `ProjectForm`, `ProjectRow`, with tests.
6. `ProjectsPage`, then `ProjectDetailPage`, with tests.
7. `App.tsx` routes and `Nav.tsx` plus `Nav.test.tsx`.
8. Run `npx tsc --noEmit`, the full test run with coverage, and a manual pass in the browser including dark mode, 409 and not-found.
9. PR with Conventional Commits (`feat: add projects page`).

## 10. Risks

1. **Silent non-throwing errors (section 0).** Likelihood: High if missed. Mitigation: pass `throwOnError: true` in every `projects.ts` call, and add a test.
2. **400 body shape differs from 409.** Likelihood: Medium. Mitigation: the helper handles arrays, and client validation prevents most 400s.
3. **Enum casing.** Task `status` (`Draft`, `Todo`, `Completed`) and `priority` (`Low`, `Medium`, `High`) are PascalCase strings. Likelihood: Medium. Mitigation: `status === 'Completed'`, PascalCase fixtures.
4. **CSS specificity.** A `.projects-page button` reset would override single-class buttons. Likelihood: Medium. Mitigation: two-class selectors (`.projects-page .p-btn`).
5. **Full-replace PUT can overwrite concurrent edits.** There is no ETag or concurrency token. Likelihood: Low. Mitigation: disable controls while pending, seed the edit form from fresh data, and accept the residual risk.
6. **Count staleness outside the Projects list.** Task mutations elsewhere do not invalidate project keys. Likelihood: Medium. Mitigation (decided): short `staleTime` and `refetchOnMount: 'always'` on the list query, so counts refresh on each visit. The detail page header counts come from the single-project query, which has the default staleTime. Use the same short `staleTime` and `refetchOnMount` there for consistency. Story B can add cross-invalidation.
7. **`gen:api` drift/commit hygiene.** The generator may reformat unrelated files, or the config host may be changed locally. Likelihood: Medium. Mitigation: diff review, never commit config changes.
8. **Coverage gate at 80%.** Likelihood: Low. Mitigation: tests for every new file, and run coverage locally.
9. **Generic not-found conflates network errors with deleted projects.** Likelihood: Medium. Mitigation: accepted product decision. `retry: false` keeps it fast.
10. **Journal sync:** none. No journal endpoints are touched, so `journal.ts` needs no change.

## 11. Suggested follow-up (not part of this PR; nothing to be filed by this agent)

Suggested separate issue: "Consolidate duplicated `getErrorCode` helpers and set runtime `throwOnError`."
- Three private copies of `getErrorCode` exist (`TasksPage.tsx:504`, `TaskDetailPage.tsx:214`, `TodosSection.tsx:363`).
- The shared client has no runtime `throwOnError`, because the `true` generic is type-only. Errors from existing SDK and hand-written calls resolve as `{ error }` instead of rejecting, so those helpers and mutation `onError` handlers may never fire.
- Proposed work: decide between global `client.setConfig({ throwOnError: true })` and per-call flags, then migrate the helpers to `src/lib/api-error.ts`.
- This PR changes none of those files.

## 12. Open Questions

None.
