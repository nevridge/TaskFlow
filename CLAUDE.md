# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskFlow is a personal task and daily journal management application. It consists of a .NET 10 REST API (`TaskFlow.Api`) and a React frontend (`TaskFlow.Web`). The app is self-hosted via Docker and Portainer, with production running at `taskflow.skalaforge.com`. The primary user is the repository owner.

## Commands

```bash
# Backend — test (single)
dotnet test --project TaskFlow.Api.Tests --filter-method "TaskFlow.Api.Tests.Repositories.TaskRepositoryTests.GetAllAsync_ShouldReturnAllTasks"

# Backend — test with coverage (coverlet.MTP; cobertura lands in ./TestResults)
dotnet test --project TaskFlow.Api.Tests --coverlet --coverlet-output-format cobertura

# Frontend — dev server (proxies /api → http://localhost:8080)
cd TaskFlow.Web && npm run dev

# Frontend — type-check (what CI runs; plain `npx tsc --noEmit` checks nothing here because tsconfig.json is solution-style)
cd TaskFlow.Web && npm run type-check

# Frontend — test (all, single run)
cd TaskFlow.Web && npm run test -- --run

# Frontend — test (single file)
cd TaskFlow.Web && npm run test -- --run src/hooks/useJournal.test.ts

# Frontend — test with coverage (enforces 80% line threshold)
cd TaskFlow.Web && npm run test -- --run --coverage

# Frontend — regenerate typed API client from live OpenAPI spec (API must be running)
cd TaskFlow.Web && npm run gen:api

# Docker (dev — includes Seq logging UI at http://localhost:5380)
docker compose up -d

# Docker (local prod-like run; NOT the real production compose - see CI/CD)
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

## Assistant (`assistant/`)

The Claude work-assistant MCP server, Claude Code plugin and Chat skill live in `assistant/`, with their own `TaskFlow.Assistant.sln`, `Directory.Build.props` and `.editorconfig`. The root solution and commands do not touch it; CI covers it in the `assistant` job. See `assistant/CLAUDE.md`.

```bash
cd assistant && dotnet test --solution TaskFlow.Assistant.sln
cd assistant && dotnet format TaskFlow.Assistant.sln --verify-no-changes
# manual gate (not in CI): claude plugin validate ./plugin && claude plugin validate .
```

## Architecture

**Extension method pattern** — `Program.cs` stays clean by delegating all service registration to methods in `Extensions/`. Each extension file owns one concern (persistence, versioning, health checks, OpenTelemetry, validation, JSON, OpenAPI). Adding a new cross-cutting concern means a new extension file, not touching `Program.cs`.

**Migrations run on startup** when `Database:MigrateOnStartup` is `true` (default in Docker).

## Coding Conventions

- **Repository Pattern** — no direct `DbContext` access outside of repository classes
- **New validators** go in `Validators/` and are auto-discovered via `AddValidatorsFromAssemblyContaining` — no manual registration needed
- **Auto-generated files** (`src/api/client/sdk.gen.ts`) must never be manually edited — run `npm run gen:api` to regenerate (inside feature-factory, only the backend-builder regenerates, using `npx openapi-ts -i <spec url>` against the launch-profile port 5290 instead)
- **C# naming:** PascalCase for types and members, camelCase for local variables

## Safe Change Rules

- **Enum comparisons:** C# enum `.ToString()` produces PascalCase — always compare `status === 'Completed'`, never `'completed'`
- **Journal carry-forward:** Creating or switching to a journal entry must never move tasks. Incomplete tasks carry forward only into the user's own today, derived from the client's timezone offset with no UTC fallback
- **`docker-compose.yml` volume mappings:** Do not modify without confirmation
- **`main` branch:** Direct pushes to `main` trigger an automatic production deployment via Portainer — always work on a `feature/` or `bugfix/` branch and open a PR

## Repository Etiquette

- **Branches:** `feature/description` or `bugfix/description`
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `chore:`, `docs:`, etc.); commits carry no `Co-Authored-By` trailer
- **PRs:** Must include updated or new tests; CI enforces 75% line coverage (backend) and 80% line coverage (frontend)

## CI/CD

Push to `main` triggers automatic deployment. Images are tagged `sha-<commit>`. The GitOps compose file (`docker-compose.yml`) lives in `nevridge/taskflow-deploy`; that is the production source of truth. `docker-compose.prod.yml` in this repo is only a local prod-like harness, differs from production, and is not kept in sync.

## Key Configuration

`appsettings.Development.json` uses a local relative DB path (`./data/tasks.dev.db`); containers use `/app/data/tasks.db`. Override OpenTelemetry export via environment variables or `TaskFlow.Api/.env` (gitignored).

Create a root `.env` with `COMPOSE_PROJECT_NAME=taskflowapi` for consistent CLI project naming (gitignored, must be created locally).
