# Portainer GitOps Deployment Design

## Context

TaskFlow currently deploys to Azure Container Instances (ACI) using Azure Container Registry (ACR). This design switches production deployment to a Docker Host using Portainer's GitOps workflow, with images hosted on GitHub Container Registry (GHCR).

**Why this change:**
- Consolidate hosting on existing Docker infrastructure
- Leverage Portainer's GitOps for declarative deployments
- Simplify CI/CD by using GitHub-native container registry

## Deployment Flow

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
Clone nevridge/taskflow-deploy repo
    │
    ▼
Update image tags in docker-compose.yml
    │
    ▼
Commit & push to taskflow-deploy
    │
    ▼
Portainer GitOps detects change
    │
    ▼
Portainer pulls new compose, deploys stack
```

## Components

### 1. New GitOps Repository: `nevridge/taskflow-deploy`

```
taskflow-deploy/
├── docker-compose.yml
├── .env.example
└── README.md
```

**docker-compose.yml:**

```yaml
services:
  taskflow-web:
    image: ghcr.io/nevridge/taskflow-web:sha-xxxxxxx
    container_name: taskflow-web
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.taskflow.rule=Host(`taskflow.skalaforge.com`)"
      - "traefik.http.routers.taskflow.entrypoints=websecure"
      - "traefik.http.routers.taskflow.tls.certresolver=letsencrypt"
      - "traefik.http.services.taskflow.loadbalancer.server.port=3000"
    environment:
      - API_TARGET=http://taskflow-api:8080
    networks:
      - traefik-public
      - default
    depends_on:
      - taskflow-api
    restart: unless-stopped

  taskflow-api:
    image: ghcr.io/nevridge/taskflow-api:sha-xxxxxxx
    container_name: taskflow-api
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.taskflow-api.rule=Host(`taskflow-api.skalaforge.com`)"
      - "traefik.http.routers.taskflow-api.entrypoints=websecure"
      - "traefik.http.routers.taskflow-api.tls.certresolver=letsencrypt"
      - "traefik.http.services.taskflow-api.loadbalancer.server.port=8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
      - ASPNETCORE_HTTP_PORTS=8080
      - Database__MigrateOnStartup=false
      - OpenTelemetry__Endpoint=http://seq:5341/ingest/otlp/v1/logs
    volumes:
      - taskflow-data:/app/data
      - taskflow-logs:/app/logs
    networks:
      - traefik-public
      - default
    depends_on:
      seq:
        condition: service_healthy
    restart: unless-stopped

  seq:
    image: datalust/seq:latest
    container_name: taskflow-seq
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.taskflow-seq.rule=Host(`taskflow-seq.skalaforge.com`)"
      - "traefik.http.routers.taskflow-seq.entrypoints=websecure"
      - "traefik.http.routers.taskflow-seq.tls.certresolver=letsencrypt"
      - "traefik.http.services.taskflow-seq.loadbalancer.server.port=80"
    environment:
      - ACCEPT_EULA=Y
    volumes:
      - seq-data:/data
    networks:
      - traefik-public
      - default
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:80"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
    restart: unless-stopped

volumes:
  taskflow-data:
  taskflow-logs:
  seq-data:

networks:
  traefik-public:
    external: true
