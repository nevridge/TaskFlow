# GHCR Image & Deployment Naming

> **📖 Reference Documentation** — Image naming and deployment conventions for TaskFlow. For deployment instructions, see the [Deployment Guide](DEPLOYMENT.md).

TaskFlow uses GitHub Container Registry (GHCR) to host production Docker images and Portainer GitOps to deploy them.

## Image Naming

All production images are pushed to GHCR under the `nevridge` organisation:

| Image | GHCR Path |
|-------|-----------|
| API | `ghcr.io/nevridge/taskflow-api` |
| Web | `ghcr.io/nevridge/taskflow-web` |

### Tagging Strategy

Each production build produces two tags:

| Tag | Example | Purpose |
|-----|---------|---------|
| `sha-<commit>` | `sha-a1b2c3d` | Immutable tag for this exact build |
| `latest` | `latest` | Mutable pointer to the most recent build |

The `sha-<commit>` tag is what the `nevridge/taskflow-deploy` GitOps repository pins to, ensuring rollbacks are safe and point to an exact build.

## Deployment Repository

Production configuration lives in a separate repository: [nevridge/taskflow-deploy](https://github.com/nevridge/taskflow-deploy)

The `ghcr-deploy.yml` workflow updates image tags in that repo on every push to `main`. Portainer polls for changes and redeploys the stack automatically.

## Environment Naming

| Environment | Description | Access |
|-------------|-------------|--------|
| Production | Live deployment on Docker host via Portainer | `taskflow.skalaforge.com` / `taskflow-api.skalaforge.com` |
| Development | Local Docker Compose | `http://localhost:8080` |

## Required Secrets

| Secret | Location | Purpose |
|--------|----------|---------|
| `DEPLOY_REPO_TOKEN` | TaskFlow repo Actions secrets | PAT with `Contents: write` on `nevridge/taskflow-deploy` |
| `GITHUB_TOKEN` | Automatic (GitHub Actions) | Push images to GHCR (`packages: write`) |
| Portainer registry credential | Portainer UI | PAT with `read:packages` to pull images from GHCR |

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) — Full deployment walkthrough
- [Docker Configuration](DOCKER_CONFIGURATION.md) — Docker Compose setup and configuration

---

[← Back to README](../README.md) | [Deployment Guide](DEPLOYMENT.md)
