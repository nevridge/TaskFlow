# Docker Configuration Guide

> **📖 Reference Documentation** - This is a detailed technical reference for understanding Docker configuration differences. For quick start deployment, see the [Deployment Guide](DEPLOYMENT.md).

This document covers Docker configurations for all three TaskFlow services: the API (`taskflow-api`), the React frontend (`taskflow-web`), and the Seq log viewer (`taskflow-seq`).

## Overview

The `docker-compose.yml` (development) file runs all three services together. A separate `docker-compose.prod.yml` runs a production-like API configuration (the web service is not yet wired into the production compose).

- **Development**: Fast iteration with automatic migrations, Seq log viewer, React frontend
- **Production**: Optimised build with manual migration control, no Seq, no frontend

**When to use this guide:**
- Understanding intentional configuration differences between services and environments
- Troubleshooting Docker issues
- Learning Docker best practices applied across a multi-service project

## Services

The development `docker-compose.yml` defines three services:

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| `taskflow-api` | `taskflow-api` | 8080 | .NET 10 REST API |
| `taskflow-web` | `taskflow-web` | 3000 | React SPA frontend |
| `seq` | `taskflow-seq` | 5380 (UI), 5341 (OTLP) | Structured log viewer |

## Configuration Comparison

### Dockerfiles

**API (`TaskFlow.Api/Dockerfile`)**

A single multi-stage .NET Dockerfile used for both dev and prod. The build context is always the repository root (`.`). Runtime behaviour is controlled via environment variables from the compose files.

| Aspect | Value |
|--------|-------|
| **Build Context** | Repository root (`.`) |
| **Base Images** | .NET 10 SDK → .NET 10 ASP.NET runtime |
| **Environment** | Injected at runtime via `ASPNETCORE_ENVIRONMENT` |
| **Port** | 8080 |
| **Optimizations** | Release build with `--no-restore` |

**Frontend (`TaskFlow.Web/Dockerfile`)**

A two-stage Node build. The build stage runs `npm run build`, baking `VITE_API_BASE_URL=http://localhost:8080` from `.env.production` into the bundle. Because the generated SDK paths already include `/api/v1/...`, the base URL must be the API origin only — not a path prefix like `/api`. The runtime stage serves the static files with `serve -s dist`.

| Aspect | Value |
|--------|-------|
| **Build Context** | `./TaskFlow.Web` |
| **Stage 1** | `node:20-alpine` — `npm ci` + `npm run build` |
| **Stage 2** | `node:20-alpine` — `serve -s dist -l 3000` |
| **Port** | 3000 |
| **SPA routing** | `-s` flag in `serve` (all paths → `index.html`) |

### Docker Compose Files

**API service comparison:**

| Aspect | Development (`docker-compose.yml`) | Production (`docker-compose.prod.yml`) |
|--------|-----------------------------------|--------------------------------------|
| **Build Context** | `.` (repository root) | `.` (repository root) |
| **Dockerfile** | `TaskFlow.Api/Dockerfile` | `TaskFlow.Api/Dockerfile` |
| **Container Name** | `taskflow-api` | `taskflow-api-prod` |
| **Image Tag** | `taskflow-api:dev` | `taskflow-api:prod` |
| **Environment** | `Development` | `Production` |
| **Auto Migrations** | `Database__MigrateOnStartup=true` | `Database__MigrateOnStartup=false` |
| **Volumes** | Named Docker volumes | Named Docker volumes |
| **Health Check** | Enabled (40s start period) | Enabled (40s start period) |
| **Port Mapping** | `8080:8080` | `8080:8080` |

**Frontend service (dev only):**

| Aspect | Value |
|--------|-------|
| **Build Context** | `./TaskFlow.Web` |
| **Container Name** | `taskflow-web` |
| **Image Tag** | `taskflow-web:dev` |
| **Port Mapping** | `3000:3000` |
| **Depends on** | `taskflow-api` (health check must pass) |
| **`VITE_API_BASE_URL`** | `http://localhost:8080` (baked in at build time from `.env.production`) |

The frontend container waits for `taskflow-api` to pass its health check before starting, ensuring the API is ready to receive requests when the UI loads.

