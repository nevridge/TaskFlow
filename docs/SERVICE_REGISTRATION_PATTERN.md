# Service Registration Extension Pattern

## Overview

TaskFlow.Api uses the **ServiceCollection Extension Pattern** to organize and manage dependency injection service registrations. This pattern keeps `Program.cs` clean and maintainable by grouping related service configurations into dedicated extension methods.

## Benefits

- **Maintainability**: Service registrations are organized by logical groupings (persistence, validation, etc.)
- **Readability**: `Program.cs` remains concise and easy to understand
- **Testability**: Extension methods can be unit tested independently
- **Reusability**: Extension methods can be easily shared across projects
- **Discoverability**: Developers can quickly find where specific services are registered

## Architecture

All service registration extensions are located in the `TaskFlow.Api.Extensions` namespace under the `Extensions` folder. Each extension class focuses on a specific aspect of the application.

### Extension Classes

| Extension Class | Purpose | Key Services Registered |
|----------------|---------|------------------------|
| `PersistenceServiceExtensions` | Database and data access | `TaskDbContext`, `ITaskRepository`, repository interfaces |
| `ValidationServiceExtensions` | Input validation | FluentValidation validators |
| `HealthCheckServiceExtensions` | Health monitoring | Database and self health checks |
| `ApiVersioningServiceExtensions` | API versioning | Versioning middleware and API explorer |
| `OpenApiServiceExtensions` | API documentation | OpenAPI/Scalar services |
| `OpenTelemetryServiceExtensions` | Observability | OpenTelemetry tracing, metrics, and logging |
| `JsonConfigurationExtensions` | JSON serialization | JSON serializer options |

## Usage in Program.cs

The current `Program.cs` demonstrates the pattern:

```csharp
using TaskFlow.Api.Extensions;

var builder = WebApplication.CreateBuilder(args);

// Configure OpenTelemetry logging
builder.Logging.AddApplicationLogging(builder.Configuration, builder.Environment);

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddApiVersioningConfiguration();
OpenApiServiceExtensions.AddOpenApi(builder.Services);
builder.Services.AddPersistence(builder.Configuration);
builder.Services.AddValidation();
builder.Services.AddApplicationHealthChecks();
builder.Services.AddOpenTelemetryObservability(builder.Configuration);
builder.Services.ConfigureJsonSerialization();

var app = builder.Build();

// Enable Scalar / OpenAPI UI in Development
if (app.Environment.IsDevelopment())
{
    app.UseOpenApiWithScalar();
}

app.UseHttpLogging();
app.UseAuthorization();
app.MapControllers();
// ... health check endpoint mapping ...
```

## Creating New Extension Methods

### Step 1: Create the Extension Class

Create a new file in the `Extensions` folder:

```csharp
namespace TaskFlow.Api.Extensions;

/// <summary>
/// Extension methods for configuring [feature name] services
/// </summary>
public static class [Feature]ServiceExtensions
{
    /// <summary>
    /// Adds [feature] services to the service collection
    /// </summary>
    /// <param name="services">The service collection</param>
    /// <returns>The service collection for chaining</returns>
    public static IServiceCollection Add[Feature](this IServiceCollection services)
    {
        // Register your services here
        services.AddScoped<IYourService, YourService>();
        
        return services;
    }
}
```

### Step 2: Follow Naming Conventions

- **Class Name**: `[Feature]ServiceExtensions`
  - Examples: `CachingServiceExtensions`, `AuthenticationServiceExtensions`
- **Method Name**: `Add[Feature]`
  - Examples: `AddCaching`, `AddAuthentication`
- **Return Type**: Always return `IServiceCollection` for method chaining

### Step 3: Add XML Documentation

Document your extension methods with XML comments:

```csharp
/// <summary>
/// Adds caching services to the service collection
/// </summary>
/// <param name="services">The service collection</param>
/// <param name="configuration">The configuration instance</param>
/// <returns>The service collection for chaining</returns>
public static IServiceCollection AddCaching(
    this IServiceCollection services, 
    IConfiguration configuration)
{
    // Implementation
}
```

### Step 4: Register in Program.cs

Add your extension method call in `Program.cs`:

```csharp
builder.Services.AddCaching(builder.Configuration);
```

### Step 5: Write Tests

Create integration tests to verify your registration:

```csharp
[Fact]
public void AddCaching_ShouldRegisterCachingServices()
{
    // Arrange
    var services = new ServiceCollection();
    var configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            { "Caching:Enabled", "true" }
        })
        .Build();

    // Act
    services.AddCaching(configuration);
    var serviceProvider = services.BuildServiceProvider();

    // Assert
    serviceProvider.GetService<IMemoryCache>().Should().NotBeNull();
}
```

## Best Practices

### 1. Single Responsibility

Each extension class should handle one logical grouping of services:

```csharp
// ✅ Good: Focused on persistence
public static IServiceCollection AddPersistence(...)
{
    services.AddDbContext<TaskDbContext>(...);
    services.AddScoped<ITaskRepository, TaskRepository>();
    return services;
}

// ❌ Bad: Mixing concerns
public static IServiceCollection AddAllServices(...)
{
    services.AddDbContext<TaskDbContext>(...);
    services.AddSwaggerGen(...);
    services.AddAuthentication(...);
    return services;
}
```

### 2. Configuration Dependencies

Pass `IConfiguration` when your services need configuration:

```csharp
public static IServiceCollection AddPersistence(
    this IServiceCollection services, 
    IConfiguration configuration)
{
    var connectionString = configuration.GetConnectionString("DefaultConnection");
    services.AddDbContext<TaskDbContext>(options =>
        options.UseSqlite(connectionString));
    return services;
}
```

### 3. Method Chaining

