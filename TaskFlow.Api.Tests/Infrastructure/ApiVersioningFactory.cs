using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace TaskFlow.Api.Tests.Infrastructure;

/// <summary>
/// Hosts the real TaskFlow.Api in-process on a unique temporary SQLite file, never on live data.
/// Copied (and trimmed) from TaskFlow.Mcp.Integration.Tests/Infrastructure/TaskFlowApiFactory.cs.
/// </summary>
public class ApiVersioningFactory : WebApplicationFactory<Program>
{
    private readonly string _environment;

    public ApiVersioningFactory()
        : this("Testing")
    {
    }

    protected ApiVersioningFactory(string environment)
    {
        _environment = environment;
        TempDirectory = Path.Combine(Path.GetTempPath(), "taskflow-api-it-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(TempDirectory);
        DatabasePath = Path.Combine(TempDirectory, "tasks.db");
    }

    public string TempDirectory { get; }

    public string DatabasePath { get; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(_environment);
        builder.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={DatabasePath};Pooling=False");
        builder.UseSetting("Database:MigrateOnStartup", "true");
        // Unreachable on purpose, and an empty header neutralises the Seq key committed in appsettings.json.
        builder.UseSetting("OpenTelemetry:Endpoint", "http://127.0.0.1:1/ingest/otlp");
        builder.UseSetting("OpenTelemetry:Header", string.Empty);
    }

    public override async ValueTask DisposeAsync()
    {
        try
        {
            await base.DisposeAsync();
            SqliteConnection.ClearAllPools();
        }
        finally
        {
            if (Directory.Exists(TempDirectory))
            {
                Directory.Delete(TempDirectory, recursive: true);
            }
        }
    }
}

/// <summary>Same host in the Development environment, the only one that maps OpenAPI and Scalar.</summary>
public sealed class DevelopmentApiFactory : ApiVersioningFactory
{
    public DevelopmentApiFactory()
        : base("Development")
    {
    }
}