**Note on CORS in Docker Compose:** The frontend at port 3000 makes cross-origin requests to the API at port 8080. The API's `CorsServiceExtensions` reads allowed origins from `appsettings.Development.json` (`Cors:AllowedOrigins`). Both `localhost:3000` and `localhost:5173` (Vite dev server) are included.

**Note on service names**: Both compose files define the API service as `taskflow-api`, which is used in `docker-compose` commands. The container names (`taskflow-api` and `taskflow-api-prod`) are for the running containers and allow both to run simultaneously.

### Environment Variables

#### Common to Both Environments

| Variable | Value | Purpose |
|----------|-------|---------|
| `ASPNETCORE_URLS` | `http://+:8080` | Configure Kestrel to listen on all interfaces |
| `ASPNETCORE_HTTP_PORTS` | `8080` | Explicitly set HTTP port |
| `DOTNET_RUNNING_IN_CONTAINER` | `true` | Signal container runtime |

#### Development-Specific

| Variable | Value | Purpose |
|----------|-------|---------|
| `ASPNETCORE_ENVIRONMENT` | `Development` | Enable dev features (Swagger, detailed errors) |
| `Database__MigrateOnStartup` | `true` | Auto-apply migrations on startup |

#### Production-Specific

| Variable | Value | Purpose |
|----------|-------|---------|
| `ASPNETCORE_ENVIRONMENT` | `Production` | Enable production optimizations |
| `Database__MigrateOnStartup` | `false` | Prevent automatic migrations (manual control) |

### Volume Mounts

**Both environments use named Docker volumes:**

| Volume Name | Container Path | Purpose |
|-------------|---------------|---------|
| `taskflow-data` | `/app/data` | Persist SQLite database |
| `taskflow-logs` | `/app/logs` | Persist application logs |

**Important Notes:**
- Named volumes are managed by Docker and not tied to a host directory
- Both are created automatically on first `docker compose up`
- Database files differ by environment: `tasks.dev.db` vs `tasks.db`
- For detailed volume configuration, see [VOLUMES.md](VOLUMES.md)

### Health Checks

**Both environments use identical health check configuration:**

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
  interval: 30s        # Check every 30 seconds
  timeout: 10s         # Allow 10 seconds for response
  retries: 3           # Mark unhealthy after 3 failures
  start_period: 40s    # Grace period for startup and migrations
```

**Why identical?**
- Both environments may run migrations on startup
- Consistent health monitoring across environments
- Prevents restart loops during database initialization

## Required Differences

Some differences between environments are intentional and necessary:

### 1. Build Context Difference

**Reason**: Development optimizes for local iteration, production for complete builds.

- **Development**: Build context is `./TaskFlow.Api` to minimize Docker build context size during rapid iteration
- **Production**: Build context is repository root (`.`) to support multi-project solutions and CI/CD pipelines

**Impact**: When building manually, you must be in the correct directory or use docker-compose.

### 2. Environment Variable Difference

**Reason**: Different features and behaviors needed per environment.

- **Development**: Enables Scalar UI, detailed error pages, and verbose logging
- **Production**: Disables Scalar UI, shows generic error pages, optimized logging

**Impact**: Production-like testing requires explicitly setting `ASPNETCORE_ENVIRONMENT=Production`.

### 3. Migration Strategy Difference

**Reason**: Production deployments require controlled migration execution.

- **Development**: Automatic migrations (`Database__MigrateOnStartup=true`) for convenience
- **Production**: Manual migrations (`Database__MigrateOnStartup=false`) to prevent concurrent migration issues in scaled deployments

**Impact**: Production deployments must explicitly run migrations or set the flag.

## Usage Scenarios

### Local Development with Hot Reload

**Use Case**: Active development with frequent code changes.

**Method**: Docker Compose Development

```bash
# From repository root
docker-compose up
```

**Characteristics:**
- ✅ Fast startup
- ✅ Development environment
- ✅ Automatic migrations
- ✅ Scalar UI enabled
- ✅ Verbose logging

### Production-Like Local Testing

**Use Case**: Test production configuration before deployment.

**Method**: Docker Compose Production

```bash
# From repository root
docker-compose -f docker-compose.prod.yml up
```

**Before first run, apply migrations manually:**
```bash
# Option 1: Use dotnet CLI (if .NET 9 SDK installed locally)
# From repository root
dotnet ef database update --project TaskFlow.Api

