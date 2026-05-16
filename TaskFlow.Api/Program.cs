using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Extensions;

ILogger? logger = null;

try
{
    var builder = WebApplication.CreateBuilder(args);

    // Configure OpenTelemetry logging (replaces all other logging providers)
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
    var corsOrigins = CorsServiceExtensions.GetConfiguredOrigins(builder.Configuration);
    if (corsOrigins.Length > 0)
    {
        builder.Services.AddCorsPolicy(builder.Configuration);
    }

    var app = builder.Build();
    logger = app.Services.GetRequiredService<ILogger<Program>>();

    logger.LogInformation("Starting TaskFlow API");

    // Apply EF migrations
    using (var scope = app.Services.CreateScope())
    {
        var env = app.Environment;
        var shouldMigrate = env.IsDevelopment()
                            || builder.Configuration.GetValue<bool>("Database:MigrateOnStartup");

        if (shouldMigrate)
        {
            logger.LogInformation("Applying EF Core migrations on startup (Environment: {Env})", env.EnvironmentName);
            var db = scope.ServiceProvider.GetRequiredService<TaskDbContext>();

            // Ensure the directory exists for SQLite
            PersistenceServiceExtensions.EnsureSqliteDirectoryExists(db.Database.GetConnectionString(), logger);

            db.Database.Migrate();
        }
        else
        {
            logger.LogInformation("Skipping automatic migrations on startup (Environment: {Env})", env.EnvironmentName);
        }
    }

    // Enable Scalar / OpenAPI UI in Development
    if (app.Environment.IsDevelopment())
    {
        app.UseOpenApiWithScalar();
    }

    app.UseHttpLogging();
    if (corsOrigins.Length > 0)
    {
        app.UseCorsPolicy();
    }

    // Skip HTTPS redirection in containers
    if (!app.Environment.IsEnvironment("Container") &&
        string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER")))
    {
        app.UseHttpsRedirection();
    }

    app.MapControllers();

    // Map health check endpoints with custom JSON response writer and failure logging
    app.MapHealthChecks("/health", HealthCheckServiceExtensions.CreateHealthCheckOptions());
    app.MapHealthChecks("/health/ready", HealthCheckServiceExtensions.CreateReadinessHealthCheckOptions());
    app.MapHealthChecks("/health/live", HealthCheckServiceExtensions.CreateLivenessHealthCheckOptions());

    logger.LogInformation("Starting web host on port {Port}", Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS") ?? "8080");
    app.Run();
}
catch (Exception ex)
{
    // Use the DI logger if available, otherwise fall back to stderr for pre-host failures
    if (logger is not null)
    {
        logger.LogCritical(ex, "Host terminated unexpectedly");
    }
    else
    {
        Console.Error.WriteLine($"Host terminated unexpectedly: {ex}");
    }

    throw;
}
