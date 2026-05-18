# QA Deployment Guide (ARCHIVED)

> **⚠️ Deprecated** — This document describes the legacy Azure Container Instances (ACI) QA deployment workflow which has been archived.
>
> TaskFlow now uses a unified **Portainer GitOps deployment pattern** for all environments. See [DEPLOY.md](DEPLOY.md) and [Deployment Guide](DEPLOYMENT.md) for current deployment information.

## Legacy Azure QA Environment

This file is retained for reference only. The ephemeral QA deployment on Azure Container Instances has been replaced with a production-style deployment using Docker and Portainer on an on-premises Docker host.

### Migration Notes

- **Previous QA Endpoint:** `http://taskflow-qa.eastus.azurecontainer.io:8080` (no longer active)
- **Current Production Endpoint:** `https://taskflow-api.skalaforge.com` and `https://taskflow.skalaforge.com`
- **Deployment Method:** Portainer GitOps with images from GitHub Container Registry (GHCR)

For current deployment procedures, refer to:
- [Deployment Guide](DEPLOYMENT.md) — Full deployment walkthrough
- [DEPLOY.md](DEPLOY.md) — Image naming and deployment naming conventions
- [Docker Configuration](DOCKER_CONFIGURATION.md) — Docker Compose setup

---

**Archive Note:** The original QA deployment used Azure's workflow_dispatch trigger to create and destroy containers automatically. This approach has been replaced with a GitOps model where all deployments are version-controlled in the `nevridge/taskflow-deploy` repository.

## Using the QA Endpoint

### For Manual Testing

The QA endpoint is always available at the same URL:
```
http://taskflow-qa.{region}.azurecontainer.io:8080
```

Example for East US region:
```
http://taskflow-qa.eastus.azurecontainer.io:8080
```

### For Postman Testing

#### Setting up Postman Environment

1. **Create a new environment** named "TaskFlow QA"
2. **Add the following variables**:
   ```
   Variable: baseUrl
   Initial Value: http://taskflow-qa.eastus.azurecontainer.io:8080
   Current Value: http://taskflow-qa.eastus.azurecontainer.io:8080
   ```

3. **Use the variable in your requests**:
   - GET `{{baseUrl}}/health`
   - GET `{{baseUrl}}/api/TaskItems`
   - POST `{{baseUrl}}/api/TaskItems`
   - PUT `{{baseUrl}}/api/TaskItems/{id}`
   - DELETE `{{baseUrl}}/api/TaskItems/{id}`

#### Importing the Shared Collection

Use the shared Postman workspace:
- **Collection URL**: https://studyplan-9664.postman.co/workspace/StudyPlan~b854a959-3425-41a8-9125-d9e7335da054/collection/102031-e46c6909-f827-46a6-affb-06cae2c01a09

Simply update the environment's `baseUrl` to point to the QA endpoint.

### For Automated Testing

#### JavaScript/Node.js Example

```javascript
// config/qa.js
module.exports = {
  baseUrl: 'http://taskflow-qa.eastus.azurecontainer.io:8080',
  timeout: 5000
};

// tests/integration/health.test.js
const config = require('../../config/qa');
const axios = require('axios');

describe('QA Health Checks', () => {
  test('Health endpoint should return 200', async () => {
    const response = await axios.get(`${config.baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('Healthy');
  });
  
  test('API should list task items', async () => {
    const response = await axios.get(`${config.baseUrl}/api/TaskItems`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);
  });
});
```

#### Python Example

```python
# config.py
QA_BASE_URL = 'http://taskflow-qa.eastus.azurecontainer.io:8080'
TIMEOUT = 5

# tests/test_qa_health.py
import requests
from config import QA_BASE_URL, TIMEOUT

def test_health_endpoint():
    """Test that the QA health endpoint returns 200"""
    response = requests.get(f'{QA_BASE_URL}/health', timeout=TIMEOUT)
    assert response.status_code == 200
    assert response.json()['status'] == 'Healthy'

