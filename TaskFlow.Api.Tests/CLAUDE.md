# CLAUDE.md

Guidance for working under `TaskFlow.Api.Tests/`.

Tests mirror the main project structure: `Controllers/V1/`, `Repositories/`, `Validators/`, `HealthChecks/`, `Extensions/`.

- Repository tests use `Microsoft.EntityFrameworkCore.InMemory` for most cases; real in-memory SQLite is used where constraint enforcement is needed (e.g., unique index tests)
- Controller tests use Moq to mock repositories
