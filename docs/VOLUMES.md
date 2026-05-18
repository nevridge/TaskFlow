# Volume Mount Configuration

> **📖 Reference Documentation** - This is a detailed technical reference for Docker volume configuration. For quick start deployment, see the [Deployment Guide](DEPLOYMENT.md).

This document describes the volume configuration for TaskFlow.Api, including Docker named volumes, environment variables, and best practices for local development and deployment.

## Overview

TaskFlow.Api uses **Docker named volumes** to persist data and logs across container restarts, removals, and redeployments. The application follows industry-standard practices by using `/app` as the base directory for application files, with subdirectories for persistent data.

**When to use this guide:**
- Configuring persistent storage for Docker deployments
- Understanding volume paths and environment variables
- Troubleshooting data persistence issues
- Migrating from bind mounts to named volumes

## Docker Volumes vs Bind Mounts

TaskFlow.Api supports two types of volume mounting:

### Docker Named Volumes (Default & Recommended)
- **What**: Docker-managed storage volumes with lifecycle independent of containers
- **Benefits**: 
  - Managed by Docker with commands like `docker volume ls`, `docker volume inspect`
  - Persist across container removal and recreation
  - Better performance on Windows and macOS
  - Easier backup and migration
  - No host path dependencies
- **Use case**: Development with docker-compose, production deployments
- **Configuration**: Defined in `docker-compose.yml` as `taskflow-data` and `taskflow-logs`

### Bind Mounts (Alternative)
- **What**: Direct mounts of host directories into containers
- **Benefits**:
  - Direct access to files from host filesystem
  - Useful for debugging and development
  - Easier to inspect and modify files
- **Use case**: Advanced debugging, manual deployments
- **Configuration**: Using `-v $(pwd)/data:/app/data` syntax

## Standard Volume Paths

### In-Container Paths

| Purpose | Path | Description |
|---------|------|-------------|
| Logs | `/app/logs/` | Container log output directory (mounted for persistence) |
| Database | `/app/data/` | SQLite database files |

### Docker Named Volumes (docker-compose)

| Volume Name | Container Path | Purpose |
|-------------|----------------|---------|
| `taskflow-data` | `/app/data` | Persists SQLite database |
| `taskflow-logs` | `/app/logs` | Persists application logs |

## Environment Variables

### ConnectionStrings__DefaultConnection

Controls the SQLite database file location.

- **Default (Production)**: `Data Source=/app/data/tasks.db`
- **Default (Development)**: `Data Source=/app/data/tasks.dev.db`
- **Format**: SQLite connection string
- **Example**: `ConnectionStrings__DefaultConnection="Data Source=/app/data/mydb.db"`

**Usage in docker-compose.yml:**
```yaml
environment:
  - ConnectionStrings__DefaultConnection=Data Source=/app/data/tasks.db
```

**Usage in docker run:**
```bash
docker run -e ConnectionStrings__DefaultConnection="Data Source=/app/data/tasks.db" taskflow-api:latest
```

## Docker Configuration

### Dockerfile

Both development and production environments use the unified `TaskFlow.Api/Dockerfile`, which creates the necessary directories during the build process:

```dockerfile
# Create directories for logs and data with proper permissions
RUN mkdir -p /app/logs /app/data && chmod 777 /app/logs /app/data
```

The directories are created with `777` permissions to ensure the application can write to them regardless of the user context in which the container runs. While `777` is overly permissive, it's acceptable for these specific directories in a containerized environment where:
- The container filesystem is isolated from the host
- These directories are explicitly intended for runtime data
- The application runs as a non-privileged user by default in the ASP.NET runtime image

For production deployments with stricter security requirements, consider using a non-root user and more restrictive permissions (e.g., `755` or `775`) by modifying the Dockerfile.

### docker-compose.yml

The docker-compose configuration uses Docker named volumes for data persistence:

```yaml
services:
  taskflow-api:
    # ... other configuration ...
    volumes:
      # Use Docker named volumes for data and logs persistence
      - taskflow-data:/app/data
      - taskflow-logs:/app/logs

volumes:
  taskflow-data:
    driver: local
  taskflow-logs:
    driver: local
```

This configuration:
- Creates Docker-managed named volumes `taskflow-data` and `taskflow-logs`
- Volumes are created automatically on first `docker-compose up`
- Mounts them to the corresponding paths in the container
- Data persists across container removal, recreation, and `docker-compose down`
- Volumes remain until explicitly deleted with `docker-compose down -v` or `docker volume rm`