def test_task_items_list():
    """Test that the task items endpoint is accessible"""
    response = requests.get(f'{QA_BASE_URL}/api/TaskItems', timeout=TIMEOUT)
    assert response.status_code == 200
    assert isinstance(response.json(), list)
```

#### Bash/Shell Script Example

```bash
#!/bin/bash
# qa-smoke-test.sh

QA_URL="http://taskflow-qa.eastus.azurecontainer.io:8080"

echo "Running QA smoke tests..."

# Test health endpoint
echo "Testing health endpoint..."
if curl -f -s "$QA_URL/health" | grep -q "Healthy"; then
  echo "✓ Health check passed"
else
  echo "✗ Health check failed"
  exit 1
fi

# Test API endpoint
echo "Testing task items endpoint..."
if curl -f -s "$QA_URL/api/TaskItems" > /dev/null; then
  echo "✓ API endpoint accessible"
else
  echo "✗ API endpoint failed"
  exit 1
fi

echo "All QA smoke tests passed!"
```

#### GitHub Actions Integration

```yaml
# .github/workflows/qa-tests.yml
name: QA Integration Tests

on:
  workflow_run:
    workflows: ["Ephemeral ACI deploy - create test teardown"]
    types:
      - completed

jobs:
  test-qa-deployment:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run QA integration tests
        env:
          QA_BASE_URL: http://taskflow-qa.eastus.azurecontainer.io:8080
        run: npm test -- --testPathPattern=qa
