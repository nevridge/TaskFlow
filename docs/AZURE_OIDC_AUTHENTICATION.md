# Azure OIDC Authentication Setup (ARCHIVED)

> **⚠️ Deprecated** — This document describes the legacy Azure authentication setup which has been archived.
>
> TaskFlow now deploys to on-premises infrastructure using Docker and Portainer GitOps. GitHub Actions workflows use the automatic `GITHUB_TOKEN` environment variable to push images to GitHub Container Registry (GHCR).

## Legacy Azure Authentication

This file is retained for reference only. The Azure OIDC authentication workflow has been replaced with a simpler GitHub Actions approach that uses GHCR for image hosting.

### What Changed

- **Previous:** GitHub Actions authenticated to Azure using OIDC with federated credentials
- **Current:** GitHub Actions use the automatic `GITHUB_TOKEN` to push images to GHCR; no Azure authentication needed

### Migration Notes

- **Removed:** Azure service principals, Azure CLI commands, Azure OIDC federated credentials
- **Removed:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` GitHub secrets
- **Added:** `DEPLOY_REPO_TOKEN` GitHub secret for updating the `nevridge/taskflow-deploy` repository
- **Deployment Method:** Portainer GitOps with images from GitHub Container Registry (GHCR)

### Current Authentication Flow

```
Push to main (TaskFlow repo)
    ↓
GitHub Actions builds images
    ↓
Push to GHCR (using automatic GITHUB_TOKEN)
    ↓
Update taskflow-deploy repo (using DEPLOY_REPO_TOKEN)
    ↓
Portainer detects change and deploys
```

For current deployment procedures, refer to:
- [DEPLOY.md](DEPLOY.md) — Image naming and deployment conventions
- [Deployment Guide](DEPLOYMENT.md) — Full deployment walkthrough
- [Docker Configuration](DOCKER_CONFIGURATION.md) — Docker Compose setup

---

## Legacy Azure OIDC Instructions (ARCHIVED)

> **⚠️ Do not follow these instructions.** Azure OIDC authentication is no longer used. The sections below are retained for historical reference only.

The following sections describe how the legacy Azure OIDC authentication workflow was configured. These instructions should not be used for any new deployments.

For current GitHub Actions authentication procedures, see [DEPLOY.md](DEPLOY.md) which covers the current GITHUB_TOKEN and DEPLOY_REPO_TOKEN setup.

---

### Legacy: Azure Service Principal Setup

*This section is archived. Azure authentication is no longer needed.*

The Azure OIDC setup previously required:
- Azure service principals
- Azure CLI commands
- Azure OIDC federated credentials
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` GitHub secrets (now removed)
