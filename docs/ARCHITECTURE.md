# Architecture & Design

This document explains the architectural decisions, design patterns, and quality practices used across the TaskFlow stack (API and frontend).

## Table of Contents

- [Overview](#overview)
- [Architecture Principles](#architecture-principles)
- [Application Structure](#application-structure)
- [Design Patterns](#design-patterns)
- [Service Registration Pattern](#service-registration-pattern)
- [Health Checks](#health-checks)
- [Data Persistence](#data-persistence)
- [Logging Strategy](#logging-strategy)
- [Quality Practices](#quality-practices)
- [Frontend Architecture](#frontend-architecture)

## Overview

TaskFlow.Api follows a **layered architecture** pattern, separating concerns into distinct layers:

```
┌─────────────────────────────────────┐
│         Controllers (API)           │  ← REST endpoints
├─────────────────────────────────────┤
│      Services (Business Logic)      │  ← Domain logic
├─────────────────────────────────────┤
│    Repositories (Data Access)       │  ← Data operations
├─────────────────────────────────────┤
│     EF Core DbContext (ORM)         │  ← Database mapping
├─────────────────────────────────────┤
│        SQLite Database              │  ← Data storage
└─────────────────────────────────────┘
```

**Benefits:**
- Clear separation of concerns
- Testable components at each layer
- Easy to modify or replace individual layers
- Follows SOLID principles

## Architecture Principles

### 1. Dependency Injection (DI)

All services are registered in the DI container and injected via constructors. This enables:
- Loose coupling between components
- Easy unit testing with mock implementations
- Centralized service lifetime management

### 2. Async/Await Throughout

All I/O operations (database, logging, HTTP) use async/await:
- Better scalability under load
- Non-blocking operations
- Consistent pattern across the codebase

### 3. Repository Pattern

Data access is abstracted through repository interfaces:
- Decouples business logic from data access implementation
- Enables testing without a real database
- Centralizes data access logic

### 4. Configuration-Based Behavior

Environment-specific behavior controlled via configuration:
- No code changes needed for different environments
- Easy to override with environment variables
- Supports local, Docker, and cloud deployments

## Application Structure

```
TaskFlow.Api/
├── Extensions/                 # DI service registration extensions
│   ├── PersistenceServiceExtensions.cs
│   ├── ApplicationServiceExtensions.cs
│   ├── ValidationServiceExtensions.cs
│   ├── HealthCheckServiceExtensions.cs
│   ├── ApiVersioningServiceExtensions.cs
│   ├── OpenApiServiceExtensions.cs
│   ├── OpenTelemetryServiceExtensions.cs
│   └── JsonConfigurationExtensions.cs
├── Controllers/                # REST API endpoints
│   └── V1/
│       ├── TaskItemsController.cs
│       └── StatusController.cs
├── Data/                       # EF Core DbContext
│   └── TaskDbContext.cs
├── DTOs/                       # Data transfer objects
│   ├── CreateTaskItemDto.cs
│   ├── UpdateTaskItemDto.cs
│   └── TaskItemResponseDto.cs
├── HealthChecks/               # Health check implementations
│   └── HealthCheckResponseWriter.cs
├── Migrations/                 # EF Core migrations
├── Models/                     # Domain entities
│   ├── TaskItem.cs
│   └── Status.cs
├── Providers/                  # Shared providers
│   └── JsonSerializerOptionsProvider.cs
├── Repositories/               # Data access layer
│   ├── ITaskRepository.cs
│   ├── TaskRepository.cs
│   ├── IStatusRepository.cs
│   └── StatusRepository.cs
├── Services/                   # Business logic
│   ├── ITaskService.cs
│   ├── TaskService.cs
│   ├── IStatusService.cs
│   └── StatusService.cs
├── Validators/                 # FluentValidation validators
│   ├── TaskItemValidator.cs
│   └── StatusValidator.cs
└── Program.cs                  # Application entry point
```

### Layer Responsibilities

**Controllers (API Layer)**
- Handle HTTP requests/responses
- Validate input using DTOs
- Call service layer methods
- Return appropriate HTTP status codes
- Do NOT contain business logic

**Services (Business Logic Layer)**
- Implement business rules
- Coordinate operations across repositories
- Handle exceptions and error cases
- Transform between DTOs and domain models
- Do NOT access database directly

**Repositories (Data Access Layer)**
- Perform CRUD operations
- Execute queries
- Handle EF Core specifics
- Abstract database implementation details
- Do NOT contain business logic

## Design Patterns

### Service Registration Pattern

TaskFlow.Api uses the **ServiceCollection Extension Pattern** to organize dependency injection registrations. This keeps `Program.cs` clean and maintainable.

#### Usage in Program.cs

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Logging.AddApplicationLogging(builder.Configuration, builder.Environment);
builder.Services.AddControllers();
builder.Services.AddApiVersioningConfiguration();
OpenApiServiceExtensions.AddOpenApi(builder.Services);
builder.Services.AddPersistence(builder.Configuration);
builder.Services.AddApplicationServices();
builder.Services.AddValidation();
builder.Services.AddApplicationHealthChecks();
builder.Services.AddOpenTelemetryObservability(builder.Configuration);
builder.Services.ConfigureJsonSerialization();
```

Each extension class focuses on a single logical grouping — persistence, application services, validation, health checks, etc. For the full list of extension classes, how to create new ones, and best practices, see the [Service Registration Pattern Documentation](SERVICE_REGISTRATION_PATTERN.md).

### Repository Pattern

**Interface:**
```csharp
public interface ITaskRepository
{
    Task<IEnumerable<TaskItem>> GetAllAsync();
    Task<TaskItem?> GetByIdAsync(int id);
    Task<TaskItem> AddAsync(TaskItem taskItem);
    Task UpdateAsync(TaskItem taskItem);
    Task DeleteAsync(int id);
}
```

**Benefits:**
- Testable with mock implementations
- Can swap database implementations
- Centralizes data access logic
- Clear contract for data operations

### DTO Pattern

Data Transfer Objects separate API contracts from domain models:

**Domain Model (internal):**
```csharp
public class TaskItem
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsComplete { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
```

**Create DTO (API input):**
```csharp
public class CreateTaskItemDto
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int? StatusId { get; set; }
    public bool IsComplete { get; set; }
}
```

**Response DTO (API output):**
```csharp
public class TaskItemResponseDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsComplete { get; set; }
    public string? StatusName { get; set; }
}
```

**Benefits:**
- API contract decoupled from domain model
- Internal model can evolve independently
- Control exactly what's exposed in API
- Easier to add validation attributes

### Validation with FluentValidation

Input validation is declarative and testable:

```csharp
public class TaskItemCreateDtoValidator : AbstractValidator<TaskItemCreateDto>
{
    public TaskItemCreateDtoValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty()
            .WithMessage("Title is required")
            .MaximumLength(200)
            .WithMessage("Title cannot exceed 200 characters");

        RuleFor(x => x.Description)
            .MaximumLength(1000)
            .When(x => x.Description != null)
            .WithMessage("Description cannot exceed 1000 characters");
    }
}
```

**Benefits:**
- Validation rules in one place
- Unit testable
- Clear, readable rules
- Consistent error messages

## Health Checks

TaskFlow.Api implements comprehensive health checks for container orchestration and monitoring.

### Health Check Endpoints

| Endpoint | Purpose | Checks |
|----------|---------|--------|
| `/health` | Overall health | Database + Self |
| `/health/ready` | Readiness probe | Database connectivity |
| `/health/live` | Liveness probe | Application responsiveness |

### Implementation

```csharp
builder.Services.AddHealthChecks()
    .AddDbContextCheck<TaskDbContext>(
        name: "database",
        tags: new[] { "ready" })
    .AddCheck(
        name: "self",
        check: () => HealthCheckResult.Healthy("Application is running"),
        tags: new[] { "live" });
```

### Tag Strategy

- **`ready` tag:** Checks that must pass before accepting traffic (database, external dependencies)
- **`live` tag:** Lightweight checks confirming the process is responsive

**Rationale:**
- Liveness checks avoid database to prevent restart loops from transient DB issues
- Readiness checks include database to prevent routing traffic before the app is ready
- Separate tags enable appropriate probe configuration in Kubernetes/Docker

### Custom Response Format

Health checks return detailed JSON responses:

```json
{
  "status": "Healthy",
  "totalDuration": 25.4551,
  "results": [
    {
      "name": "database",
      "status": "Healthy",
      "duration": 20.355
    },
    {
      "name": "self",
      "status": "Healthy",
      "description": "Application is running",
      "duration": 1.0933
    }
  ]
}
```

**Benefits:**
- Detailed troubleshooting information
- Duration metrics for performance monitoring
- Standard HTTP status codes (200 = healthy, 503 = unhealthy)

### Orchestration Configuration

**Docker Compose:**
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s  # Grace period for migrations
```

**Kubernetes:**
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 60
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 45
  periodSeconds: 5
```

**Key considerations:**
- `start_period`/`initialDelaySeconds` allows time for database migrations
- Liveness uses lightweight `/health/live` (no DB dependency)
- Readiness uses `/health/ready` (includes DB check)

## Data Persistence

### Entity Framework Core

**DbContext:**
```csharp
public class TaskDbContext(DbContextOptions<TaskDbContext> options) : DbContext(options)
{
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<Status> Statuses => Set<Status>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Entity configuration
        modelBuilder.Entity<TaskItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).IsRequired().HasMaxLength(200);
        });
    }
}
```

### Migration Strategy

**Development:**
- Automatic migrations via `Database.MigrateOnStartup = true`
- Fast iteration during development

**Production:**
- Manual migration control (automatic disabled by default)
- Run migrations during deployment via CI/CD
- Avoids concurrent migration issues

**Migration commands:**

For migration commands and setup steps, see the [Getting Started Guide](GETTING_STARTED.md#database-migrations).

### SQLite Usage

**Why SQLite:**
- Zero configuration required
- Single-file database
- Perfect for demos and learning
- Easy Docker volume persistence
- No external database server needed

**Limitations:**
- Not for high-concurrency production workloads
- Limited to single server (no shared database)
- Good for: demos, learning, prototypes, low-traffic apps

**Production alternative:**
Swap connection string to use SQL Server, PostgreSQL, MySQL:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=sql.example.com;Database=TaskFlow;..."
  }
}
```

No code changes needed—EF Core handles the abstraction.

## Logging Strategy

### OpenTelemetry Configuration

Structured logging with OpenTelemetry exports logs via OTLP.

**Application logging setup:**
```csharp
builder.Logging.AddApplicationLogging(builder.Configuration, builder.Environment);
```

This call:
- Clears all default logging providers
- Adds an OTLP exporter targeting the configured endpoint
- Adds a console exporter in Development only

### OTLP Exporter Settings

For the full list of OpenTelemetry configuration settings and environment variables, see the [Logging Guide](LOGGING.md#otlp-exporter-settings).

### Health Check Logging

Health check failures are automatically logged:
- Error level for unhealthy checks
- Warning level for degraded checks
- Includes exception details
- Timestamped for correlation

For detailed logging documentation, see [Logging Guide](LOGGING.md).

## Quality Practices

### 1. Automated Testing

**Test structure:**
```
TaskFlow.Api.Tests/
├── Controllers/        # Controller unit tests
├── Services/           # Service layer tests
├── Repositories/       # Repository tests with in-memory DB
├── Validators/         # Validation logic tests
└── Extensions/         # DI registration integration tests
```

**Code coverage enforcement:**
- Minimum **75% total line coverage** required — PRs are blocked if coverage falls below this threshold
- CI pipeline fails if coverage drops
- Coverage reports generated in CI

For coverage configuration, excluded types, and how to mirror CI enforcement locally, see the [Contributing Guide](CONTRIBUTING.md#code-coverage).

**Run tests:**
```bash
dotnet test
```

### 2. Security Scanning

**CodeQL (SAST):**
- Static analysis of C# code
- Identifies security vulnerabilities
- Runs on push to main, PRs, and weekly schedule
- Results in GitHub Security tab

**Trivy (Container Scanning):**
- Scans Docker images for vulnerabilities
- Checks OS packages and .NET libraries
- Fails on CRITICAL/HIGH severity findings
- Runs on push to main, PRs, and weekly schedule

See [Security Scanning Documentation](SECURITY_SCANNING.md) for details.

### 3. Code Formatting

**Automated formatting checks:**
- `dotnet format` enforces consistent style
- CI verifies formatting on every push
- Run locally: `dotnet format`

### 4. Dependency Injection Best Practices

**Service lifetimes:**
- **Scoped:** DbContext, repositories, services (default)
- **Transient:** Validators, lightweight services
- **Singleton:** Configuration, logging, caching

**Registration pattern:**
- Interface-based dependencies
- Constructor injection only
- No service locator pattern
- Clear, explicit registrations

### 5. Error Handling

**API responses:**
- 200 OK: Successful operation
- 201 Created: Resource created
- 204 No Content: Successful delete
- 400 Bad Request: Validation failure
- 404 Not Found: Resource doesn't exist
- 500 Internal Server Error: Unexpected errors

**Validation errors:**
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "Title": ["Title is required"]
  }
}
```

### 6. API Versioning

**Implemented using Microsoft's Asp.Versioning packages** following official best practices:

**Configuration:**
```csharp
builder.Services.AddApiVersioningConfiguration();
```

**Features:**
- URL path versioning (primary): `/api/v1/TaskItems`, `/api/v2/TaskItems`
- Header versioning (fallback): `x-api-version: 1.0`
- Default version: 1.0
- Version discovery via response headers: `api-supported-versions`
- Multi-version OpenAPI/Scalar documentation

**Controller implementation:**
```csharp
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class TaskItemsController : ControllerBase
{
    // Version 1.0 endpoints
}
```

**Benefits:**
- Backward compatibility for existing clients
- Gradual migration path for API consumers
- Multiple versions coexist safely
- Clear version visibility in URLs

See [API Versioning Guide](API_VERSIONING.md) for complete documentation.

## Documentation Philosophy

See the [Contributing Guide](CONTRIBUTING.md#documentation-philosophy) for the documentation approach, audience priorities, and documentation file structure.

---

## Frontend Architecture

> For a detailed frontend reference including testing, environment config, and troubleshooting, see [FRONTEND.md](FRONTEND.md).

### Overview

TaskFlow.Web is a React 19 + TypeScript SPA built with Vite 8. Its architecture prioritises type safety end-to-end and a clean separation between server state and UI state.

```
┌─────────────────────────────────────┐
│         Pages (Route Components)    │  ← Composition, minimal logic
├─────────────────────────────────────┤
│     TanStack Query Hooks            │  ← Server state: cache, mutations
├─────────────────────────────────────┤
│     Generated API Client            │  ← Typed fetch functions from OpenAPI spec
├─────────────────────────────────────┤
│     TaskFlow.Api (REST)             │  ← Backend (separate process/container)
└─────────────────────────────────────┘
```

### Key Architectural Decisions

#### Generated API client

The API client in `src/api/client/` is auto-generated from the live OpenAPI spec via `@hey-api/openapi-ts`:

```bash
npm run gen:api
# Reads: http://localhost:8080/openapi/v1.json
# Writes: src/api/client/{client,sdk,types}.gen.ts
```

This means TypeScript types for every request and response are always derived from the actual backend contract. When the API changes, a re-generation surfaces type errors immediately in hooks and pages — no manual type maintenance.

The client is committed to source control so CI doesn't require a running API server.

#### TanStack Query for server state

UI state (modal open/closed, which item is being edited) lives in component `useState`. Server state (task list, task detail, notes) lives in TanStack Query's cache.

Hooks in `src/hooks/` encapsulate all query and mutation logic. Pages call hooks and don't interact with the API client directly.

```typescript
// Pages are thin — they call hooks and render
function TasksPage() {
  const { data, isLoading, error } = useTasksQuery()
  const createMutation = useCreateTaskMutation()
  // ...
}

// Hooks own the cache keys and invalidation strategy
export function useCreateTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateTaskItemDto) => postApiV1TaskItems({ body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  })
}
```

`throwOnError: true` is set at the client level so non-2xx API responses throw, which React Query routes to `isError` / `error` rather than treating the response as a successful (empty) result.

#### PascalCase normalisation

`TaskItemResponseDto` on the backend stores `Status` and `Priority` as `string` via `ToString()`, which produces PascalCase values (`"Draft"`, `"High"`). The frontend option values and badge class maps use lowercase keys. Normalisation via `.toLowerCase()` is applied at the comparison site (filter logic in `TasksPage`) and at the display site (`TaskCard`, `TaskForm` initial state) — not in the hooks or generated types.

### Frontend Structure

```
src/
├── api/client/       # Auto-generated (do not edit)
├── hooks/            # TanStack Query hooks — all server state
├── pages/            # Route-level components
├── components/       # Shared UI components
└── lib/              # Utilities (cn, formatDate)
```

### Frontend Tech Stack

| Concern | Technology | Why |
|---------|-----------|-----|
| Framework | React 19 + TypeScript | Industry standard; strict typing |
| Build | Vite 8 | Fast HMR, esbuild-based, Tailwind v4 plugin |
| Styling | Tailwind CSS v4 | Utility-first, no config file, tree-shaken |
| Routing | React Router v7 | De-facto SPA routing library |
| Server state | TanStack Query v5 | Caching, invalidation, deduplication |
| API client | hey-api/openapi-ts | Generated types from OpenAPI spec |
| Testing | Vitest + RTL | Fast Vite-native test runner |
| Production | `serve -s dist` | Minimal SPA server, no nginx needed |

---

[← Back to README](../README.md) | [Next: Deployment Guide →](DEPLOYMENT.md)
