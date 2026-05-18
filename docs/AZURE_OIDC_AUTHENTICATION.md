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

**Archive Note:** The original Azure OIDC setup enabled GitHub Actions to authenticate directly to Azure services without storing credentials. This approach was used when deployments targeted Azure App Service and Container Instances. The current on-premises deployment model simplifies authentication by using GitHub's built-in GITHUB_TOKEN for GHCR and a simple PAT for the GitOps repository.

- `AZURE_CLIENT_ID` - The `appId` from step 1
- `AZURE_TENANT_ID` - The `tenant` from step 1
- `AZURE_SUBSCRIPTION_ID` - Run `az account show --query id -o tsv`

### 4. Configure GitHub Environments

Create GitHub Environments that match the federated credential subjects. In GitHub repository **Settings → Environments**, create:

- `qa` - For QA deployments
- `production` - For production deployments

**Important**: The environment names must exactly match the subjects configured in step 2:
- QA subject: `repo:nevridge/TaskFlow.Api:environment:qa`
- Production subject: `repo:nevridge/TaskFlow.Api:environment:production`

The workflows reference these environments:
- `.github/workflows/qa-deploy.yaml` uses `environment: qa`
- `.github/workflows/prod-deploy.yaml` uses `environment: production`
- `.github/workflows/prod-teardown.yaml` uses `environment: production`

### 5. Verify Workflows

The workflows in this repository already have the correct configuration:
- `permissions.id-token: write` is set (required for OIDC)
- `azure/login@v2` uses individual parameters (not JSON creds)
- Each workflow specifies the appropriate `environment` that matches the federated credential subject

## Common Issues

**"AADSTS70021: No matching federated identity record found"**
- Verify the subject claim matches your repository name exactly
- Check federated credentials: `az ad app federated-credential list --id $(az ad app list --display-name "TaskFlowGitHubActions" --query "[0].appId" -o tsv)`

**"ClientAuthenticationFailed"**
- Ensure workflow has `permissions.id-token: write`

**"The subscription ... could not be found"**
- Verify service principal has Contributor role: `az role assignment list --assignee $(az ad app list --display-name "TaskFlowGitHubActions" --query "[0].appId" -o tsv)`

## Additional Resources

- [GitHub Docs - OIDC in Azure](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-azure)
- [Azure Workload Identity Federation](https://learn.microsoft.com/en-us/azure/active-directory/develop/workload-identity-federation)
