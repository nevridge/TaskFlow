using Asp.Versioning;

namespace TaskFlow.Api.Extensions;

/// <summary>
/// Extension methods for configuring API versioning services
/// </summary>
public static class ApiVersioningServiceExtensions
{
    /// <summary>
    /// Adds API versioning services to the service collection
    /// Following Microsoft's recommended practices for ASP.NET Core API versioning
    /// </summary>
    /// <param name="services">The service collection</param>
    /// <returns>The service collection for chaining</returns>
    public static IServiceCollection AddApiVersioningConfiguration(this IServiceCollection services)
    {
        services.AddApiVersioning(options =>
        {
            // Set default API version to 1.0
            options.DefaultApiVersion = new ApiVersion(1, 0);

            // Report API versions in response headers (api-supported-versions, api-deprecated-versions)
            options.ReportApiVersions = true;

            // Configure how API version is read from requests
            // URL segment is the primary method (e.g., /api/v1/TaskItems)
            // Header is supported as fallback (x-api-version: 1.0)
            options.ApiVersionReader = ApiVersionReader.Combine(
                new UrlSegmentApiVersionReader(),
                new HeaderApiVersionReader("x-api-version")
            );
        })
        .AddMvc()
        .AddApiExplorer(options =>
        {
            // Format API version as "'v'major[.minor][-status]"
            // Example: v1.0, v2.0, v1.0-beta
            options.GroupNameFormat = "'v'VVV";

            // Substitute API version in URL
            options.SubstituteApiVersionInUrl = true;
        });

        return services;
    }
}
