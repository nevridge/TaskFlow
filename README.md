# TaskFlow

A full-stack task management application demonstrating modern development practices and containerized deployment patterns. The project consists of a **production-ready .NET 10 REST API** and a **React TypeScript frontend**, both containerised and deployed via Docker and Portainer GitOps.

While functional as a task management system, this project serves as a portfolio piece showcasing professional engineering practices across the full stack — from API design and automated testing to CI/CD pipelines and on-premises Docker deployment.

## Overview

| Component | Stack | Purpose |
|-----------|-------|---------|
| **TaskFlow.Api** | .NET 10, EF Core, SQLite | REST API, business logic, data persistence |
| **TaskFlow.Web** | React 19, TypeScript, Vite, Tailwind CSS v4 | SPA frontend, task and note management UI |

## Key Features

**Backend (TaskFlow.Api)**
- ✅ Full CRUD for tasks and notes via versioned REST API
- 🔄 API versioning — URL path (`/api/v1/`) and header (`x-api-version`)
- 🗄️ Entity Framework Core with SQLite persistence
- 🔍 OpenAPI documentation with Scalar UI
- 📊 Structured logging via OpenTelemetry (OTLP → Seq)
- 🏥 Health check endpoints for container orchestration
- 🔒 Security scanning (CodeQL + Trivy)
- ✅ Automated testing with 75%+ code coverage enforcement

**Frontend (TaskFlow.Web)**
- ⚛️ React 19 + TypeScript SPA with Vite 8 and Tailwind CSS v4
- 🔗 Typed API client auto-generated from the live OpenAPI spec
- 📦 TanStack Query v5 for server state management (caching, invalidation, optimistic UI)
- 🧭 Client-side routing with React Router v7
- 🎛️ Task list with status/priority filtering and multi-key sort
- 📝 Task detail page with inline note management (create, edit, delete)
- 📓 Daily journal — per-day entry with todos (linked tasks), a timestamped activity log, and freeform notes; navigable by date with carry-over of incomplete tasks
- 🧪 Component and hook tests with Vitest + React Testing Library

**DevOps**
- 🐳 Docker Compose for local full-stack development
- 🎯 Portainer GitOps deployment to on-premises Docker host
- 🔁 CI pipeline: lint → type-check → test → build → smoke test (parallel API and Web jobs)
- 📦 GitHub Container Registry (GHCR) for image hosting

## Quick Start