# Option 2: Run container with migrations enabled for first run
# Note: 'taskflow-api' is the service name (not the container name 'taskflow-api-prod')
docker-compose -f docker-compose.prod.yml run --rm -e Database__MigrateOnStartup=true taskflow-api
```

**Characteristics:**
- ✅ Production environment
- ✅ Manual migration control
- ✅ Scalar UI disabled
- ✅ Production logging
- ⚠️ Requires explicit migration

### CI/CD Production Build

**Use Case**: Automated deployment pipeline.

**Method**: Direct Docker build from repo root

```bash
# Build production image
docker build -f TaskFlow.Api/Dockerfile -t taskflow-api:latest .

# Run with production settings
docker run -d -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -e ASPNETCORE_ENVIRONMENT=Production \
  -e Database__MigrateOnStartup=false \
  --name taskflow-api taskflow-api:latest
```

**Characteristics:**
- ✅ Optimized build
- ✅ No compose dependency
- ✅ Suitable for orchestrators (K8s, ECS)
- ✅ Explicit configuration via env vars

### Kubernetes Production Deployment

**Use Case**: Cloud-native container orchestration.

**Method**: Use `k8s/deployment.yaml`

```bash
kubectl apply -f k8s/deployment.yaml
```

**Characteristics:**
- ✅ Production environment
- ✅ Health probes configured
- ✅ Persistent volumes
- ✅ Resource limits
- ✅ Rolling updates

## Build Context Explained

Understanding build context is crucial for successful Docker builds:

### Build Context

Both development and production builds use the repository root (`.`) as the build context with the unified `TaskFlow.Api/Dockerfile`:

```
docker build -f TaskFlow.Api/Dockerfile .
# Build context: . (repository root)
# Dockerfile location: ./TaskFlow.Api/Dockerfile
```

**Directory structure during build:**
```
/src (in container)
└── TaskFlow.Api/
    └── TaskFlow.Api.csproj    # Copied from TaskFlow.Api/
    └── *.cs files             # Copied from TaskFlow.Api/
```

**Why this matters:**
- Production context supports future multi-project solutions
- Development context optimizes for single-project iteration
- Both approaches are valid for their use cases

## Testing Configurations Locally

### Verify Development Configuration

```bash
# Build and run development
docker-compose up -d

# Check environment
docker exec taskflow-api printenv | grep ASPNETCORE_ENVIRONMENT
# Expected: ASPNETCORE_ENVIRONMENT=Development

# Check database file
docker exec taskflow-api ls -la /app/data/
# Expected: tasks.dev.db exists

# Check Scalar UI
curl http://localhost:8080/scalar/v1
# Expected: HTTP 200 with Scalar UI

# Check health
curl http://localhost:8080/health
# Expected: {"status":"Healthy",...}

# Cleanup
docker-compose down
```

### Verify Production Configuration

```bash
# Build and run production
docker-compose -f docker-compose.prod.yml up -d

# Check environment
docker exec taskflow-api-prod printenv | grep ASPNETCORE_ENVIRONMENT
# Expected: ASPNETCORE_ENVIRONMENT=Production

# Check database file
docker exec taskflow-api-prod ls -la /app/data/
# Expected: tasks.db exists (or none if migrations not run)

# Check Scalar UI (should be disabled in production)
curl http://localhost:8080/scalar/v1
# Expected: HTTP 404

# Check health
curl http://localhost:8080/health
# Expected: {"status":"Healthy",...}

# Cleanup
docker-compose -f docker-compose.prod.yml down
```

## Common Issues and Solutions

### Issue: "Could not find file '/src/TaskFlow.Api.csproj'"

**Cause**: Incorrect build context.

**Solution**: 
- Use docker-compose: `docker-compose up` or `docker-compose -f docker-compose.prod.yml up`
- Or build directly: `docker build -f TaskFlow.Api/Dockerfile .` (from repo root)

### Issue: "Database migrations not applied in production"

**Cause**: `Database__MigrateOnStartup=false` in production.

**Solution**:
```bash
# Option 1: Run container with migrations enabled
# Note: 'taskflow-api' is the service name from docker-compose.prod.yml
docker-compose -f docker-compose.prod.yml run --rm \
  -e Database__MigrateOnStartup=true taskflow-api

