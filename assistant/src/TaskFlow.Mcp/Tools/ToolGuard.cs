using ModelContextProtocol;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>
/// Runs a tool body and converts failures into <see cref="McpException"/>. The MCP SDK returns only
/// McpException messages to the model (any other exception becomes a generic error), so this is what
/// makes API errors actionable for Claude.
/// </summary>
internal static class ToolGuard
{
    public static async Task<string> RunAsync(TaskFlowApiClient api, CancellationToken ct, Func<Task<string>> action)
    {
        try
        {
            return await action();
        }
        catch (McpException)
        {
            throw;
        }
        catch (TaskFlowApiException ex)
        {
            throw new McpException(ex.Message, ex);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            throw new McpException($"The TaskFlow API at {api.BaseUrl} did not respond in time.", ex);
        }
        catch (HttpRequestException ex)
        {
            throw new McpException(
                $"Cannot reach the TaskFlow API at {api.BaseUrl}. Start it with `docker compose up -d` in the TaskFlow repo, "
                + "or set TASKFLOW_API_URL if it runs elsewhere.",
                ex);
        }
    }

    public static McpException Invalid(string message) => new(message);
}