```

## Regional DNS Variations

The DNS name varies by Azure region. Common regions:

| Region | Full DNS Name |
|--------|---------------|
| East US | `taskflow-qa.eastus.azurecontainer.io` |
| West US | `taskflow-qa.westus.azurecontainer.io` |
| West US 2 | `taskflow-qa.westus2.azurecontainer.io` |
| Central US | `taskflow-qa.centralus.azurecontainer.io` |
| North Europe | `taskflow-qa.northeurope.azurecontainer.io` |
| West Europe | `taskflow-qa.westeurope.azurecontainer.io` |
| UK South | `taskflow-qa.uksouth.azurecontainer.io` |
| Southeast Asia | `taskflow-qa.southeastasia.azurecontainer.io` |
| East Asia | `taskflow-qa.eastasia.azurecontainer.io` |

**Important**: Update your test configurations if you change the deployment region in the workflow parameters.

## Troubleshooting

### QA Endpoint Not Accessible

**Symptoms**: 
- Connection timeout when accessing the QA URL
- DNS resolution fails

**Solutions**:
1. Verify the container is running:
   ```bash
   az container show -g nevridge-taskflow-qa-rg -n nevridge-taskflow-qa-aci --query provisioningState -o tsv
   ```

2. Check the FQDN:
   ```bash
   az container show -g nevridge-taskflow-qa-rg -n nevridge-taskflow-qa-aci --query ipAddress.fqdn -o tsv
   ```

3. View container logs:
   ```bash
   az container logs -g nevridge-taskflow-qa-rg -n nevridge-taskflow-qa-aci
   ```

4. Check the workflow run logs in GitHub Actions for deployment errors

### DNS Conflict Errors

**Symptoms**:
- Workflow fails with "DNS name label already in use"
- Container creation fails

**Solutions**:
The workflow should automatically handle this, but if it doesn't:

1. Manually delete the existing container:
   ```bash
   az container delete -g nevridge-taskflow-qa-rg -n nevridge-taskflow-qa-aci --yes
   ```

2. Wait a few seconds for Azure to release the DNS name

3. Re-run the deployment workflow

### Health Check Failures

**Symptoms**:
- Deployment completes but health check fails
- HTTP 503 or timeout errors

**Solutions**:
1. Check container logs for application errors:
   ```bash
   az container logs -g nevridge-taskflow-qa-rg -n nevridge-taskflow-qa-aci --tail 100
   ```

2. Verify the container is running:
   ```bash
   az container show -g nevridge-taskflow-qa-rg -n nevridge-taskflow-qa-aci --query instanceView.state -o tsv
   ```

3. Check if database migrations completed successfully

4. Increase the health check wait time in the workflow if needed

### Slow Deployment

**Symptoms**:
- Deployment takes longer than expected
- Container takes a long time to become ready

**Causes**:
- Docker image build time
- Image pull time from ACR
- Database migration execution
- Azure resource provisioning delays

**Solutions**:
- Use a smaller base image if possible
- Pre-build and cache images in ACR
- Monitor the workflow logs to identify which step is slow

## Best Practices

1. **Test After Deployment**: Always verify the QA endpoint after deployment before running extensive tests
2. **Use Environment Variables**: Store the QA base URL in environment variables for easy configuration
3. **Implement Retry Logic**: Add retry logic to tests to handle transient network issues
4. **Monitor Health Endpoint**: Regularly check the health endpoint to ensure QA is available
5. **Coordinate Deployments**: Communicate with team members before deploying to avoid conflicts during testing
6. **Clean Up Resources**: Use the teardown action to remove resources when QA testing is complete
7. **Document Region**: Clearly document which Azure region your QA environment uses

## Security Considerations

1. **No Authentication**: The QA endpoint is publicly accessible without authentication
2. **Temporary Data**: Data in QA is not persistent across deployments
3. **Non-Production**: QA should use test data only, never production data
4. **Network Security**: Consider adding Azure Network Security Groups for IP allowlisting if needed
5. **Container Credentials**: ACR credentials are managed by the workflow and not exposed

## Cost Management

### Estimated Costs (East US region)
- **Azure Container Instances**: ~$0.0000126 per vCPU-second + ~$0.0000014 per GB-second
- **Azure Container Registry (Basic)**: ~$5/month (shared with production)
- **Estimated QA Runtime Cost**: ~$0.05-0.10 per hour

### Cost Optimization Tips
1. Use the teardown action to delete resources when not actively testing
2. Share the ACR with production to avoid duplicate registry costs
3. Use the same resource group for ephemeral resources
4. Consider using spot instances for longer-running QA environments
5. Monitor your Azure consumption regularly

## Workflow Modifications

### Changing the DNS Name

To use a different DNS name (e.g., `taskflow-staging`):

1. Edit `.github/workflows/qa-deploy.yaml`
2. Update the `ENV` variable at the top:
   ```yaml
   env:
     ORG_NAME: nevridge
     APP_NAME: taskflow
     ENV: staging  # Changed from 'qa' to 'staging'
   ```
3. The workflow will automatically compute:
   - ACI Name: `nevridge-taskflow-staging-aci`
   - DNS Label: `taskflow-staging`
4. Update documentation references
5. Update test configurations

See [DEPLOY.md](DEPLOY.md) for details on the naming convention.

### Deploying to Multiple Regions

To support multiple QA environments in different regions:

1. Create separate workflow files or add region parameters
2. Use distinct DNS name labels per region (e.g., `taskflow-qa-us`, `taskflow-qa-eu`)
3. Update test configurations to support multiple environments
4. Document each environment's endpoint

### Enabling HTTPS

To enable HTTPS for the QA endpoint:

1. Configure Azure Application Gateway or Azure Front Door
2. Add a custom domain with SSL certificate
3. Update the workflow to configure HTTPS settings
4. Update test configurations to use `https://` URLs

## Related Documentation

- [Main README](../README.md) - General project documentation
- [Deployment Guide](DEPLOYMENT.md) - Comprehensive deployment guide
- [Volume Configuration](VOLUMES.md) - Docker volume and persistence setup
- [Volume Testing Guide](VOLUME_TESTING.md) - Testing volume persistence
- [GitHub Workflows](../.github/workflows/) - All CI/CD workflows

## Support

For issues or questions:
1. Check the workflow run logs in GitHub Actions
2. Review Azure resource status in the Azure Portal
3. Check container logs with Azure CLI
4. Open an issue in the GitHub repository
