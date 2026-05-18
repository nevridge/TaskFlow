# API Versioning

This document explains the API versioning strategy implemented in TaskFlow.Api, following Microsoft's official recommendations and industry best practices.

## Overview

TaskFlow.Api uses **URL path versioning** to manage multiple API versions. This approach provides:

- **Clear versioning** - Version is explicitly visible in the URL
- **Easy migration** - Clients can upgrade at their own pace
- **Backward compatibility** - Multiple versions coexist without breaking existing clients
- **Standard compliance** - Follows Microsoft and REST API best practices

## Implementation

### Technology Stack

- **Asp.Versioning.Mvc** (v8.1.0) - Core versioning functionality
- **Asp.Versioning.Mvc.ApiExplorer** (v8.1.0) - API Explorer integration for Swagger/OpenAPI

### Configuration

API versioning is configured in `ApiVersioningServiceExtensions.cs`:

```csharp
services.AddApiVersioning(options =>
{
    // Default version when client doesn't specify
    options.DefaultApiVersion = new ApiVersion(1, 0);
    
    // Assume default version when not specified
    options.AssumeDefaultVersionWhenUnspecified = true;
    
    // Return supported versions in response headers
    options.ReportApiVersions = true;
    
    // Support URL segment and header versioning
    options.ApiVersionReader = ApiVersionReader.Combine(
        new UrlSegmentApiVersionReader(),
        new HeaderApiVersionReader("x-api-version")
    );
})
.AddApiExplorer(options =>
{
    options.GroupNameFormat = "'v'VVV";
    options.SubstituteApiVersionInUrl = true;
});
```

## Versioning Strategy

### URL Path Versioning (Primary)

The recommended approach for API consumers:

```
GET /api/v1/TaskItems
GET /api/v2/TaskItems
```

**Advantages:**
- Intuitive and discoverable
- Easy to test and debug
- Clear in documentation
- Works with all HTTP clients

### Header Versioning (Fallback)

Alternative method using custom header:

```bash
curl -H "x-api-version: 1.0" http://localhost:8080/api/TaskItems
```

**Use cases:**
- When URL structure must remain constant
- For advanced API consumers
- Testing different versions

## Available Versions

### Version 1.0

Current version with core functionality. For detailed endpoint documentation, see [API Reference](API.md).

**Endpoints:** `/api/v1/TaskItems` with full CRUD operations (GET, POST, PUT, DELETE)

**Note:** The versioning infrastructure is in place to support future API versions. When new versions are needed, they can be added by creating new controllers with the `[ApiVersion("X.0")]` attribute.

## Usage Examples

### URL Path Versioning

```bash
GET /api/v1/TaskItems
POST /api/v1/TaskItems
```

### Header Versioning

```bash
curl -H "x-api-version: 1.0" http://localhost:8080/api/TaskItems
```

For complete usage examples and request/response formats, see [API Reference](API.md).

## API Version Discovery

### Response Headers

All API responses include version information headers:

```
api-supported-versions: 1.0
```

This header lists all supported API versions, helping clients discover available versions.

### OpenAPI Documentation (Scalar UI)

Scalar UI automatically documents all API versions:

- **V1 Documentation:** Access Scalar UI at `/scalar/v1`
- Additional versions will appear as they are added

Access Scalar UI at: `http://localhost:{port}/scalar/v1` (in Development mode)

## Adding New Versions

When you need to add a new API version:

1. **Create a new versioned controller** in a new namespace (e.g., `Controllers/V2/`)
2. **Add the ApiVersion attribute**: `[ApiVersion("2.0")]`
3. **Use versioned route**: `[Route("api/v{version:apiVersion}/[controller]")]`
4. **Update route names** to avoid conflicts (e.g., `"GetTaskV2"` instead of `"GetTask"`)
5. **Update tests** to cover the new version

**Example:**
```csharp
namespace TaskFlow.Api.Controllers.V2;

[ApiController]
[ApiVersion("2.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class TaskItemsController : ControllerBase
{
    // Implement V2 endpoints
}
```

### Handling Multiple Versions

**Best practices:**
1. Keep existing versions stable - don't modify them
2. Add new versions for breaking changes
3. Clearly document what changed between versions
4. Deprecate old versions with adequate notice
5. Monitor usage to understand migration patterns

## Best Practices

**For API Consumers:**
- Always specify version explicitly (`/api/v1/`)
- Check `api-supported-versions` header for available versions
- Design clients to ignore unknown fields for forward compatibility

**For API Maintainers:**
- No breaking changes in minor versions
- Announce deprecation at least 6 months in advance using `[ApiVersion("1.0", Deprecated = true)]`
- Maintain at least two versions during transitions

## Technical Architecture

### Controller Organization

```
Controllers/
└── V1/
    ├── TaskItemsController.cs  # Version 1.0 (/api/v1/TaskItems)
    └── StatusController.cs     # Version 1.0 (/api/v1/Status)
```

Future versions can be added in new namespaces (e.g., `V2/`, `V3/`).

### Version Attributes

```csharp
[ApiVersion("1.0")]                    // Declares controller supports v1.0
[ApiVersion("2.0")]                    // Declares controller supports v2.0
[Route("api/v{version:apiVersion}/[controller]")]  // Versioned URL template
```

### OpenAPI / Scalar Integration

Scalar UI is automatically configured to:
- Generate separate documentation for each API version
- Group endpoints by version
- Show version-specific schemas
- Provide a version selector

## Testing

Version-specific tests: `TaskFlow.Api.Tests/Controllers/V1/TaskItemsControllerV1Tests.cs`

Test both URL versioning (`/api/v1/TaskItems`) and header versioning (`x-api-version: 1.0`).

## Troubleshooting

**"Unsupported API version" error:** Check `api-supported-versions` header or Scalar UI docs. Currently only v1.0 is supported.

## References

- [Microsoft API Versioning GitHub](https://github.com/dotnet/aspnet-api-versioning)
- [Microsoft Learn: API Versioning](https://learn.microsoft.com/en-us/aspnet/core/web-api/advanced/versioning)
- [RESTful API Design Guidelines](https://restfulapi.net/versioning/)
- [Semantic Versioning](https://semver.org/)

## Summary

TaskFlow.Api implements robust API versioning using Microsoft's recommended practices:

✅ URL path versioning as primary method  
✅ Header versioning as fallback  
✅ Infrastructure ready for multiple versions  
✅ Clear documentation for versioning strategy  
✅ Easy path to add new versions

This approach provides the foundation for API evolution without disrupting existing consumers. Currently, version 1.0 is available, and the infrastructure is in place to add additional versions as needed.

---

*Last updated: 2025-07-01*