## Usage Examples

### Local Development with docker-compose

1. **Start the containers:**
   ```bash
   docker-compose up
   ```
   This automatically creates and mounts the named volumes `taskflow-data` and `taskflow-logs`.

2. **Verify volumes were created:**
   ```bash
   # List all Docker volumes
   docker volume ls | grep taskflow
   
   # Inspect volume details
   docker volume inspect taskflow-data
   docker volume inspect taskflow-logs
   ```

3. **View data inside volumes:**
   ```bash
   # List database files (using service name)
   docker compose exec taskflow-api ls -la /app/data
   
   # View container logs
   docker compose logs -f
   ```

4. **Stop the containers:**
   ```bash
   # Stop and remove containers (volumes persist)
   docker compose down
   
   # Stop and remove containers AND volumes (data loss!)
   docker compose down -v
   ```

**Important:** Data persists in Docker-managed volumes even after `docker compose down`. Volumes remain until explicitly removed with `-v` flag or `docker volume rm`.

### Production Deployment with Docker CLI

1. **Build the production image:**
   ```bash
   cd TaskFlow.Api
   docker build -f Dockerfile -t taskflow-api:latest ..
   ```

2. **Option A: Run with Docker named volumes (recommended):**
   ```bash
   # Create named volumes
   docker volume create taskflow-prod-data
   docker volume create taskflow-prod-logs
   
   # Run with named volumes
   docker run -d \
     -p 8080:8080 \
     -v taskflow-prod-data:/app/data \
     -v taskflow-prod-logs:/app/logs \
     --name taskflow-api \
     taskflow-api:latest
   ```

3. **Option B: Run with bind mounts (host directories):**
   ```bash
   docker run -d \
     -p 8080:8080 \
     -v $(pwd)/data:/app/data \
     -v $(pwd)/logs:/app/logs \
     --name taskflow-api \
     taskflow-api:latest
   ```

4. **Verify volumes:**
   ```bash
   # List volumes
   docker volume ls | grep taskflow
   
   # Inspect volume
   docker volume inspect taskflow-prod-data
   
   # View files in volume
   docker exec taskflow-api ls -la /app/data
   ```

5. **Run with custom paths:**
   ```bash
   docker run -d \
     -p 8080:8080 \
     -v taskflow-prod-data:/app/data \
     -v taskflow-prod-logs:/app/logs \
     -e ConnectionStrings__DefaultConnection="Data Source=/app/data/production.db" \
     --name taskflow-api \
     taskflow-api:latest
   ```

### Docker Compose (Recommended for production Docker deployments)

When deploying with Docker Compose to an on-premises Docker Host (via Portainer GitOps), use named volumes for persistence:

```bash
docker compose -f docker-compose.prod.yml up -d
```

This configuration automatically:
- Creates and manages named volumes (`taskflow-data`, `taskflow-logs`)
- Persists data across container restarts
- Provides consistent paths across environments
- Supports backup and restore operations

## Managing Docker Volumes

### List volumes
```bash
# List all volumes
docker volume ls

# List TaskFlow volumes
docker volume ls | grep taskflow
```

### Inspect volume details
```bash
# View volume configuration and mount point
docker volume inspect taskflow-data
docker volume inspect taskflow-logs
```

### Remove volumes
```bash
# Remove specific volume (container must be stopped first)
docker volume rm taskflow-data

# Remove all unused volumes
docker volume prune

# Remove volumes when stopping compose
docker compose down -v
```

### Backup and restore volumes

**Backup a volume:**
```bash
# Create backup directory
mkdir -p backups

# Backup database volume
docker run --rm \
  -v taskflow-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/taskflow-data-$(date +%Y%m%d).tar.gz -C /data .

# Backup logs volume
docker run --rm \
  -v taskflow-logs:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/taskflow-logs-$(date +%Y%m%d).tar.gz -C /data .
```

**Restore a volume:**
```bash
# Stop the application
docker compose down

# Restore database volume
docker run --rm \
  -v taskflow-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/taskflow-data-20240101.tar.gz -C /data

# Restart application
docker compose up -d
```

### Copy files from volumes

**Copy database file from volume:**
```bash
# Using running container
docker cp taskflow-api:/app/data/tasks.db ./tasks-backup.db

# Using temporary container
docker run --rm \
  -v taskflow-data:/data \
  -v $(pwd):/backup \
  alpine cp /data/tasks.db /backup/tasks-backup.db
```

