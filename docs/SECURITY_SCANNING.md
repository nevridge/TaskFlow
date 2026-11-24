# Security Scanning

TaskFlow.Api uses automated security scanning to identify vulnerabilities in both the application code and Docker images. This document explains the security scanning setup and how to use it.

## Overview

Two complementary security scanning tools are integrated into the CI/CD pipeline:

1. **CodeQL** - Static analysis for C# code vulnerabilities
2. **Trivy** - Docker image vulnerability scanning

Both tools run automatically on every push to main, every pull request, and on a weekly schedule. Results are available in the GitHub Security tab.

## CodeQL (Code Analysis)

### What it does
CodeQL performs static analysis on the C# codebase to identify:
- Security vulnerabilities (SQL injection, XSS, etc.)
- Code quality issues
- Common programming errors
- Insecure coding patterns

### Configuration
**Workflow file**: `.github/workflows/codeql.yml`

**Triggers**:
- Push to `main` branch
- Pull requests to `main`
- Weekly schedule (Sundays at 4am UTC)

**Key features**:
- **Buildless scanning**: Uses modern CodeQL features that don't require compiling the code
- **C# 15 / .NET 11 support**: Fully supports the latest .NET features
- **Low overhead**: No build step required, making scans fast and resource-efficient

### Viewing results
1. Navigate to the repository on GitHub
2. Click the **Security** tab
3. Select **Code scanning alerts**
4. Filter by "CodeQL" to see code analysis results

### Customization
To customize CodeQL scanning, edit `.github/workflows/codeql.yml`:

```yaml
- name: Initialize CodeQL
  uses: github/codeql-action/init@v3
  with:
    languages: csharp
    build-mode: none
    # Add custom queries (optional)
    queries: security-and-quality
```

## Trivy (Docker Image Scanning)

### What it does
Trivy scans Docker images for vulnerabilities in:
- Operating system packages (base image)
- Application dependencies (.NET runtime, system libraries)
- Known CVEs (Common Vulnerabilities and Exposures)

### Configuration
**Workflow file**: `.github/workflows/security-scan.yml`

**Triggers**:
- Push to `main` branch
- Pull requests to `main`
- Weekly schedule (Sundays at 5am UTC)

**Severity levels**:
- **CRITICAL & HIGH**: Workflow fails if found (blocks deployment)
- **MEDIUM**: Included in reports but doesn't fail the build
- **LOW**: Not included in scans (reduces noise)

### Viewing results
1. Navigate to the repository on GitHub
2. Click the **Security** tab
3. Select **Code scanning alerts**
4. Filter by "trivy-docker-scan" to see Docker vulnerability results

### Scan artifacts
Trivy also uploads detailed scan results as workflow artifacts:
1. Go to the **Actions** tab
2. Select a workflow run
3. Download the `trivy-scan-results` artifact
4. View the SARIF file for detailed vulnerability information

### Customization
To customize Trivy scanning, edit `.github/workflows/security-scan.yml`:

```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@0.28.0
  with:
    image-ref: 'taskflow-api:${{ github.sha }}'
    format: 'table'
    exit-code: '1'              # Set to '0' to not fail on findings
    ignore-unfixed: true        # Ignore vulnerabilities without fixes
    vuln-type: 'os,library'     # Scan both OS and library vulnerabilities
    severity: 'CRITICAL,HIGH'   # Adjust severity levels as needed
```

## Security Workflow Best Practices

### Pull Request Scanning
Both workflows run on pull requests, providing security feedback before code is merged:
- CodeQL identifies code-level vulnerabilities
- Trivy scans the Docker image for dependency vulnerabilities
- Results appear as checks on the pull request

### Weekly Scheduled Scans
Both workflows run weekly to catch newly discovered vulnerabilities:
- New CVEs are published daily
- Regular scans ensure you're notified of new security issues
- Scheduled scans run even if no code changes occur

### Failing Builds on Critical Issues
The Trivy workflow is configured to fail on CRITICAL and HIGH severity vulnerabilities:
- Prevents insecure Docker images from being deployed
- Can be adjusted based on your risk tolerance
- Set `exit-code: '0'` if you want warnings without blocking builds

## Responding to Security Alerts

