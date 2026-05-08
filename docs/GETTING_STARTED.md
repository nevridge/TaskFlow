# Getting Started with TaskFlow

This guide walks you through setting up the full TaskFlow stack (API + frontend) for local development.

## Prerequisites

### Required
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) — for the API
- [Node.js 20+](https://nodejs.org/) — for the frontend
- A terminal/command prompt
- A code editor (Visual Studio, VS Code, Rider, etc.)

### Optional
- [Docker Desktop](https://www.docker.com/products/docker-desktop) — for the full stack via Compose
- [Visual Studio 2022 or later](https://visualstudio.microsoft.com/) — for IDE-based Docker support
- [Postman](https://www.postman.com/) — for API testing

## Option 0: Full Stack with Docker Compose (Easiest)

Runs the API, frontend, and Seq log viewer in one command:

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

Data persists in Docker volumes. To tear down without losing data: `docker compose down`. To also remove volumes: `docker compose down -v`.

---

## Running the API

### Option 1: Run Directly with .NET CLI (Fastest)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nevridge/TaskFlow.git
   cd TaskFlow
   ```

2. **Restore dependencies:**
   ```bash
   dotnet restore
   ```

3. **Run the application:**
   ```bash
   dotnet run --project TaskFlow.Api
   ```

4. **Access the API:**
   - The console will display the URL (e.g., `https://localhost:5001`)
   - Navigate to `https://localhost:{port}/scalar/v1` to see the Scalar UI
   - API endpoints are available at `https://localhost:{port}/api/v1/TaskItems`

The application will:
- Automatically apply database migrations on first run
- Create a SQLite database at `TaskFlow.Api/tasks.db`
- Write logs to `TaskFlow.Api/logs/log.txt`

### Option 2: Docker Compose (Recommended for Production-Like Testing)

1. **Start the application:**
   ```bash
   docker compose up
   ```

2. **Access the API:**
   - API: `http://localhost:8080`
   - Health check: `http://localhost:8080/health`

3. **View logs:**
   ```bash
   docker compose logs -f
   ```

4. **Stop the application:**
   ```bash
   docker compose down
   ```
   
   Note: This preserves data in Docker volumes. To remove data as well:
   ```bash
   docker compose down -v
   ```

**What's included:**
- Development environment configuration
- Automatic database migrations
- Persistent storage via Docker named volumes
- Log persistence

### Option 3: Visual Studio (Windows/Mac)

1. **Open the solution:**
   - Launch Visual Studio 2022
   - Open `TaskFlow.sln`

2. **Run with Docker (if Container Development Tools installed):**
   - Select **"Container (Dockerfile)"** from debug dropdown
   - Press **F5** or click Run
   - Visual Studio will handle Docker setup automatically

3. **Run without Docker:**
   - Select **"TaskFlow.Api"** from debug dropdown
   - Press **F5** or click Run

## Verify Installation

### Test the Health Endpoint

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "Healthy",
  "totalDuration": 25.4551,
  "results": [
    {
      "name": "database",
      "status": "Healthy",
      "description": "",
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

### Create Your First Task

**Using curl:**
```bash
curl -X POST http://localhost:8080/api/v1/TaskItems \
  -H "Content-Type: application/json" \
  -d '{"title":"My First Task","description":"Getting started with TaskFlow","isComplete":false}'
```

**Using PowerShell:**
```powershell
Invoke-RestMethod -Uri http://localhost:8080/api/v1/TaskItems `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"title":"My First Task","description":"Getting started with TaskFlow","isComplete":false}'
```

### List All Tasks

```bash
curl http://localhost:8080/api/v1/TaskItems
```

## Using Scalar UI

In Development mode, Scalar UI is automatically enabled:

1. Navigate to `https://localhost:{port}/scalar/v1` (for direct run) or `http://localhost:8080/scalar/v1` (for Docker)
2. You'll see an interactive API documentation interface
3. Click any endpoint to expand it and use "Try" to test it
4. No authentication is required for local development

## Using Postman

A Postman collection is available for testing:

1. Import the collection:
   - Collection URL: https://studyplan-9664.postman.co/workspace/StudyPlan~b854a959-3425-41a8-9125-d9e7335da054/collection/102031-e46c6909-f827-46a6-affb-06cae2c01a09
   - In Postman: **File > Import** → paste URL

2. Set the environment:
   - Variable name: `baseUrl`
   - Value: `http://localhost:8080` (or your local URL)

3. Run requests from the collection

## Database Migrations

### Automatic Migrations (Development)

In Development mode, migrations are automatically applied on startup. No action needed!

### Manual Migrations

To run migrations manually:

```bash
# Install EF Core tools (if not already installed)
dotnet tool install --global dotnet-ef

# Apply migrations
dotnet ef database update --project TaskFlow.Api
```

### Create New Migrations

When you modify entity models:

```bash
dotnet ef migrations add YourMigrationName --project TaskFlow.Api
```

## Configuration

### Connection String

By default, the application uses SQLite with a file-based database:

**Development:** `tasks.db` in the project directory  
**Docker:** `/app/data/tasks.dev.db` (persisted in Docker volume)

To change the database location, set the environment variable:
```bash
export ConnectionStrings__DefaultConnection="Data Source=/custom/path/database.db"
```

### Logging

Logs are exported via OpenTelemetry OTLP to the configured backend (default: Seq at `http://localhost:5341/ingest/otlp`). In Development, logs are also written to the console.

To change the OTLP endpoint:
```bash
export OpenTelemetry__Endpoint="http://your-otlp-backend:4317"
```

### Auto-Migration Control

To disable automatic migrations in Development:

**appsettings.Development.json:**
```json
{
  "Database": {
    "MigrateOnStartup": false
  }
}
```

Or via environment variable:
```bash
export Database__MigrateOnStartup=false
```

## Development Workflow

### Watch Mode (Hot Reload)

For faster development iteration:

```bash
dotnet watch run --project TaskFlow.Api
```

The application will automatically reload when you save code changes.

### Running Tests

```bash
# Run all tests
dotnet test

# Run with code coverage
dotnet test /p:CollectCoverage=true

# Watch mode for tests
dotnet watch test --project TaskFlow.Api.Tests
```

See the [Contributing Guide](CONTRIBUTING.md#code-coverage) for the full coverage command that mirrors CI enforcement, including thresholds and exclusions.

### Code Formatting

```bash
# Check formatting
dotnet format --verify-no-changes

# Apply formatting
dotnet format
```

## Troubleshooting

### Port Already in Use

If the default port is already in use, specify a different port:

```bash
dotnet run --project TaskFlow.Api --urls "https://localhost:5051"
```

### Database Locked

If you see "database is locked" errors:
- Close any other applications accessing the database
- Delete the database file and restart (loses data)
- Use Docker instead for better isolation

### Migrations Fail

If migrations fail to apply:
1. Check database file permissions
2. Delete the database file and retry
3. Run migrations manually: `dotnet ef database update --project TaskFlow.Api`

### Docker Issues

**Container won't start:**
- Ensure Docker Desktop is running
- Check for port conflicts: `docker ps`
- View logs: `docker compose logs`

**Data not persisting:**
- Volumes are preserved by default with `docker compose down`
- To remove volumes: `docker compose down -v`

---

## Running the Frontend

### Prerequisites

- Node.js 20+
- TaskFlow.Api running at `http://localhost:8080`

### Install and start

```bash
cd TaskFlow.Web
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` and `/openapi` requests to `http://localhost:8080`, so the frontend and API work together without any CORS configuration.

### Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server with HMR at http://localhost:5173 |
| `npm run build` | Production bundle → `dist/` |
| `npm run test -- --run` | Run all 24 tests once |
| `npm run type-check` | TypeScript check only |
| `npm run lint` | ESLint |
| `npm run gen:api` | Regenerate typed API client from live spec |

### Regenerating the API client

The typed API client in `src/api/client/` is generated from the live OpenAPI spec. After any API changes:

```bash
# With the API running at http://localhost:8080:
cd TaskFlow.Web
npm run gen:api
```

The generated files are committed to source control — you don't need a running API server to build or test the frontend.

### Frontend environment variables

| File | `VITE_API_BASE_URL` | Purpose |
|------|-------------------|---------|
| `.env.development` | `http://localhost:8080` | Used by `npm run dev` |
| `.env.production` | `http://localhost:8080` | Baked into the Docker image at build time |

The generated SDK paths already include `/api/v1/...`, so `VITE_API_BASE_URL` must be the API origin only. Do not set it to `/api` — that produces double-prefixed paths like `/api/api/v1/...`. For a same-origin deployment behind a reverse proxy, use an empty string.

### Vite proxy override

To run `npm run dev` against a Dockerised API:

```bash
API_TARGET=http://localhost:8080 npm run dev
# or, if inside the Docker network:
API_TARGET=http://taskflow-api:8080 npm run dev
```

### Frontend troubleshooting

**Blank page / network errors:** Verify the API is reachable at `http://localhost:8080/health`.

**Filters or badge colours wrong:** The API returns status and priority as PascalCase strings (`"Draft"`, `"High"`). The frontend normalises to lowercase before comparisons and display. If this breaks after a `gen:api` run, the DTO type may have changed.

**API client type errors after backend change:** Run `npm run gen:api` with the API running, then fix any TypeScript errors surfaced in hooks/pages.

See [Frontend Guide](FRONTEND.md) for the full frontend reference.

---

## Next Steps

- **Explore the UI:** http://localhost:5173 (dev) or http://localhost:3000 (Docker)
- **Explore the API:** Scalar UI at http://localhost:8080/scalar/v1
- **Review the code:** [Architecture](ARCHITECTURE.md) for design decisions
- **Deploy to Azure:** [Deployment Guide](DEPLOYMENT.md)
- **Run tests:** `dotnet test` and `cd TaskFlow.Web && npm run test -- --run`
- **Add features:** [Contributing Guide](CONTRIBUTING.md)

## Additional Resources

- [Frontend Guide](FRONTEND.md)
- [Architecture Documentation](ARCHITECTURE.md)
- [Deployment Guide](DEPLOYMENT.md)
- [API Reference](API.md)
- [Contributing Guidelines](CONTRIBUTING.md)

---

[← Back to README](../README.md) | [Next: Architecture →](ARCHITECTURE.md)
