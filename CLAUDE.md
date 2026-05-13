# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run
dotnet run --project TaskFlow.Api

# Test (all)
dotnet test

# Test (single)
dotnet test --filter "FullyQualifiedName~TaskServiceTests.GetAllTasksAsync_ShouldReturnAllTasks"

# Test with coverage
dotnet test /p:CollectCoverage=true /p:CoverletOutputFormat=cobertura

# Format check (CI enforces this)
dotnet format --verify-no-changes

# Docker (dev — includes Seq logging UI at http://localhost:5380)
docker compose up -d

# Rebuild full image after VS has clobbered it (VS builds to base stage only)
docker build -t taskflow-api:dev -f TaskFlow.Api/Dockerfile .

# Docker (production)
docker compose -f docker-compose.prod.yml up
```

## Architecture

**Stack:** .NET 10, EF Core + SQLite, FluentValidation, OpenTelemetry → Seq, xUnit/Moq/FluentAssertions, Scalar/OpenAPI

**Layered flow:** `Controller → Service → Repository → EF Core (SQLite)`

**Extension method pattern** — `Program.cs` stays clean by delegating all service registration to methods in `Extensions/`. Each extension file owns one concern (persistence, versioning, health checks, OpenTelemetry, validation, JSON, OpenAPI). Adding a new cross-cutting concern means a new extension file, not touching `Program.cs`.

**API versioning** uses both URL path (`/api/v1/TaskItems`) and request header (`x-api-version`). Controllers live in `Controllers/V1/` and are decorated with `[ApiVersion("1.0")]`.

**Validation** is handled by FluentValidation validators in `Validators/` and applied globally via middleware registered in `ValidationServiceExtensions`. Controllers don't manually invoke validators.

**Health checks:** Three endpoints — `/health` (combined), `/health/ready` (DB connectivity, used as K8s readiness probe), `/health/live` (always up, liveness probe). Custom JSON writer in `HealthChecks/`.

**Migrations run on startup** when `Database:MigrateOnStartup` is `true` (default in Docker; disabled in production deploy if needed).

## Testing

Tests mirror the main project structure: `Controllers/V1/`, `Services/`, `Repositories/`, `Validators/`, `HealthChecks/`, `Extensions/`.

- Repository tests use `Microsoft.EntityFrameworkCore.InMemory` — no mocks for the DB layer.
- Service and controller tests use Moq to mock the layer below.
- CI enforces **75% line coverage** minimum (`ci.yml`).

## Visual Studio Docker Compose Debugging

**Workflow:** Run `docker compose up -d` in the terminal first, then press F5 in VS. VS attaches to the running container rather than starting one from scratch.

**Required before each VS session:** Close VS completely, ensure no `taskflow-api` or `taskflow-seq` containers are running (`docker compose down`), then reopen VS and press F5. Skipping the restart causes VS to loop endlessly on `docker ps` polling.

**VS rebuilds the image on warmup:** When a solution loads, VS rebuilds `taskflow-api:dev` to the `base` stage only (no app DLLs). After any VS session, run `docker build -t taskflow-api:dev -f TaskFlow.Api/Dockerfile .` to restore the full image before using `docker compose up -d` from the CLI.

**MCR pull failures (IPv6):** If `mcr.microsoft.com` pulls fail with TLS reset, add `150.171.70.10 mcr.microsoft.com` to `C:\Windows\System32\drivers\etc\hosts` to force IPv4.

## Key Configuration

`appsettings.Development.json` uses a local relative DB path (`./data/tasks.dev.db`). The container uses `/app/data/tasks.db`. The `OpenTelemetry` section configures the OTLP export endpoint — override via environment variables or a local `TaskFlow.Api/.env` file (gitignored).

Create a root `.env` with `COMPOSE_PROJECT_NAME=taskflowapi` for consistent CLI project naming — this file is gitignored and must be created locally.

## CI/CD

GitHub Actions workflows: `ci.yml` (lint → build → test → smoke test), `codeql.yml`, `container-scan.yml` (Trivy), `ghcr-deploy.yml` (build images → push to GHCR → update `taskflow-deploy` repo → Portainer GitOps deploys).

**Production deployment:** Push to `main` triggers automatic deployment to Docker Host via Portainer. Images are tagged with `sha-<commit>` for immutability. The GitOps compose file lives in `nevridge/taskflow-deploy`.

**Production URLs:** `taskflow.skalaforge.com` (web), `taskflow-api.skalaforge.com` (API), `taskflow-seq.skalaforge.com` (Seq).
