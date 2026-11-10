using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace TaskFlow.Mcp.Integration.Tests.Infrastructure;

/// <summary>
/// Hosts the real TaskFlow.Api in-process on a unique temporary SQLite file. Program reads several settings
/// eagerly, so every setting the tests rely on is set explicitly rather than inherited from appsettings.
/// </summary>
internal sealed class TaskFlowApiFactory : WebApplicationFactory<Program>
{
    public TaskFlowApiFactory()
    {
        TempDirectory = Path.Combine(Path.GetTempPath(), "taskflow-mcp-it-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(TempDirectory);
        DatabasePath = Path.Combine(TempDirectory, "tasks.db");
    }

    public string TempDirectory { get; }

    public string DatabasePath { get; }

    public string ConnectionString => $"Data Source={DatabasePath};Pooling=False";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:DefaultConnection", ConnectionString);
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
