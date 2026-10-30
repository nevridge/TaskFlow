# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskFlow is a personal task and daily journal management application. It consists of a .NET 10 REST API (`TaskFlow.Api`) and a React frontend (`TaskFlow.Web`). The app is self-hosted via Docker and Portainer, with production running at `taskflow.skalaforge.com`. The primary user is the repository owner.

## Commands

```bash
# Backend — run
dotnet run --project TaskFlow.Api

# Backend — test (all)
dotnet test

# Backend — test (single)
dotnet test --project TaskFlow.Api.Tests --filter-method "TaskFlow.Api.Tests.Repositories.TaskRepositoryTests.GetAllAsync_ShouldReturnAllTasks"

# Backend — test with coverage (coverlet.MTP; cobertura lands in ./TestResults)
dotnet test --project TaskFlow.Api.Tests --coverlet --coverlet-output-format cobertura

# Backend — format check (CI enforces this)
dotnet format --verify-no-changes

# Frontend — install deps (first time or after pulling)
cd TaskFlow.Web && npm install

# Frontend — dev server (proxies /api → http://localhost:8080)
cd TaskFlow.Web && npm run dev

# Frontend — type-check (what CI runs; plain `npx tsc --noEmit` checks nothing here because tsconfig.json is solution-style)
cd TaskFlow.Web && npm run type-check

# Frontend — test (all, single run)
cd TaskFlow.Web && npm run test -- --run

# Frontend — test (watch mode, for development)
cd TaskFlow.Web && npm run test

# Frontend — test (single file)
cd TaskFlow.Web && npm run test -- --run src/hooks/useJournal.test.ts

# Frontend — test with coverage (enforces 80% line threshold)
cd TaskFlow.Web && npm run test -- --run --coverage

# Frontend — regenerate typed API client from live OpenAPI spec (API must be running)
cd TaskFlow.Web && npm run gen:api

# Docker (dev — includes Seq logging UI at http://localhost:5380)
docker compose up -d

# Docker (production)
docker compose -f docker-compose.prod.yml up

# Docker (isolated test project: 3200 web / 8280 API, beside the live stack; for feature branches and /ux-test)
docker compose -p taskflow-test -f docker-compose.test.yml up -d --build
docker compose -p taskflow-test -f docker-compose.test.yml down -v   # -p is mandatory
# Rebuild the live stack only from `main`. Behind a TLS-inspecting proxy add `-f docker-compose.test.local.yml` (local, gitignored). See docs/DOCKER_CONFIGURATION.md ("Live vs Test Stack Workflow").
```

## Shell & Command Execution

Two execution tools are available on this Windows machine:

- **Bash tool** — runs POSIX shell (WSL/Git Bash). Use for cross-platform CLIs: `git`, `npm`, `dotnet`, `docker`, `gh`, `node`, `python3`.
- **PowerShell tool** — runs `pwsh`. Use for Windows operations requiring PowerShell cmdlets.

**Never mix them:** Do not run `Get-ChildItem`, `Test-Path`, or `Select-String` through the Bash tool. Do not run `grep`, `find`, `xargs`, `sed`, `awk`, or `head`/`tail` through the PowerShell tool.

**`rg` (ripgrep) is installed natively on Windows** — works in both Bash and PowerShell without WSL. Use it when a shell-level content search is needed and the Grep tool is not appropriate.

**Prefer dedicated tools over shell commands:**
- Find files → Glob tool (not `find` or `Get-ChildItem`)
- Search content → Grep tool (not `grep` or `Select-String`); shell fallback: `rg`
- Read files → Read tool (not `cat` or `Get-Content`)

## Architecture

**Extension method pattern** — `Program.cs` stays clean by delegating all service registration to methods in `Extensions/`. Each extension file owns one concern (persistence, versioning, health checks, OpenTelemetry, validation, JSON, OpenAPI). Adding a new cross-cutting concern means a new extension file, not touching `Program.cs`.

**API versioning** uses both URL path (`/api/v1/TaskItems`) and request header (`x-api-version`). Controllers live in `Controllers/V1/` and are decorated with `[ApiVersion("1.0")]`.

**Migrations run on startup** when `Database:MigrateOnStartup` is `true` (default in Docker).

## Coding Conventions

- **Repository Pattern** — no direct `DbContext` access outside of repository classes
- **New validators** go in `Validators/` and are auto-discovered via `AddValidatorsFromAssemblyContaining` — no manual registration needed
- **New cross-cutting concerns** go in a new `Extensions/` file — do not add service registrations to `Program.cs` directly
- **Auto-generated files** (`src/api/client/sdk.gen.ts`) must never be manually edited — run `npm run gen:api` to regenerate (inside feature-factory, only the backend-builder regenerates, using `npx openapi-ts -i <spec url>` against the launch-profile port 5290 instead)
- **C# naming:** PascalCase for types and members, camelCase for local variables

## Frontend

**API client:** `src/api/client/sdk.gen.ts` is auto-generated — do not edit. Hand-written API modules (e.g. `src/api/journal.ts`) use the same `client` singleton from `client.gen.ts` with the pattern `client.get<{ 200: T }, unknown, true>({ url, path?, body?, headers? })`.