### When a CodeQL alert is created
1. Review the alert in the Security tab
2. Click on the alert for detailed information
3. Review the code path and recommended fix
4. Create a fix in a new branch
5. Test the fix thoroughly
6. Open a PR with the fix (CodeQL will rescan)
7. Dismiss the alert once fixed (provide reason)

### When a Trivy alert is created
1. Review the vulnerability details in the Security tab
2. Check if a fix is available (updated base image or package)
3. Options to resolve:
   - **Update base image**: Change the .NET SDK/runtime version in Dockerfile
   - **Update dependencies**: Update NuGet packages with vulnerabilities
   - **Accept risk**: If no fix available and risk is acceptable, document and dismiss
4. Rebuild and rescan to verify fix

### Example: Updating base image for Trivy alerts
```dockerfile
# Before
FROM mcr.microsoft.com/dotnet/aspnet:11.0.0 AS final

# After (if newer patch version is available)
FROM mcr.microsoft.com/dotnet/aspnet:11.0.1 AS final
```

## Permissions Required

Both workflows require specific GitHub Actions permissions:

### CodeQL permissions
```yaml
permissions:
  contents: read        # Read repository code
  security-events: write # Upload security results
  actions: read         # Read workflow information
```

### Trivy permissions
```yaml
permissions:
  contents: read        # Read repository code and Dockerfile
  security-events: write # Upload SARIF results to Security tab
```

These permissions are already configured in the workflow files.

## Troubleshooting

### CodeQL scan fails
**Symptom**: CodeQL workflow fails with build errors

**Solution**: Modern CodeQL for C# uses buildless scanning. If you see build-related errors, verify the workflow uses `build-mode: none`:
```yaml
- name: Initialize CodeQL
  uses: github/codeql-action/init@v3
  with:
    languages: csharp
    build-mode: none
```

### Trivy scan fails
**Symptom**: Trivy workflow fails to build Docker image

**Solution**: Verify the Dockerfile path is correct. The workflow builds from the repository root:
```bash
docker build -f TaskFlow.Api/Dockerfile -t taskflow-api:${{ github.sha }} .
```

### SARIF upload fails
**Symptom**: "Resource not accessible by integration" error

**Solution**: Ensure the workflow has `security-events: write` permission:
```yaml
permissions:
  contents: read
  security-events: write
```

### Too many false positives
**Symptom**: Trivy reports many unfixable vulnerabilities

**Solution**: Adjust the Trivy configuration:
```yaml
ignore-unfixed: true      # Ignore vulnerabilities without fixes
severity: 'CRITICAL,HIGH' # Focus on high-severity issues only
```

## Integration with CI/CD

### Existing CI workflow
The security scanning workflows complement the existing `.github/workflows/ci.yml`:
- **ci.yml**: Linting, building, and testing
- **codeql.yml**: Code security analysis
- **security-scan.yml**: Docker image vulnerability scanning

All three workflows run independently and can be viewed in the Actions tab.

### Deployment workflows
Security scanning runs before deployment:
1. Code pushed to main or PR opened
2. CI workflow (build/test) runs
3. CodeQL scans code
4. Trivy scans Docker image
5. If all pass, deployment can proceed

For production deployments (`.github/workflows/prod-deploy.yaml`), consider:
- Requiring all security checks to pass before deployment
- Adding branch protection rules to enforce security scans

## Security Scanning Metrics

Track security scanning effectiveness:
- **Alert response time**: Time from alert creation to resolution
- **Open alerts**: Number of unresolved security issues
- **False positive rate**: Dismissed alerts vs. fixed alerts
- **Vulnerability age**: How long known vulnerabilities remain unfixed

Use the GitHub Security tab to generate reports and track metrics over time.

## Further Reading

- [GitHub CodeQL documentation](https://docs.github.com/en/code-security/code-scanning)
- [Trivy documentation](https://trivy.dev/)
- [SARIF format specification](https://sarifweb.azurewebsites.net/)
- [GitHub Security best practices](https://docs.github.com/en/code-security/getting-started/securing-your-organization)

## Summary

Security scanning is now fully integrated into TaskFlow.Api:
- ✅ Automated code analysis with CodeQL
- ✅ Docker image vulnerability scanning with Trivy
- ✅ Results visible in GitHub Security tab
- ✅ Runs on every PR and push to main
- ✅ Weekly scheduled scans for new vulnerabilities
- ✅ SARIF reports uploaded for tracking and compliance

No additional setup or configuration is required - the workflows are ready to use.