### Prerequisites
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js 20+](https://nodejs.org/) (for the frontend)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (for the full stack via Compose)

### Option 1 — Full Stack with Docker Compose (Recommended)

The easiest way to run everything together:

```bash
git clone https://github.com/nevridge/TaskFlow.git
cd TaskFlow
docker compose up
```

| Service | URL |
|---------|-----|
| Frontend (React UI) | http://localhost:3000 |
| API | http://localhost:8080 |
| Scalar UI (API docs) | http://localhost:8080/scalar/v1 |
| Seq (log viewer) | http://localhost:5380 |

### Option 2 — Run API + Frontend Separately

**API:**
```bash
dotnet run --project TaskFlow.Api
# → https://localhost:{port}/scalar/v1
```

**Frontend:**
```bash
cd TaskFlow.Web
npm install
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/api` requests to `http://localhost:8080` automatically.

See **[Getting Started](docs/GETTING_STARTED.md)** for the full setup walkthrough.

## Documentation

### Primary Guides

- **[Getting Started](docs/GETTING_STARTED.md)** — Setup and run the full stack locally
- **[Frontend Guide](docs/FRONTEND.md)** — React project structure, API client generation, testing
- **[API Reference](docs/API.md)** — Complete endpoint documentation with examples
- **[API Versioning](docs/API_VERSIONING.md)** — Versioning strategy and migration guide
- **[Architecture](docs/ARCHITECTURE.md)** — Design decisions, patterns, and quality practices
- **[Deployment](docs/DEPLOYMENT.md)** — Docker, Portainer GitOps, and CI/CD workflows
- **[Contributing](docs/CONTRIBUTING.md)** — Development workflow and standards

### Reference Documentation

- **[Docker Configuration](docs/DOCKER_CONFIGURATION.md)** — Dev vs prod Docker comparison (all three services)
- **[Volumes](docs/VOLUMES.md)** — Volume configuration and persistence
- **[Health Checks](docs/HEALTH_CHECK_TESTING.md)** — Health check setup and testing
- **[Image & Deployment Naming](docs/DEPLOY.md)** — GHCR image tagging and deployment conventions
- **[Service Registration](docs/SERVICE_REGISTRATION_PATTERN.md)** — .NET DI extension pattern
- **[Security Scanning](docs/SECURITY_SCANNING.md)** — CodeQL and Trivy
- **[Logging](docs/LOGGING.md)** — OpenTelemetry configuration
- **[Volume Testing](docs/VOLUME_TESTING.md)** — Testing volume persistence

## Project Structure

```
TaskFlow/
├── TaskFlow.Api/               # .NET 10 REST API
│   ├── Controllers/V1/         # Versioned REST endpoints
│   ├── Services/               # Business logic layer
│   ├── Repositories/           # Data access layer
│   ├── Models/                 # Domain entities
│   ├── DTOs/                   # Data transfer objects
│   ├── Validators/             # FluentValidation validators
│   ├── Extensions/             # DI service registration extensions
│   ├── HealthChecks/           # Custom health check implementations
│   ├── Providers/              # Shared providers (JSON serialisation)
│   └── Migrations/             # EF Core migrations
│
├── TaskFlow.Web/               # React TypeScript frontend
│   ├── src/
│   │   ├── api/
│   │   │   ├── client/         # Auto-generated typed API client (do not edit)
│   │   │   └── journal.ts      # Hand-written journal API functions + types
│   │   ├── hooks/              # TanStack Query hooks (useTasks, useNotes, useJournal)
│   │   ├── pages/              # Route-level components (TasksPage, TaskDetailPage, JournalPage)
│   │   ├── components/
│   │   │   └── journal/        # Journal sub-components (DateNav, TodosSection, DailyLogSection, etc.)
│   │   └── lib/                # Utilities (cn, formatDate, journal-utils)
│   ├── .env.development        # Dev base URL (http://localhost:8080)
│   ├── .env.production         # Prod base URL (empty — same-origin via vite preview proxy)
│   └── Dockerfile              # Multi-stage build → vite preview
│
├── TaskFlow.Api.Tests/         # xUnit test suite for the API
├── docs/                       # Extended documentation
├── docker-compose.yml          # Full-stack dev environment (api + web + seq)
└── docker-compose.prod.yml     # Production-like compose
```

## Technology Stack

### Backend
| Concern | Technology |
|---------|-----------|
| Framework | .NET 10, ASP.NET Core |
| Database | Entity Framework Core + SQLite |
| Validation | FluentValidation |
| Observability | OpenTelemetry (traces, metrics, logs → Seq) |
| API docs | OpenAPI + Scalar UI |
| Testing | xUnit, Moq, FluentAssertions, Coverlet |
| Deployment | Docker, Azure Container Instances (ACI) |
| CI/CD | GitHub Actions |

### Frontend
| Concern | Technology |
|---------|-----------|
| Framework | React 19 + TypeScript, Vite 8 |
| Styling | Tailwind CSS v4 |
| Routing | React Router v7 |
| Server state | TanStack Query v5 |
| API client | hey-api/openapi-ts (generated from OpenAPI spec) |
| Testing | Vitest + React Testing Library |
| Production serve | `vite preview` with `/api` proxy (SPA routing + same-origin API) |

## Portfolio Highlights

If you're evaluating this project for hiring or collaboration, here's what to look for:

### Architecture & Code Quality
- **Layered API architecture** — Controller → Repository → EF Core, each with clear responsibilities and test coverage
- **Extension method pattern** — `Program.cs` stays minimal; each cross-cutting concern lives in its own `Extensions/` file
- **Repository pattern** — data access abstracted behind interfaces, enabling in-memory testing without mocks
- **Generated API client** — `@hey-api/openapi-ts` generates a fully typed fetch client from the live OpenAPI spec, keeping frontend types in sync with the backend contract
- **TanStack Query hooks** — server state (caching, invalidation, loading/error states) encapsulated in `useTasks` and `useNotes` hooks, keeping pages clean

### DevOps & Deployment
- **Multi-stage Docker builds** — optimised production images for both API and frontend
- **GitHub Actions workflows** — parallel CI jobs for API and frontend (lint, type-check, test, build, smoke test)
- **Azure deployment via OIDC** — no stored credentials; federated identity with Azure
- **Environment-specific configuration** — `.env.development` / `.env.production` for frontend; `appsettings.*.json` and env vars for the API

### Testing & Quality
- **75%+ line coverage** enforced in CI — PRs are blocked below the threshold
- **API tests** — unit tests at controller, service, and repository layers; integration tests for DI registrations and CORS
- **Frontend tests** — Vitest + RTL for all components and TanStack Query hooks
- **Security scanning** — CodeQL (SAST) + Trivy (container image CVEs)
- **Automated formatting** — `dotnet format` and ESLint enforced in CI

### Observability
- **Structured logging** via OpenTelemetry OTLP → Seq (Seq UI at `http://localhost:5380` in dev)
- **Health check endpoints** — `/health`, `/health/ready` (DB), `/health/live` (lightweight)
- **OpenTelemetry tracing and metrics**

## API Endpoints

### Task Items

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/TaskItems` | List all tasks |
| GET | `/api/v1/TaskItems/{id}` | Get task by ID |
| POST | `/api/v1/TaskItems` | Create task |
| PUT | `/api/v1/TaskItems/{id}` | Update task |
| DELETE | `/api/v1/TaskItems/{id}` | Delete task |

### Notes (per task)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/TaskItems/{taskId}/Notes` | List notes for a task |
| GET | `/api/v1/TaskItems/{taskId}/Notes/{id}` | Get note by ID |
| POST | `/api/v1/TaskItems/{taskId}/Notes` | Add note |
| PUT | `/api/v1/TaskItems/{taskId}/Notes/{id}` | Update note |
| DELETE | `/api/v1/TaskItems/{taskId}/Notes/{id}` | Delete note |

### Journal Entries

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/JournalEntries` | List all journal entries (includes embedded log entries) |
| GET | `/api/v1/JournalEntries/{id}` | Get entry by ID |
| POST | `/api/v1/JournalEntries` | Create entry (`title`, `date` required) |
| PUT | `/api/v1/JournalEntries/{id}` | Update entry title/summary |
| DELETE | `/api/v1/JournalEntries/{id}` | Delete entry |

### Journal Todos (linked tasks)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/JournalEntries/{entryId}/todos` | List tasks linked to an entry |
| POST | `/api/v1/JournalEntries/{entryId}/todos` | Link an existing task (`{ taskItemId }`) |
| DELETE | `/api/v1/JournalEntries/{entryId}/todos/{taskItemId}` | Unlink a task |

### Journal Log Entries

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/JournalEntries/{entryId}/logs` | List log entries |
| GET | `/api/v1/JournalEntries/{entryId}/logs/{id}` | Get log entry by ID |
| POST | `/api/v1/JournalEntries/{entryId}/logs` | Add log entry (`{ content }`) |
| PUT | `/api/v1/JournalEntries/{entryId}/logs/{id}` | Update log entry content |
| DELETE | `/api/v1/JournalEntries/{entryId}/logs/{id}` | Delete log entry |

### Health Checks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Combined health status |
| GET | `/health/ready` | DB readiness probe |
| GET | `/health/live` | Liveness probe |

See [API Reference](docs/API.md) for request/response shapes and [API Versioning Guide](docs/API_VERSIONING.md) for versioning strategy.

## Configuration

### API

| Setting | Environment Variable | Default | Description |
|---------|---------------------|---------|-------------|
| Database | `ConnectionStrings__DefaultConnection` | `Data Source=tasks.db` | SQLite path |
| Auto migrations | `Database__MigrateOnStartup` | `false` | Auto-apply on startup |
| OTel service name | `OpenTelemetry__ServiceName` | `TaskFlow.Api` | Name in traces/logs |
| OTel endpoint | `OpenTelemetry__Endpoint` | `http://localhost:5341/ingest/otlp` | OTLP backend |
| OTel header | `OpenTelemetry__Header` | — | Optional auth header |
| CORS origins | `Cors__AllowedOrigins` | — | Allowed origins (set in appsettings.Development.json) |

### Frontend

| File | `VITE_API_BASE_URL` | Used when |
|------|-------------------|-----------|
| `.env.development` | `http://localhost:8080` | `npm run dev` |
| `.env.production` | *(empty)* | `npm run build` (Docker Compose image) |

The generated SDK paths already include `/api/v1/...`, so `VITE_API_BASE_URL` must be the API origin only (e.g. `http://localhost:8080`) or left empty for same-origin deployments. Do not set it to `/api` — that would produce double-prefixed paths like `/api/api/v1/...`.

In Docker Compose, `.env.production` is empty so the browser sends requests to the same origin (port 3000). The `vite preview` runtime server proxies `/api` and `/openapi` to `$API_TARGET` (`http://taskflow-api:8080` inside Docker network) — no CORS needed.

## Testing

```bash
# API tests
dotnet test

# Frontend tests
cd TaskFlow.Web && npm run test -- --run

# Type-check frontend
cd TaskFlow.Web && npm run type-check
```

The CI pipeline enforces **75% minimum line coverage** for the API and blocks PRs below this threshold. See [Contributing Guide](docs/CONTRIBUTING.md#code-coverage) for details.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development workflow, code standards, and PR process.

## License

No license specified. This project is primarily for portfolio and learning purposes.

## Contact

**Repository:** [nevridge/TaskFlow.Api](https://github.com/nevridge/TaskFlow.Api)

---

*Last updated: 2026-05-09*