```

### 2. GitHub Actions Workflow: `.github/workflows/ghcr-deploy.yml`

```yaml
name: Build and Deploy to Portainer

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  API_IMAGE: ghcr.io/nevridge/taskflow-api
  WEB_IMAGE: ghcr.io/nevridge/taskflow-web

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      sha_tag: ${{ steps.meta.outputs.sha_tag }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Generate tags
        id: meta
        run: echo "sha_tag=sha-${GITHUB_SHA::7}" >> $GITHUB_OUTPUT
      
      - name: Build and push API
        uses: docker/build-push-action@v5
        with:
          context: .
          file: TaskFlow.Api/Dockerfile
          push: true
          tags: |
            ${{ env.API_IMAGE }}:${{ steps.meta.outputs.sha_tag }}
            ${{ env.API_IMAGE }}:latest
          labels: |
            org.opencontainers.image.source=https://github.com/nevridge/TaskFlow
      
      - name: Build and push Web
        uses: docker/build-push-action@v5
        with:
          context: ./TaskFlow.Web
          file: TaskFlow.Web/Dockerfile
          push: true
          tags: |
            ${{ env.WEB_IMAGE }}:${{ steps.meta.outputs.sha_tag }}
            ${{ env.WEB_IMAGE }}:latest
          labels: |
            org.opencontainers.image.source=https://github.com/nevridge/TaskFlow

  update-gitops:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Checkout deploy repo
        uses: actions/checkout@v4
        with:
          repository: nevridge/taskflow-deploy
          token: ${{ secrets.DEPLOY_REPO_TOKEN }}
      
      - name: Update image tags
        run: |
          sed -i "s|ghcr.io/nevridge/taskflow-api:sha-[a-f0-9]*|ghcr.io/nevridge/taskflow-api:${{ needs.build-and-push.outputs.sha_tag }}|g" docker-compose.yml
          sed -i "s|ghcr.io/nevridge/taskflow-web:sha-[a-f0-9]*|ghcr.io/nevridge/taskflow-web:${{ needs.build-and-push.outputs.sha_tag }}|g" docker-compose.yml
      
      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docker-compose.yml
          git commit -m "deploy: taskflow ${{ needs.build-and-push.outputs.sha_tag }}"
          git push
```

### 3. Changes to TaskFlow Repository

**Archive (rename with `.disabled` suffix):**
- `.github/workflows/prod-deploy.yaml` → `prod-deploy.yaml.disabled`
- `.github/workflows/qa-deploy.yaml` → `qa-deploy.yaml.disabled`
- `.github/workflows/prod-teardown.yaml` → `prod-teardown.yaml.disabled`

**Create:**
- `.github/workflows/ghcr-deploy.yml`

**Keep unchanged:**
- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/container-scan.yml`
- `.github/workflows/dependency-review.yml`

**Update:**
- `docs/DEPLOYMENT.md` - Document new Portainer GitOps workflow
- `CLAUDE.md` - Update CI/CD section

### 4. Secrets & Authentication

**TaskFlow repo secrets (GitHub Settings → Secrets):**

| Secret | Purpose |
|--------|---------|
| `DEPLOY_REPO_TOKEN` | PAT with `repo` scope to push to taskflow-deploy |

**Portainer registry configuration:**

1. Create PAT with `read:packages` scope for GHCR access
2. In Portainer → Registries → Add registry:
   - Type: Custom
   - URL: `ghcr.io`
   - Username: `nevridge`
   - Password: PAT from step 1

**Portainer Stack configuration:**
- Repository: `https://github.com/nevridge/taskflow-deploy`
- Branch: `main`
- Compose path: `docker-compose.yml`
- GitOps updates: Polling or webhook

## Service Routing

| Subdomain | Service | Port |
|-----------|---------|------|
| `taskflow.skalaforge.com` | Web frontend | 3000 |
| `taskflow-api.skalaforge.com` | API | 8080 |
| `taskflow-seq.skalaforge.com` | Seq UI | 80 |

All routes via Traefik with Let's Encrypt TLS.

**Note:** The web frontend proxies `/api` and `/openapi` requests internally to `http://taskflow-api:8080` via Docker networking. This avoids CORS and keeps the same-origin pattern. The `taskflow-api.skalaforge.com` route provides direct API access for health checks and external integrations.

## Verification

1. **Workflow triggers:** Push to `main`, verify `ghcr-deploy` runs
2. **Images in GHCR:** Check GitHub Packages for `taskflow-api` and `taskflow-web` with `sha-xxx` tags
3. **GitOps repo updated:** Verify commit in `taskflow-deploy` with new tags
4. **Portainer deploys:** Check stack status, verify containers running
5. **Services accessible:**
   - `https://taskflow.skalaforge.com` → Web loads
   - `https://taskflow-api.skalaforge.com/health` → Returns healthy
   - `https://taskflow-seq.skalaforge.com` → Seq UI loads
6. **Rollback:** Revert tag in compose, verify Portainer redeploys previous version
