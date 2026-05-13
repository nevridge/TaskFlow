# Deployment Guide

Comprehensive guide for deploying TaskFlow locally with Docker and to production via Portainer GitOps.

## Table of Contents

- [Docker Deployment](#docker-deployment)
- [Production Deployment](#production-deployment)
- [CI/CD Workflows](#cicd-workflows)
- [Environment Configuration](#environment-configuration)
- [Troubleshooting](#troubleshooting)

## Docker Deployment

### Quick Start

**Development (with auto-migrations):**
```bash
docker compose up
```

**Production-like (manual migrations):**
```bash
docker compose -f docker-compose.prod.yml up
```

### Docker Configuration Overview

TaskFlow provides two Docker configurations for different deployment scenarios.

> **For detailed Docker configuration, see:**
> - [DOCKER_CONFIGURATION.md](DOCKER_CONFIGURATION.md) - Comprehensive dev vs prod comparison
> - [VOLUMES.md](VOLUMES.md) - Volume configuration and persistence
> - [HEALTH_CHECK_TESTING.md](HEALTH_CHECK_TESTING.md) - Health check setup and testing

**Quick comparison:**

| Configuration | Use Case | Auto-migrations | Scalar UI |
|--------------|----------|----------------|-----------|
| **Development** (`docker-compose.yml`) | Local dev, fast iteration | Enabled | Enabled |
| **Production** (`docker-compose.prod.yml`) | Production builds | Manual | Disabled |

### Development Deployment

**Quick start:**
```bash
docker compose up
```

Access at `http://localhost:8080` (Scalar UI available at `/scalar/v1`)

**Common commands:**
```bash
# View logs
docker compose logs -f

# Stop (preserves data)
docker compose down

# Stop and remove data
docker compose down -v
```

> **For detailed instructions, see [DOCKER_CONFIGURATION.md](DOCKER_CONFIGURATION.md)**

### Production Deployment

**Quick start:**
```bash
# Apply migrations first (one-time)
dotnet ef database update --project TaskFlow.Api

# Start production containers
docker compose -f docker-compose.prod.yml up -d

# Verify
curl http://localhost:8080/health
```

> **For detailed instructions including Docker CLI usage, see [DOCKER_CONFIGURATION.md](DOCKER_CONFIGURATION.md)**

## Production Deployment

TaskFlow deploys to a Docker Host using Portainer GitOps with images hosted on GitHub Container Registry (GHCR).

### Architecture

```
Push to main (TaskFlow repo)
    │
    ▼
GitHub Actions: ghcr-deploy.yml
    │
    ▼
Build Docker images (API + Web)
    │
    ▼
Push to GHCR:
  - ghcr.io/nevridge/taskflow-api:sha-<commit>
  - ghcr.io/nevridge/taskflow-web:sha-<commit>
    │
    ▼
Update image tags in nevridge/taskflow-deploy repo
    │
    ▼
Commit & push to taskflow-deploy
    │
    ▼
Portainer GitOps detects change and deploys stack
```

### Services

| Service | URL | Description |
|---------|-----|-------------|
| Web Frontend | https://taskflow.skalaforge.com | Vite-based React frontend |
| API | https://taskflow-api.skalaforge.com | .NET API backend |
| Seq | https://taskflow-seq.skalaforge.com | Structured logging UI |

### How It Works

1. **Push to main** - Any push to the `main` branch triggers the deployment workflow
2. **Build images** - GitHub Actions builds both `taskflow-api` and `taskflow-web` Docker images
3. **Push to GHCR** - Images are pushed to GitHub Container Registry with immutable SHA tags
4. **Update GitOps repo** - The workflow updates image tags in the `nevridge/taskflow-deploy` repository
5. **Portainer deploys** - Portainer detects the change and redeploys the stack

### GitOps Repository

Production compose configuration lives in a separate repository: [nevridge/taskflow-deploy](https://github.com/nevridge/taskflow-deploy)

This separation allows:
- Clean audit trail of deployments
- Easy rollback by reverting commits
- Portainer GitOps integration

### Triggering a Deployment

Simply push to the `main` branch:
```bash
git push origin main
```

The workflow automatically:
1. Builds both images
2. Tags with `sha-<commit>` and `latest`
3. Updates the deploy repo
4. Portainer picks up the change

### Manual Rollback

To rollback to a previous version:
1. Go to `nevridge/taskflow-deploy` repository
2. Find the commit with the desired image tags
3. Revert the compose file to that commit
4. Portainer will redeploy the previous version

### Secrets Required

| Secret | Location | Purpose |
|--------|----------|---------|
| `DEPLOY_REPO_TOKEN` | TaskFlow repo | PAT to push to taskflow-deploy |
| Portainer registry credential | Portainer | PAT with `read:packages` to pull from GHCR |

## CI/CD Workflows

### Build and Test Workflow

**File:** `.github/workflows/ci.yml`

**Triggers:**
- Push to any branch
- Pull requests

**Jobs:**
1. **Lint:** Validates C# code formatting with `dotnet format`
2. **Build:** Compiles solution in Release configuration
3. **Test:** Runs tests with code coverage enforcement (58% minimum)

**Code Coverage:**
- Enforces minimum 58% line coverage
- Generates detailed coverage reports
- Build fails if coverage drops below threshold

### Security Scanning Workflows

**CodeQL (SAST):**
- File: `.github/workflows/codeql.yml`
- Scans C# code for security vulnerabilities
- Triggers: Push to main, PRs, weekly schedule
- Results: GitHub Security tab

**Trivy (Container Scanning):**
- File: `.github/workflows/security-scan.yml`
- Scans Docker images for vulnerabilities
- Fails on CRITICAL/HIGH severity findings
- Triggers: Push to main, PRs, weekly schedule

For detailed security scanning documentation, see [SECURITY_SCANNING.md](SECURITY_SCANNING.md).

### Deployment Workflow

**File:** `.github/workflows/ghcr-deploy.yml`

**Triggers:** Push to `main` branch

**Jobs:**
1. **build-and-push** - Builds API and Web images, pushes to GHCR
2. **update-gitops** - Updates image tags in taskflow-deploy repo

## Environment Configuration

### Environment Variables

**Core Settings:**

| Variable | Default | Purpose |
|----------|---------|--------|
| `ASPNETCORE_ENVIRONMENT` | `Production` | Controls environment-specific behavior |
| `ConnectionStrings__DefaultConnection` | `Data Source=/app/data/tasks.db` | SQLite database path |
| `Database__MigrateOnStartup` | `false` (true in Development) | Enable automatic migrations |

**OpenTelemetry Settings:**

| Variable | Default | Purpose |
|----------|---------|--------|
| `OpenTelemetry__ServiceName` | `TaskFlow.Api` | Service name reported in traces and logs |
| `OpenTelemetry__Endpoint` | `http://localhost:5341/ingest/otlp` | OTLP collector endpoint |
| `OpenTelemetry__Header` | *(none)* | Optional auth header for OTLP exporter |
| `OpenTelemetry__Protocol` | `http/protobuf` | Export protocol |

### Configuration Files

**appsettings.json** - Base configuration for all environments
**appsettings.Development.json** - Development overrides
**appsettings.Production.json** - Production overrides (optional)

**Override order (highest to lowest priority):**
1. Environment variables
2. `appsettings.{Environment}.json`
3. `appsettings.json`

### Docker Environment Configuration

**docker-compose.yml (Development):**
```yaml
environment:
  - ASPNETCORE_ENVIRONMENT=Development
  - ASPNETCORE_URLS=http://+:8080
  - Database__MigrateOnStartup=true
```

**Production (taskflow-deploy):**
```yaml
environment:
  - ASPNETCORE_ENVIRONMENT=Production
  - ASPNETCORE_HTTP_PORTS=8080
  - Database__MigrateOnStartup=false
  - OpenTelemetry__Endpoint=http://seq:5341/ingest/otlp/v1/logs
```

## Troubleshooting

### Docker Issues

**Container won't start:**
```bash
# Check logs
docker compose logs

# Check container status
docker ps -a

# Inspect specific container
docker logs taskflow-api
```

**Port already in use:**
```bash
# Find process using port 8080
lsof -i :8080  # macOS/Linux
netstat -ano | findstr :8080  # Windows

# Use different port in docker-compose.yml
ports:
  - "8081:8080"
```

**Database locked errors:**
- Ensure only one container accesses the database
- Stop other instances: `docker compose down`
- Check volume mounts are correct

**Health check failing:**
```bash
# Check health status
docker inspect --format='{{json .State.Health}}' taskflow-api

# Test health endpoint manually
curl http://localhost:8080/health

# View detailed container logs
docker logs taskflow-api --tail 100
```

### Production Deployment Issues

**Images not appearing in GHCR:**
- Check GitHub Actions workflow completed successfully
- Verify `GITHUB_TOKEN` has `packages: write` permission
- Check workflow logs for push errors

**GitOps repo not updated:**
- Verify `DEPLOY_REPO_TOKEN` secret is set correctly
- Ensure PAT has `repo` scope or Contents read/write permission
- Check workflow logs for commit/push errors

**Portainer not deploying:**
- Verify GitOps is enabled on the stack
- Check Portainer has registry credentials for GHCR
- Verify polling interval or trigger webhook manually
- Check Portainer logs for pull errors

**Service not accessible:**
- Verify Traefik labels are correct
- Check DNS records point to Docker host
- Verify `traefik-public` network exists
- Check Traefik dashboard for router status

### Migration Issues

**Migrations not applied:**
```bash
# Manually apply migrations
dotnet ef database update --project TaskFlow.Api

# Or enable auto-migration temporarily
docker run -e Database__MigrateOnStartup=true taskflow-api:latest
```

**Migration conflicts:**
```bash
# List migrations
dotnet ef migrations list --project TaskFlow.Api

# Rollback to specific migration
dotnet ef database update PreviousMigrationName --project TaskFlow.Api

# Remove last migration (if not applied)
dotnet ef migrations remove --project TaskFlow.Api
```

### Logging and Debugging

**Enable verbose logging:**
```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "Microsoft": "Information",
      "System": "Information"
    }
  }
}
```

**View application logs:**
```bash
# Docker
docker logs taskflow-api --follow

# Docker Compose
docker compose logs -f taskflow-api

# Production (via Seq)
# Visit https://taskflow-seq.skalaforge.com
```

**Check health check logs:**
Health check failures are automatically logged. Look for:
```
[ERR] Health check database failed: Unable to connect to database
[WRN] Health check database is Degraded
```

For comprehensive logging documentation, see [LOGGING.md](LOGGING.md).

## Additional Resources

- [Docker Configuration Details](DOCKER_CONFIGURATION.md) - Detailed Docker configuration comparison
- [Volume Configuration](VOLUMES.md) - Docker volume management
- [Security Scanning](SECURITY_SCANNING.md) - CodeQL and Trivy configuration
- [Design Spec](superpowers/specs/2026-05-12-portainer-gitops-deployment-design.md) - Original deployment design

---

[← Back to README](../README.md) | [Architecture](ARCHITECTURE.md) | [Contributing →](CONTRIBUTING.md)
