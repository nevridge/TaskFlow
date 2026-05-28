using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Extensions;

/// <summary>
/// Extension methods for configuring persistence services
/// </summary>
public static class PersistenceServiceExtensions
{
    /// <summary>
    /// Adds database context and repository services to the service collection
    /// </summary>
    /// <param name="services">The service collection</param>
    /// <param name="configuration">The configuration instance</param>
    /// <returns>The service collection for chaining</returns>
    public static IServiceCollection AddPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        // Read connection string from configuration
        // Default to /app/data/tasks.db for consistent container paths
        var connectionString = configuration.GetConnectionString("DefaultConnection")
                               ?? "Data Source=/app/data/tasks.db";

        // Register SQLite DB context
        services.AddDbContext<TaskDbContext>(options =>
            options.UseSqlite(connectionString));

        // Register repositories
        services.AddScoped<ITaskRepository, TaskRepository>();
        services.AddScoped<INoteRepository, NoteRepository>();
        services.AddScoped<IJournalEntryRepository, JournalEntryRepository>();
        services.AddScoped<IJournalLogEntryRepository, JournalLogEntryRepository>();
        services.AddScoped<IJournalNoteRepository, JournalNoteRepository>();

        return services;
    }

    /// <summary>
    /// Ensures the directory for a SQLite Data Source connection string exists,
    /// creating it if necessary. No-ops for in-memory or non-file connection strings.
    /// </summary>
    /// <param name="connectionString">The SQLite connection string</param>
    /// <param name="logger">Optional logger for directory creation events</param>
    internal static void EnsureSqliteDirectoryExists(string? connectionString, ILogger? logger = null)
    {
        if (string.IsNullOrEmpty(connectionString))
        {
            return;
        }

        var builder = new SqliteConnectionStringBuilder(connectionString);
        var dataSource = builder.DataSource;

        // Skip in-memory, empty, or special-keyword sources (e.g. ":memory:")
        if (string.IsNullOrEmpty(dataSource) || dataSource.StartsWith(':')
            || dataSource.Equals("file::memory:", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var directory = Path.GetDirectoryName(dataSource);
        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
        {
            Directory.CreateDirectory(directory);
            logger?.LogInformation("Created database directory: {Directory}", directory);
        }
    }
}
