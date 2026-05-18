# Health Check Configuration Testing Guide

> **📖 Reference Documentation** - This is a detailed testing guide. For deployment basics, see the [Deployment Guide](DEPLOYMENT.md).


This document describes how to test and verify the health check configurations across different orchestrators.

## Overview

The health check configurations have been designed to accommodate database migrations that run at startup. The key parameters are:

- **Docker Compose**: `start_period: 40s`
- **Kubernetes**: `initialDelaySeconds: 45s` (readiness), `60s` (liveness)
- **Docker Host (Portainer)**: Uses same Docker Compose configuration

## Testing Docker Compose Health Checks

### Prerequisites
- Docker and Docker Compose installed
- Clean database state (delete `./data` directory for fresh migration test)

### Test Procedure

1. **Clean state test** (simulates first deployment with migrations):
   ```bash
   # Remove existing database to force full migration
   rm -rf ./data ./logs
   
   # Start the container
   docker-compose up --build
   ```

2. **Monitor health check status**:
   ```bash
   # In another terminal, watch the health status
   watch -n 2 'docker inspect taskflow-api --format="{{.State.Health.Status}}"'
   ```

3. **Expected behavior**:
   - **First 40 seconds**: Health status shows as `starting`
   - During this period, failed health checks don't count toward unhealthy status
   - **After 40 seconds**: Once migrations complete, health checks begin counting
   - Status should transition to `healthy` once the app responds successfully

4. **View detailed health check logs**:
   ```bash
   docker inspect taskflow-api --format='{{json .State.Health}}' | jq
   ```

### Test Scenarios

#### Scenario 1: Normal startup with migrations
```bash
rm -rf ./data
docker-compose up --build
```
**Expected**: Container becomes healthy within 45 seconds (40s start_period + first successful check)

#### Scenario 2: Restart with existing database
```bash
docker-compose restart
```
**Expected**: Container becomes healthy within 10-15 seconds (no migrations needed)

#### Scenario 3: Simulated slow migration
To simulate a slow migration, you can temporarily increase the migration time or test with a larger database with many records.

### Troubleshooting

**Problem**: Container marked unhealthy immediately
- **Cause**: `start_period` too short for migrations
- **Solution**: Increase `start_period` in docker-compose.yml

**Problem**: Health checks failing after start_period
- **Cause**: Application not responding or migrations failed
- **Solution**: Check logs with `docker-compose logs -f`

## Testing Kubernetes Health Checks

### Prerequisites
- Kubernetes cluster (local with minikube/kind or remote)
- kubectl configured
- Docker image built and pushed to accessible registry

### Test Procedure

1. **Deploy with clean database**:
   ```bash
   # Apply the deployment
   kubectl apply -f k8s/deployment.yaml
   
   # Watch pod status
   kubectl get pods -l app=taskflow-api -w
   ```

2. **Monitor probe status**:
   ```bash
   # Watch pod events
   kubectl describe pod -l app=taskflow-api
   
   # Look for probe-related events:
   # - "Liveness probe failed" (should NOT appear in first 60 seconds)
   # - "Readiness probe failed" (should NOT appear in first 45 seconds)
   ```

3. **Expected behavior**:
   - **0-45 seconds**: Pod in `Running` state but not `Ready` (no readiness checks yet)
   - **45-60 seconds**: Readiness probe starts, pod becomes `Ready` once successful
   - **After 60 seconds**: Liveness probe starts checking
   - No restarts should occur during migration period

4. **Check health endpoints manually**:
   ```bash
   # Port forward to pod
   kubectl port-forward -l app=taskflow-api 8080:8080
   
   # In another terminal, test endpoints
   curl http://localhost:8080/health
   curl http://localhost:8080/health/ready
   curl http://localhost:8080/health/live
   ```

### Test Scenarios

#### Scenario 1: Fresh deployment with migrations
```bash
kubectl apply -f k8s/deployment.yaml
kubectl wait --for=condition=ready pod -l app=taskflow-api --timeout=120s
```
**Expected**: Pods become ready within 90 seconds (45s initial delay + probe execution time)

#### Scenario 2: Rolling update
```bash
kubectl set image deployment/taskflow-api taskflow-api=taskflow-api:new-version
kubectl rollout status deployment/taskflow-api
```
**Expected**: New pods become ready before old pods are terminated (no downtime)

#### Scenario 3: Simulated failing migration
Temporarily break the database connection to simulate migration failure:
```bash
kubectl set env deployment/taskflow-api ConnectionStrings__DefaultConnection="invalid"
```
**Expected**: Readiness probe fails, pod never becomes ready, rollout doesn't proceed

### Troubleshooting

**Problem**: Pods restarting during startup
- **Cause**: Liveness probe `initialDelaySeconds` too short
- **Solution**: Increase to at least 60 seconds

**Problem**: Pods not receiving traffic for too long
- **Cause**: Readiness probe `initialDelaySeconds` too long
- **Solution**: Decrease slightly, but ensure migrations complete first

## Testing Docker Host (Portainer) Health Checks

> **Note:** Docker Host deployments use the same Docker Compose health check configuration as local development.

### Verification in Production

```bash
# SSH to the Docker Host
ssh user@docker-host

# Check container health
docker ps --filter "name=taskflow-api" --format "table {{.Names}}\t{{.Status}}"

# View health check details
docker inspect --format '{{.State.Health.Status}}' taskflow-api

# Manual health check
curl https://taskflow-api.skalaforge.com/health
```

### Monitoring via Portainer

1. **Access Portainer UI**
2. **Navigate to Containers**
3. **Find taskflow-api container**
4. **Check Health column** - Should show "healthy"

### Troubleshooting

**Problem**: Container shows "unhealthy"
- **Check logs**: `docker logs taskflow-api`
- **Verify DB connection**: Ensure volume mounts are correct
- **Check network**: Ensure container can reach database

## General Testing Best Practices

1. **Test with clean database**: Always test with a fresh database to simulate worst-case migration time
2. **Monitor logs**: Watch application logs during startup to see migration progress
3. **Measure migration time**: Time how long migrations actually take in your environment
4. **Add buffer**: Set initial delays with 30-50% buffer above measured migration time
5. **Test failure scenarios**: Verify behavior when health checks legitimately fail (not just during startup)
6. **Document actual times**: Record actual migration and startup times for your specific deployments

## Adjusting Delays Based on Testing

After testing, you may need to adjust the delays:

### Docker Compose
Edit `docker-compose.yml`:
```yaml
healthcheck:
  start_period: 40s  # Adjust based on measured migration time + buffer
```

### Kubernetes
Edit `k8s/deployment.yaml`:
```yaml
readinessProbe:
  initialDelaySeconds: 45  # Adjust based on testing
livenessProbe:
  initialDelaySeconds: 60  # Should be >= readiness + buffer
```

## Monitoring in Production

Once deployed to production, monitor:

1. **Health check success rate**: Should be >99% after initial startup
2. **Container restart frequency**: Should be minimal
3. **Time to healthy**: Track how long containers take to become healthy
4. **Migration duration**: Monitor migration execution time over releases

Set up alerts for:
- Repeated health check failures
- Containers restarting frequently
- Unusually long startup times
- Failed migrations

## Related Documentation

- [README.md](../README.md) - Main documentation including health check configuration
- [k8s/README.md](../k8s/README.md) - Kubernetes-specific deployment guide
- [Docker Compose Configuration](../docker-compose.yml) - Docker Compose setup with health checks

---

[← Back to README](../README.md) | [Architecture](ARCHITECTURE.md) | [Deployment →](DEPLOYMENT.md)