# Option 2: Run migrations via dotnet CLI
# From repository root
dotnet ef database update --project TaskFlow.Api
```

### Issue: "Scalar UI not available in production"

**Cause**: Scalar UI is disabled in production environment (by design).

**Solution**: This is expected behavior. To use Scalar UI:
```bash
# Use development compose
docker-compose up

# Or override environment
docker run -e ASPNETCORE_ENVIRONMENT=Development ...
```

### Issue: "Container restarts immediately"

**Cause**: Health check failing during startup.

**Solution**: Check the start_period (40s grace period):
```bash
# View logs
docker logs taskflow-api

# Check if migrations are hanging
docker exec taskflow-api ls -la /app/data/

# Verify health check endpoint manually
docker exec taskflow-api curl http://localhost:8080/health
```

## Best Practices

### 1. Use Docker Compose for Local Development

**Why**: Simplifies commands and ensures correct build context.

```bash
# Good
docker-compose up

# Less convenient
docker build -f TaskFlow.Api/Dockerfile -t taskflow-api:dev . && \
  docker run -p 8080:8080 -e ASPNETCORE_ENVIRONMENT=Development ...
```

### 2. Test Production Configuration Locally

**Why**: Catch configuration issues before deployment.

```bash
# Test production config before pushing
docker-compose -f docker-compose.prod.yml up
```

### 3. Use Explicit Environment Variables

**Why**: Prevents ambiguity and unexpected behavior.

```bash
# Good
docker run -e ASPNETCORE_ENVIRONMENT=Production ...

# Risky (relies on Dockerfile defaults)
docker run ...
```

### 4. Separate Data by Environment

**Why**: Prevents mixing development and production-like test data.

- Development: `/app/data/tasks.dev.db`
- Production: `/app/data/tasks.db`

Both can coexist in the same `./data` volume mount.

### 5. Always Use Volume Mounts for Persistence

**Why**: Data persists across container restarts.

```bash
# Good
docker run -v $(pwd)/data:/app/data ...

# Bad (data lost on container removal)
docker run ...
```

## Summary

### Intentional Differences (Keep These)

| Aspect | Reason |
|--------|--------|
| Build context (local dir vs repo root) | Optimizes for different workflows |
| `ASPNETCORE_ENVIRONMENT` setting | Enables appropriate features per environment |
| `Database__MigrateOnStartup` flag | Production requires migration control |
| Database filename | Separates dev and prod data |

### Aligned Settings (Already Consistent)

| Aspect | Value |
|--------|-------|
| Port | 8080 |
| Volume mounts | `./data:/app/data`, `./logs:/app/logs` |
| Health check configuration | 30s interval, 40s start period |
| Base images | .NET 10 SDK and ASP.NET runtime |
| Directory permissions | `chmod 777 /app/logs /app/data` |

### New Additions for Consistency

- ✅ `docker-compose.prod.yml` for production-like local testing
- ✅ This comprehensive configuration documentation
- ✅ Side-by-side comparison tables
- ✅ Testing procedures for both configurations

## Related Documentation

- [Main README](../README.md) - Getting started and deployment
- [Deployment Guide](DEPLOYMENT.md) - Quick start deployment instructions
- [Volume Configuration](VOLUMES.md) - Detailed volume setup
- [Kubernetes Deployment](../k8s/README.md) - K8s-specific configuration
- [Security Scanning](SECURITY_SCANNING.md) - Docker image security

## Feedback and Improvements

If you encounter configuration inconsistencies not covered in this document, please:
1. Check that you're using the correct build context
2. Verify environment variables match your intended environment
3. Review the troubleshooting section
4. Open an issue with details about the discrepancy

---

[← Back to README](../README.md) | [Deployment Guide](DEPLOYMENT.md) | [Volume Configuration →](VOLUMES.md)