Always return `IServiceCollection` to enable fluent configuration:

```csharp
builder.Services
    .AddPersistence(builder.Configuration)
    .AddValidation();
```

### 4. Dependency Order

Be mindful of service dependencies. Register dependencies first:

```csharp
// ✅ Good: Dependencies registered in the correct order
builder.Services.AddPersistence(builder.Configuration);  // Registers repositories
builder.Services.AddValidation();                        // Registers validators

// ❌ Bad: Service registered before its dependency
builder.Services.AddValidation();
builder.Services.AddPersistence(builder.Configuration);  // Repositories registered too late
```

### 5. Avoid Overloading

Keep extension methods simple. If you need variations, create separate methods:

```csharp
// ✅ Good: Separate methods for different scenarios
public static IServiceCollection AddPersistence(
    this IServiceCollection services, 
    IConfiguration configuration)
{
    // Standard SQLite configuration
}

public static IServiceCollection AddPersistenceWithSqlServer(
    this IServiceCollection services, 
    string connectionString)
{
    // SQL Server configuration
}

// ❌ Bad: Complex overloads
public static IServiceCollection AddPersistence(
    this IServiceCollection services, 
    IConfiguration? configuration = null,
    string? connectionString = null,
    DatabaseType dbType = DatabaseType.SQLite,
    bool enableLogging = false)
{
    // Too many parameters and branches
}
```

### 6. Logging Registration Events

Consider logging important registration events, especially for configuration-dependent services:

```csharp
public static IServiceCollection AddPersistence(
    this IServiceCollection services, 
    IConfiguration configuration)
{
    var connectionString = configuration.GetConnectionString("DefaultConnection")
                           ?? "Data Source=/app/data/tasks.db";
    
    Log.Information("Using connection string: {ConnectionString}", connectionString);
    
    services.AddDbContext<TaskDbContext>(options =>
        options.UseSqlite(connectionString));
    
    return services;
}
```

## Testing Service Registrations

Integration tests verify that services are correctly registered and can be resolved:

```csharp
public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void AddPersistence_ShouldRegisterDbContextAndRepositories()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ConnectionStrings:DefaultConnection", "Data Source=:memory:" }
            })
            .Build();

        // Act
        services.AddPersistence(configuration);
        var serviceProvider = services.BuildServiceProvider();

        // Assert
        serviceProvider.GetService<TaskDbContext>().Should().NotBeNull();
        serviceProvider.GetService<ITaskRepository>().Should().NotBeNull();
    }
}
```

Test files are located in `TaskFlow.Api.Tests/Extensions/`.

## Common Patterns

### Pattern 1: Configuration-Driven Registration

```csharp
public static IServiceCollection AddFeature(
    this IServiceCollection services, 
    IConfiguration configuration)
{
    var settings = configuration.GetSection("Feature").Get<FeatureSettings>();
    
    if (settings?.Enabled == true)
    {
        services.AddScoped<IFeatureService, FeatureService>();
    }
    
    return services;
}
```

### Pattern 2: OpenAPI Documentation

```csharp
public static class OpenApiServiceExtensions
{
    public static IServiceCollection AddOpenApi(
        this IServiceCollection services)
    {
        services.AddOpenApi("v1", options =>
        {
            options.AddDocumentTransformer<ApiVersionDocumentTransformer>();
        });

        return services;
    }
}
```

### Pattern 3: Logging Builder Configuration

For services that need to configure the logging builder:

```csharp
public static class OpenTelemetryServiceExtensions
{
    public static ILoggingBuilder AddApplicationLogging(
        this ILoggingBuilder logging,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        logging.ClearProviders();
        logging.AddOpenTelemetry(otlp => { /* OTLP config */ });
        if (environment.IsDevelopment())
            logging.AddConsole();
        return logging;
    }
}

// Usage:
builder.Logging.AddApplicationLogging(builder.Configuration, builder.Environment);
```

## Migration Guide

If you need to add new service registrations to the application:

1. **Identify the logical group**: Determine if the service belongs to an existing category (persistence, validation, etc.)
2. **Add to existing extension**: If the service fits an existing category, add it to that extension class
3. **Create new extension**: If it's a new category, create a new extension class following the naming conventions
4. **Update Program.cs**: Add the extension method call in the appropriate location
5. **Write tests**: Add integration tests to verify the registration
6. **Document**: Update this guide if introducing a new pattern

## Troubleshooting

### Service Not Found Exception

**Problem**: `InvalidOperationException: Unable to resolve service for type 'X'`

**Solution**: Ensure dependencies are registered in the correct order:

```csharp
// Register dependencies first
builder.Services.AddPersistence(builder.Configuration);  // Registers repositories
builder.Services.AddValidation();                        // Registers validators
```

### Configuration Not Found

**Problem**: Configuration values are null or not being read

**Solution**: Verify configuration is passed to extension methods and keys match `appsettings.json`:

```csharp
services.AddPersistence(builder.Configuration); // Pass configuration

// In appsettings.json:
{
  "ConnectionStrings": {
    "DefaultConnection": "Data Source=/app/data/tasks.db"
  }
}
```

### Circular Dependencies

**Problem**: Circular dependency detected between services

**Solution**: Review service dependencies and consider:
- Using factory patterns
- Introducing an intermediary service
- Breaking up large services into smaller ones

## Additional Resources

- [ASP.NET Core Dependency Injection Documentation](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection)
- [Extension Methods (C# Programming Guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods)
- [ServiceCollection Class Documentation](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.dependencyinjection.servicecollection)

## Summary

The Service Registration Extension Pattern provides a clean, organized approach to managing dependency injection in ASP.NET Core applications. By following these guidelines and conventions, you can maintain a well-structured codebase that's easy to understand, test, and extend.
