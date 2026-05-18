# Logging Guide

## Overview

TaskFlow.Api uses **OpenTelemetry** for structured logging, exporting logs via OTLP to a configured backend (e.g. Seq). In Development, logs are also written to the console. There is no file-based log sink.

## Log Configuration

### Log Levels

Default configuration:
- Application code: **Information** level
- Microsoft framework: **Warning** level (reduced noise)

Configure in `appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft": "Warning",
      "Microsoft.Hosting.Lifetime": "Information"
    }
  }
}
```

### OTLP Exporter Settings

Configure the OpenTelemetry exporter in `appsettings.json` or via environment variables:

| Setting | Environment Variable | Default |
|---------|---------------------|---------|
| Service name | `OpenTelemetry__ServiceName` | `TaskFlow.Api` |
| OTLP endpoint | `OpenTelemetry__Endpoint` | `http://localhost:5341/ingest/otlp` |
| Auth header | `OpenTelemetry__Header` | *(none)* |
| Protocol | `OpenTelemetry__Protocol` | `http/protobuf` |

## Health Check Failure Logging

Health check failures are automatically logged for troubleshooting.

### Log Levels

- **Unhealthy** (HTTP 503): Error level
- **Degraded** (HTTP 200): Warning level
- **Healthy** (HTTP 200): Not logged

### Log Format

**Unhealthy:**
```
[Error] Health check FAILED at /health - Status: Unhealthy, Duration: 5032.12ms, Failed checks: [{"Name":"database","Description":"Database connection failed","Duration":5000.57,"Exception":"Unable to connect to database"}]
```

**Degraded:**
```
[Warning] Health check DEGRADED at /health/ready - Status: Degraded, Duration: 156.34ms, Degraded checks: [{"Name":"database","Description":"High response time","Duration":150.12}]
```

# Docker
docker logs <container-name> | grep "Health check FAILED"
```

### Troubleshooting Common Issues

#### Database Connection Failure

**Log:**
```
[Error] Health check FAILED at /health/ready - Status: Unhealthy, Duration: 5032ms, Failed checks: [{"Name":"database",...}]
```

**Steps:**
1. Verify database service is running
2. Check connection string in `appsettings.json`
3. Ensure migrations completed (if `Database:MigrateOnStartup=true`)

#### Application Deadlock

**Log:**
```
[Error] Health check FAILED at /health/live - Status: Unhealthy, Duration: 30000ms, Failed checks: [{"Name":"self",...}]
```

**Steps:**
1. Check application logs for threading issues
2. Restart the application/container
3. Review recent code changes

#### Degraded Performance

**Log:**
```
[Warning] Health check DEGRADED at /health - Status: Degraded, Duration: 3456ms, Degraded checks: [{"Name":"database",...}]
```

**Steps:**
1. Check database query performance
2. Monitor resource usage (CPU, memory)
3. Review recent schema changes

### Health Check Endpoints

| Endpoint | Checks | Use Case |
|----------|--------|----------|
| `/health` | Database + Self-check | General monitoring |
| `/health/ready` | Database only | Readiness probe |
| `/health/live` | Self-check only | Liveness probe |

### Monitoring and Alerting

All logs are exported via OTLP and can be directed to any compatible backend by changing the `OpenTelemetry__Endpoint` setting:

- **Seq**: Default configuration targets `http://localhost:5341/ingest/otlp`
- **Grafana / Loki**: Point the endpoint at your Loki OTLP receiver
- **Any OTLP-compatible backend**: Configure the endpoint in your environment

Configure alerts for health check failures by filtering on "Health check FAILED" log messages in your chosen backend.

## Application Log Events

Common log events in TaskFlow.Api:

**Startup:**
```
[Information] Starting TaskFlow API
[Information] Applying EF Core migrations on startup
[Information] Starting web host on port "8080"
```

**Errors:**
```
[Error] An unhandled exception occurred while processing the request
[Fatal] Host terminated unexpectedly
```

## Troubleshooting

### Logs Not Appearing in Backend

If logs are not arriving at your OTLP backend:

1. Verify the `OpenTelemetry__Endpoint` setting is correct
2. Check that the backend is running and reachable from the container
3. Confirm the auth header (`OpenTelemetry__Header`) is set if required
4. In Development, check the console output — logs always appear there regardless of OTLP connectivity
