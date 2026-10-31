using System.Net;
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
            throw new McpException(WithGuidance(ex), ex);
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

    /// <summary>Appends one line of next-step guidance for known 422 codes. Other errors pass through unchanged.</summary>
    internal static string WithGuidance(TaskFlowApiException ex)
    {
        if (ex.Status != HttpStatusCode.UnprocessableEntity || ex.Code is null)
        {
            return ex.Message;
        }

        var guidance = ex.Code switch
        {
            "TASK_BLOCK_DRAFT_NOT_ALLOWED" => "Only Todo or InProgress tasks can be blocked. Make the task Todo first (status=todo), then block it.",
            "TASK_BLOCK_COMPLETED_NOT_ALLOWED" => "Only Todo or InProgress tasks can be blocked. Reopen the task first (complete=false), then block it.",
            "TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS" => "A blockedReason needs status=blocked on a Todo or InProgress task; pass status=blocked with it, or omit blockedReason.",
            "TASK_START_NOT_ALLOWED" => "Only Todo tasks can be started. If the task is Draft, set status=todo first; if it is Completed, reopen it first (complete=false); then set status=inprogress.",
            "TASK_CREATION_PAST_DAY_NOT_ALLOWED" => "journalDate must be today or later; pass today, tomorrow or a future yyyy-MM-dd, or omit journalDate.",
            _ => null,
        };

        return guidance is null ? ex.Message : ex.Message + "\n" + guidance;
    }

    public static McpException Invalid(string message) => new(message);
}
