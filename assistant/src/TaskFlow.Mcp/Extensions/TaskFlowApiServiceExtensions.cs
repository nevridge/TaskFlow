using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Extensions;

public static class TaskFlowApiServiceExtensions
{
    public const string DefaultBaseUrl = "http://localhost:8081";
    public const string BaseUrlSetting = "TASKFLOW_API_URL";

    /// <summary>
    /// Registers the typed API client. A blank, missing or malformed URL (for example an unsubstituted
    /// plugin placeholder) falls back to the local Docker default.
    /// </summary>
    public static IServiceCollection AddTaskFlowApi(this IServiceCollection services, string? baseUrl)
    {
        var root = NormalizeBaseUrl(baseUrl);

        services.TryAddSingleton(TimeProvider.System);
        services.AddHttpClient<TaskFlowApiClient>(client =>
        {
            client.BaseAddress = new Uri($"{root}/api/v1/");
            client.Timeout = TimeSpan.FromSeconds(30);
            client.DefaultRequestHeaders.Add("x-api-version", "1.0");
        });

        return services;
    }

    internal static string NormalizeBaseUrl(string? value)
    {
        var trimmed = value?.Trim().TrimEnd('/');
        return !string.IsNullOrEmpty(trimmed)
            && Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            && uri.Scheme is "http" or "https"
                ? trimmed
                : DefaultBaseUrl;
    }
}
