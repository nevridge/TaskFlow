using TaskFlow.Api.Services;

namespace TaskFlow.Api.Extensions;

/// <summary>
/// Extension methods for configuring application business logic services
/// </summary>
public static class ApplicationServiceExtensions
{
    /// <summary>
    /// Adds application business logic services to the service collection
    /// </summary>
    /// <param name="services">The service collection</param>
    /// <returns>The service collection for chaining</returns>
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        // Register application services
        services.AddScoped<ITaskService, TaskService>();
        services.AddScoped<INoteService, NoteService>();
        services.AddScoped<IJournalEntryService, JournalEntryService>();
        services.AddScoped<IJournalLogEntryService, JournalLogEntryService>();

        return services;
    }
}
