# Volume Persistence Testing Guide

> **📖 Reference Documentation** - This is a detailed testing guide. For quick start deployment, see the [Deployment Guide](DEPLOYMENT.md).


This guide provides instructions for testing Docker volume persistence in TaskFlow.Api to ensure data survives container removal and recreation.

## Prerequisites

- Docker or Docker Desktop installed
- Docker Compose v2 installed
- `curl` or similar HTTP client
- `jq` (optional, for JSON parsing in automated tests)

## Manual Testing

### Test 1: Basic Volume Creation

Verify that Docker volumes are created and mounted correctly.

1. **Start the application:**
   ```bash
   cd /path/to/TaskFlow   # repository root, where docker-compose.yml lives
   docker compose up -d
   ```

2. **Check that volumes were created:**
   ```bash
   docker volume ls --filter name=taskflow
   ```
   
   Expected output:
   ```
   local     <project>_taskflow-data
   local     <project>_taskflow-logs
   ```

   `<project>` is your compose project name; see [Compose Project Name](DOCKER_CONFIGURATION.md#compose-project-name). Lines for the test stack (`taskflow-test_*`) may also appear.

3. **Inspect volume details:**
   ```bash
   docker volume inspect <project>_taskflow-data
   ```
   
   Expected output should show mount point and driver:
   ```json
   [
       {
           "CreatedAt": "<timestamp>",
           "Driver": "local",
           "Labels": {
               "com.docker.compose.project": "<project>",
               "com.docker.compose.version": "<compose version>",
               "com.docker.compose.volume": "taskflow-data"
           },
           "Mountpoint": "/var/lib/docker/volumes/<project>_taskflow-data/_data",
           "Name": "<project>_taskflow-data",
           "Options": null,
           "Scope": "local"
       }
   ]
   ```

   Values in angle brackets are illustrative; yours will differ.

4. **Verify files exist in volumes:**
   ```bash
   docker exec taskflow-api ls -la /app/data
   docker exec taskflow-api ls -la /app/logs
   ```
   
   Expected: Database file (`tasks.dev.db`) and log files should be present.

### Test 2: Data Persistence Across Container Restart

Verify that data persists when the container is restarted.

1. **Create test data via API:**
   ```bash
   curl -X POST http://localhost:8080/api/v1/TaskItems \
     -H "Content-Type: application/json" \
     -d '{"title":"Persistence Test","description":"Testing volume persistence","statusId":1,"isComplete":false}'
   ```

2. **Verify task was created:**
   ```bash
   curl http://localhost:8080/api/v1/TaskItems
   ```

   Expected: JSON array containing your task.
   ```bash
   docker compose restart
   ```

4. **Wait for application to be healthy:**
   ```bash
   curl http://localhost:8080/health
   ```

5. **Verify task still exists:**
   ```bash
   curl http://localhost:8080/api/v1/TaskItems
   ```

   Expected: Same task from step 2 should still be present.

### Test 3: Data Persistence Across Container Removal

Verify that data persists even when the container is removed and recreated.

1. **Create test data (if not already done):**
   ```bash
   curl -X POST http://localhost:8080/api/v1/TaskItems \
     -H "Content-Type: application/json" \
     -d '{"title":"Removal Test","description":"Testing persistence after removal","statusId":2,"isComplete":false}'
   ```

2. **Count tasks:**
   ```bash
   curl http://localhost:8080/api/v1/TaskItems | jq '. | length'
   ```

   Note the count (e.g., 2 tasks).
   ```bash
   docker compose down
   ```

4. **Verify volumes still exist:**
   ```bash
   docker volume ls --filter name=taskflow
   ```
   
   Expected: Both volumes should still be listed.

5. **Recreate and start the container:**
   ```bash
   docker compose up -d
   ```

6. **Wait for application to be healthy:**
   ```bash
   # Wait a few seconds for startup
   sleep 10
   curl http://localhost:8080/health
   ```

7. **Verify all tasks still exist:**
   ```bash
   curl http://localhost:8080/api/v1/TaskItems | jq '. | length'
   ```

   Expected: Same count as step 2. All data should be preserved.

### Test 4: Volume Cleanup

Verify that volumes can be removed when needed.

1. **Stop and remove containers and volumes:**

   > **Warning:** this deletes your data permanently.
   ```bash
   docker compose down -v
   ```

2. **Verify volumes were removed:**
   ```bash
   docker volume ls --filter name=<project>_taskflow
   ```
   
   Expected: no `<project>_taskflow-data` or `<project>_taskflow-logs` volumes are listed. Volumes from other projects (such as `taskflow-test_*`) may still appear and are not a failure.

3. **Start fresh:**
   ```bash
   docker compose up -d
   ```

4. **Verify empty database:**
   ```bash
   sleep 10
   curl http://localhost:8080/api/v1/TaskItems
   ```

   Expected: Empty array `[]` (no tasks).

## Automated Testing Script

For automated testing, use the following script:

```bash
#!/bin/bash
set -e

echo "=== Testing Docker Volume Persistence ==="
echo ""

# Change to your TaskFlow.Api repository directory
# Example: cd ~/projects/TaskFlow.Api
cd "$(dirname "$0")/.."

echo "Step 1: Clean up..."
docker compose down -v 2>/dev/null || true
sleep 2

echo ""
echo "Step 2: Start application..."
docker compose up -d
sleep 10

echo ""
echo "Step 3: Wait for health check..."
for i in {1..30}; do
    if curl -f http://localhost:8080/health 2>/dev/null >/dev/null; then
        echo "✓ Application is healthy"
        break
    fi
    [ $i -eq 30 ] && echo "✗ Timeout" && exit 1
    sleep 2
done

echo ""
echo "Step 4: Verify volumes exist..."
docker volume ls --filter name=taskflow | grep -q taskflow || (echo "✗ Volumes not found" && exit 1)
echo "✓ Volumes created"

echo ""
echo "Step 5: Create test task..."
TASK_ID=$(curl -s -X POST http://localhost:8080/api/v1/TaskItems \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","description":"Testing","statusId":1,"isComplete":false}' \
  | jq -r '.id')
echo "✓ Created task: $TASK_ID"

echo ""
echo "Step 6: Verify task exists..."
TASK_COUNT=$(curl -s http://localhost:8080/api/v1/TaskItems | jq '. | length')
echo "✓ Task count: $TASK_COUNT"
[ "$TASK_COUNT" -lt 1 ] && echo "✗ Failed to create task" && exit 1

echo ""
echo "Step 7: Remove container (keep volumes)..."
docker compose down
sleep 2

echo ""
echo "Step 8: Verify volumes persist..."
docker volume ls --filter name=taskflow | grep -q taskflow || (echo "✗ Volumes disappeared" && exit 1)
echo "✓ Volumes still exist"

echo ""
echo "Step 9: Restart application..."
docker compose up -d
sleep 10

echo ""
echo "Step 10: Wait for health check..."
for i in {1..30}; do
    if curl -f http://localhost:8080/health 2>/dev/null >/dev/null; then
        echo "✓ Application is healthy after restart"
        break
    fi
    [ $i -eq 30 ] && echo "✗ Timeout after restart" && exit 1
    sleep 2
done

echo ""
echo "Step 11: Verify data persisted..."
TASK_COUNT=$(curl -s http://localhost:8080/api/v1/TaskItems | jq '. | length')
echo "✓ Task count after restart: $TASK_COUNT"
[ "$TASK_COUNT" -lt 1 ] && echo "✗ Data was lost!" && exit 1

echo ""
echo "=== ✓ SUCCESS: All volume persistence tests passed! ==="
echo ""

# Cleanup
echo "Cleaning up..."
docker compose down
```

## Common Issues

### Issue: Volumes not created

**Symptoms:**
- `docker volume ls` shows no taskflow volumes
- Application fails to start

**Solution:**
```bash
# Ensure docker-compose.yml has volumes section:
volumes:
  taskflow-data:
    driver: local
  taskflow-logs:
    driver: local

# Recreate:
docker compose down -v
docker compose up -d
```

### Issue: Data lost after `docker compose down`

**Symptoms:**
- Database is empty after recreating containers

**Causes:**
- Used `docker compose down -v` (removes volumes)
- Volume mount configuration error

**Solution:**
```bash
# Use down without -v flag:
docker compose down  # Keeps volumes

# Not this:
docker compose down -v  # Removes volumes
```

### Issue: Permission denied errors

**Symptoms:**
- Application crashes with permission errors
- Can't write to /app/data or /app/logs

**Solution:**
```bash
# Rebuild image with correct permissions:
docker compose down
docker compose build --no-cache
docker compose up -d

# Check permissions inside container:
docker exec taskflow-api ls -la /app/data /app/logs
```

### Issue: Cannot access data on host

**Symptoms:**
- Can't find database file on host filesystem
- Data is in volumes but can't access directly

**Explanation:**
Docker named volumes store data in Docker's internal storage area (typically `/var/lib/docker/volumes/` on Linux). This is by design for better portability and performance.

**Solutions:**

1. **Copy files from volume:**
   ```bash
   docker cp taskflow-api:/app/data/tasks.dev.db ./my-backup.db
   ```

2. **Use temporary container to access volume:**
   ```bash
   docker run --rm -v <project>_taskflow-data:/data alpine ls -la /data
   ```

3. **If you need direct host access, switch to bind mounts:**
   ```yaml
   # In docker-compose.yml:
   volumes:
     - ./data:/app/data
     - ./logs:/app/logs
   ```

## Best Practices

1. **Never use `-v` flag with `docker compose down` in production** unless you intentionally want to delete all data

2. **Regular backups:**

   > **Warning:** use the real, prefixed volume name (`<project>_<key>`; see [Compose Project Name](DOCKER_CONFIGURATION.md#compose-project-name), and run `docker volume ls --filter name=taskflow` to find it). A wrong name does not fail: Docker silently creates a new, empty volume and the backup or restore runs against that.
   ```bash
   # Backup volumes
   docker run --rm \
     -v <project>_taskflow-data:/data \
     -v $(pwd)/backups:/backup \
     alpine tar czf /backup/db-$(date +%Y%m%d).tar.gz -C /data .
   ```

3. **Test volume persistence in CI/CD:**
   - Include volume persistence tests in your deployment pipeline
   - Verify data survives container recreation

4. **Monitor volume disk usage:**
   ```bash
   docker system df -v
   ```

5. **Document volume requirements** for anyone deploying the application

## Success Criteria

A successful volume persistence test should demonstrate:

- ✓ Volumes are created automatically on first startup
- ✓ Database and log files are stored in volumes
- ✓ Data persists across container restarts
- ✓ Data persists across container removal and recreation
- ✓ Volumes can be inspected and managed with Docker commands
- ✓ Data is only lost when volumes are explicitly deleted

## See Also

- [Volume Configuration Guide](VOLUMES.md) - Comprehensive volume setup documentation
- [Docker Volumes Documentation](https://docs.docker.com/storage/volumes/) - Official Docker documentation
- [README.md](../README.md) - Main project documentation

---

[← Back to README](../README.md) | [Deployment Guide](DEPLOYMENT.md) | [Volumes →](VOLUMES.md)