## Best Practices

### Development

1. **Use Docker named volumes**: The default docker-compose.yml uses named volumes for better Docker integration

2. **Clean up volumes**: Remove volumes when you want to start fresh:
   ```bash
   # Stop and remove containers and volumes
   docker compose down -v
   
   # Or remove specific volumes (after stopping containers)
   docker volume rm taskflowapi_taskflow-data taskflowapi_taskflow-logs
   ```

3. **Inspect running container**: Check volume mounts and paths:
   ```bash
   # Using compose exec (recommended)
   docker compose exec taskflow-api ls -la /app/logs /app/data
   docker compose exec taskflow-api cat /app/logs/log*.txt
   
   # Or using container name directly
   docker exec taskflow-api ls -la /app/logs /app/data
   ```

### Production

1. **Use named volumes**: For production deployments, consider using named Docker volumes instead of bind mounts:
   ```yaml
   volumes:
     - taskflow-data:/app/data
     - taskflow-logs:/app/logs
   
   volumes:
     taskflow-data:
     taskflow-logs:
   ```

2. **Backup database regularly**: Use the backup methods described in the "Backup and restore volumes" section above

3. **Log rotation**: Serilog is configured with daily rolling logs. The current log file is named `log.txt`, and old logs are automatically archived with date suffixes in the format `log<YYYYMMDD>.txt` (e.g., the file for December 1, 2023 would be `log20231201.txt`).

4. **Monitor disk space**: Ensure adequate disk space for logs and database growth.

5. **Security**: Protect the data directory as it contains the database file. Set appropriate permissions on production hosts.

## Troubleshooting

### Logs not appearing

**Symptom**: Container runs but no log files appear in the volume.

**Diagnosis:**
```bash
# Check if the directory exists in the container
docker compose exec taskflow-api ls -la /app/logs

# Check the LOG_PATH environment variable
docker compose exec taskflow-api env | grep LOG_PATH

# Check container logs for Serilog errors
docker compose logs taskflow-api

# Verify volume is mounted
docker inspect taskflow-api | grep -A 10 Mounts

# Check volume exists
docker volume ls | grep taskflow
```

**Solutions:**
- Ensure the volume mount is correct in docker-compose.yml (`taskflow-logs:/app/logs`)
- Verify the LOG_PATH environment variable is set correctly
- Check directory permissions inside container (should be 777)
- Recreate the volume: `docker compose down -v && docker compose up`

### Database not persisting

**Symptom**: Data is lost when container restarts.

**Diagnosis:**
```bash
# Check if the database file exists
docker exec taskflow-api ls -la /app/data

# Verify the connection string
docker exec taskflow-api env | grep ConnectionStrings

# Check volume mounts
docker inspect taskflow-api | grep -A 10 Mounts
```

**Solutions:**
- Ensure `taskflow-data:/app/data` volume mount is present in docker-compose.yml
- Verify the connection string points to `/app/data/tasks.db`
- Check that the database file exists in the volume:
  ```bash
  # Using running container
  docker compose exec taskflow-api ls -la /app/data
  
  # Or inspect volume contents directly
  docker run --rm -v taskflowapi_taskflow-data:/data alpine ls -la /data
  ```

### Permission denied errors

**Symptom**: Application crashes with "Permission denied" when writing to logs or database.

**Diagnosis:**
```bash
# Check the user the container runs as
docker compose exec taskflow-api whoami

# Check directory permissions inside container
docker compose exec taskflow-api ls -la /app/data /app/logs

# Check volume mount details
docker inspect taskflow-api | grep -A 10 Mounts
```

**Solutions:**
```bash
# Rebuild the image to ensure directories are created with correct permissions
docker compose build --no-cache

# Recreate volumes with correct permissions
docker compose down -v
docker compose up --build
```

### Different behavior in different environments

**Local Development vs. Docker Host:**
- Local: Docker Desktop manages volumes automatically
- Docker Host: Portainer GitOps handles volume lifecycle
- Both: Same Docker named volumes configuration, consistent behavior across environments

## Migration Guide

### Migrating from Bind Mounts to Docker Named Volumes

If you were previously using bind mounts (host directories `./data` and `./logs`), follow these steps to migrate to Docker named volumes:

#### Option 1: Import existing data into new volumes (recommended)