**Journal feature** (`/journal/:date`, URL format MM-DD-YYYY):
- Route auto-redirects `/` to today's journal date
- Entry is auto-created on first visit via `useEnsureJournalEntry` in `src/hooks/useJournal.ts`
- Todos are existing `TaskItem` records linked via a many-to-many join (`JournalEntryTaskItem`)
- Log entries are separate `JournalLogEntry` records embedded in the entry response
- Notes are separate `JournalNote` records (add and edit via textarea: Enter saves, Shift+Enter inserts a newline, double-click to edit), shown with a small formatter (`src/lib/notes-format.ts`) that renders `-`/`*` bullet lists and `1.` numbered lists as React elements.
- Date utilities (ISO ↔ URL format, day/week counters) live in `src/lib/journal-utils.ts`
- Tasks-page deletes are undoable (Undo toast, no confirm): pending keys are `task:<id>` (10s) and `tasknote:<id>` (6s), distinct from the journal's `note:`/`log:`/`todo:` keys. Read hooks (`useTasksQuery`, `useTaskQuery`, `useNotesQuery`, `useProjectTasksQuery`, `useJournalTodos`) filter pending ids through `select`
- Journal-specific styles are in `src/journal.css`, scoped under `.journal-page`
- User preferences (header style, sort, dark mode, project start date) persist to `localStorage` under key `taskflow_journal_prefs_v1`

## Safe Change Rules

- **Enum comparisons:** C# enum `.ToString()` produces PascalCase — always compare `status === 'Completed'`, never `'completed'`
- **CSS specificity in journal:** The `.journal-page button` reset rule has specificity `0-1-1`. Any button needing its own `border` or `background` must be scoped as `.journal-page .classname` (`0-2-0`) to win the cascade
- **`gen:api` scope:** Only regenerates `src/api/client/` — hand-written modules in `src/api/journal.ts` must be updated manually and will NOT be touched by the generator
- **Journal carry-forward:** Creating or switching to a journal entry must never move tasks. Incomplete tasks carry forward only into the user's own today, derived from the client's timezone offset with no UTC fallback
- **`docker-compose.yml` volume mappings:** Do not modify without confirmation
- **`main` branch:** Direct pushes to `main` trigger an automatic production deployment via Portainer — always work on a `feature/` or `bugfix/` branch and open a PR

## Testing

### Backend

Tests mirror the main project structure: `Controllers/V1/`, `Repositories/`, `Validators/`, `HealthChecks/`, `Extensions/`.

- Repository tests use `Microsoft.EntityFrameworkCore.InMemory` for most cases; real in-memory SQLite is used where constraint enforcement is needed (e.g., unique index tests)
- Controller tests use Moq to mock repositories
- CI enforces **75% line coverage** minimum (`ci.yml`)

### Frontend

**Framework:** Vitest + `@testing-library/react` + `@testing-library/user-event`, jsdom environment. Test files are colocated with their source (`Foo.tsx` → `Foo.test.tsx`).

**CI enforces 80% line coverage** — configured in `vite.config.ts` (`coverage.thresholds.lines: 80`), enforced by the `taskflow-web` CI job via `--coverage`.

**Key patterns:**
- Hook tests wrap `renderHook` in a fresh `QueryClient` via a `makeWrapper()` helper — see `useTasks.test.ts` for the canonical example
- Component tests use role-based queries (`getByRole`, `getByLabelText`) over text or selector queries
- `vi.clearAllMocks()` in `beforeEach` on every test file
- `useJournal.ts` requires **two separate mocks**: `vi.mock('@/api/journal')` for journal-specific functions AND `vi.mock('@/api/client/sdk.gen')` for todo create/toggle mutations that call the SDK directly
- `PrefsContext` tests must clean up DOM side-effects in `afterEach`: `document.documentElement.removeAttribute('data-theme')`, `document.documentElement.classList.remove('is-dark')`, `localStorage.clear()`
- Keyboard shortcut tests use `vi.useFakeTimers()` for chord sequences; clean up with `document.body.innerHTML = ''` in `afterEach`

Test fixtures must use PascalCase status values too (see the enum rule under Safe Change Rules) — a lowercase `'completed'` fixture silently produces wrong behaviour.

## Repository Etiquette

- **Branches:** `feature/description` or `bugfix/description`
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `chore:`, `docs:`, etc.); commits carry no `Co-Authored-By` trailer
- **PRs:** Must include updated or new tests; CI enforces 75% line coverage (backend) and 80% line coverage (frontend)

## CI/CD

Push to `main` triggers automatic deployment. Images are tagged `sha-<commit>`. The GitOps compose file lives in `nevridge/taskflow-deploy`.

## Key Configuration

`appsettings.Development.json` uses a local relative DB path (`./data/tasks.dev.db`); containers use `/app/data/tasks.db`. Override OpenTelemetry export via environment variables or `TaskFlow.Api/.env` (gitignored).

Create a root `.env` with `COMPOSE_PROJECT_NAME=taskflowapi` for consistent CLI project naming (gitignored, must be created locally).