1. **Stop the running containers:**
   ```bash
   docker compose down
   ```

2. **Create the new named volumes:**
   ```bash
   docker volume create taskflow-data
   docker volume create taskflow-logs
   ```

3. **Copy data from bind mounts to named volumes:**
   ```bash
   # Copy database files to named volume
   docker run --rm \
     -v $(pwd)/data:/source \
     -v taskflow-data:/dest \
     alpine sh -c "cp -a /source/. /dest/"
   
   # Copy log files to named volume
   docker run --rm \
     -v $(pwd)/logs:/source \
     -v taskflow-logs:/dest \
     alpine sh -c "cp -a /source/. /dest/"
   ```

4. **Verify data was copied:**
   ```bash
   # Check database volume
   docker run --rm -v taskflow-data:/data alpine ls -la /data
   
   # Check logs volume
   docker run --rm -v taskflow-logs:/data alpine ls -la /data
   ```

5. **Update docker-compose.yml** (if not already updated):
   ```yaml
   services:
     taskflow-api:
       volumes:
         - taskflow-data:/app/data
         - taskflow-logs:/app/logs
   
   volumes:
     taskflow-data:
       driver: local
     taskflow-logs:
       driver: local
   ```

6. **Start with the new configuration:**
   ```bash
   docker compose up -d
   ```

7. **Verify the application is working:**
   ```bash
   # Check health
   curl http://localhost:8080/health
   
   # View logs
   docker exec taskflow-api ls -la /app/data /app/logs
   ```

8. **Optional: Clean up old bind mount directories:**
   ```bash
   # Backup first!
   tar czf data-backup.tar.gz data/
   tar czf logs-backup.tar.gz logs/
   
   # Remove old directories
   rm -rf data/ logs/
   ```

#### Option 2: Start fresh with named volumes

If you don't need to preserve existing data:

1. **Stop and remove containers:**
   ```bash
   docker compose down
   ```

2. **Update docker-compose.yml** to use named volumes (if not already updated)

3. **Start with new named volumes:**
   ```bash
   docker compose up -d
   ```

4. **Optional: Remove old bind mount directories:**
   ```bash
   rm -rf data/ logs/
   ```

### Migrating from `/home` paths (legacy)

If you're upgrading from a previous version that used `/home/logs` and `/home/tasks.db`:

#### For Local Development

1. **Update to latest version:**
   ```bash
   git pull origin main
   docker compose down
   docker compose build --no-cache
   ```

2. **Start with new configuration:**
   ```bash
   docker compose up -d
   ```

The new configuration will create Docker named volumes automatically.

### For Docker Host Deployment (Production)

Docker Host (Portainer GitOps) uses Docker Compose with named volumes, but with different volume names than development to prevent data conflicts:

**Volume Names:**
- **Development** (docker-compose.yml): `taskflow-data`, `taskflow-logs`
- **Production** (docker-compose.prod.yml): `taskflow-data-prod`, `taskflow-logs-prod`

**Configuration:**
1. **Configuration is automatic** - `docker-compose.prod.yml` creates and manages volumes
2. **Separate volumes** - Production volumes are isolated from development (prevents accidental overwrites)
3. **Consistent paths** - Container paths are `/app/data` and `/app/logs` in both environments
4. **Data persists** - Volumes outlive container lifecycle

Your data in volumes will automatically persist when using the standard compose configuration. When migrating data between environments, ensure you're using the correct volume names for each environment.

## Summary

- **Volume Type**: Docker named volumes (default) or bind mounts (alternative)
- **Default container paths**: `/app/logs` for logs, `/app/data` for database
- **Development volumes**: `taskflow-data` and `taskflow-logs` (docker-compose.yml)
- **Production volumes**: `taskflow-data-prod` and `taskflow-logs-prod` (docker-compose.prod.yml)
- **Environment variables**: `LOG_PATH` and `ConnectionStrings__DefaultConnection` for customization
- **Persistence**: Data persists across container removal/recreation until volumes are explicitly deleted
- **Management**: Use `docker volume` commands to manage, backup, and restore volumes
- **Best practice**: Use Docker named volumes for most scenarios, bind mounts for advanced debugging
- **Migration**: Follow the migration guide above if upgrading from bind mounts
---

[← Back to README](../README.md) | [Docker Configuration](DOCKER_CONFIGURATION.md) | [Volume Testing →](VOLUME_TESTING.md)
