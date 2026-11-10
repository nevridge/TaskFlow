using System.Net;
using ModelContextProtocol;
using TaskFlow.Contracts;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>
/// Runs a tool body and converts failures into <see cref="McpException"/>. The MCP SDK returns only
/// McpException messages to the model (any other exception becomes a generic error), so this is what
/// makes API errors actionable for Claude.
/// </summary>
internal static class ToolGuard
{
    private static readonly IReadOnlyDictionary<string, string> Guidance = new Dictionary<string, string>
    {
        [ErrorCodes.BlockDraftNotAllowed] = "Only Todo or InProgress tasks can be blocked. Make the task Todo first (status=todo), then block it.",
        [ErrorCodes.BlockCompletedNotAllowed] = "Only Todo or InProgress tasks can be blocked. Reopen the task first (complete=false), then block it.",
        [ErrorCodes.BlockedReasonRequiresBlockedStatus] = "A blockedReason needs status=blocked on a Todo or InProgress task; pass status=blocked with it, or omit blockedReason.",
        [ErrorCodes.StartNotAllowed] = "Only Todo tasks can be started. If the task is Draft, set status=todo first; if it is Completed, reopen it first (complete=false); then set status=inprogress.",
        [ErrorCodes.CreationPastDayNotAllowed] = "journalDate must be today or later; pass today, tomorrow or a future yyyy-MM-dd, or omit journalDate.",
        [ErrorCodes.PlanHasOpenSubtasks] = "A task with open subtasks cannot be planned on a day. Plan its subtasks instead, using update_task or update_tasks with journalDate, or set_journal_todos (find them with list_tasks).",
        [ErrorCodes.ParentCompletedNotAllowed] = "An open task cannot sit under a Completed parent. Reopen the parent first (update_task on the parent with complete=false), or keep the child completed, or detach it (parentTaskId).",
        [ErrorCodes.ParentStatusDerived] = "A parent's status follows its subtasks. Change the status of its subtasks with update_task or update_tasks instead of the parent's.",
        [ErrorCodes.PlanCompletedNotAllowed] = "A completed task cannot be planned onto a different day. Omit journalDate, or reopen the task first (complete=false) and then plan it.",
        [ErrorCodes.ProjectNotFound] = "`project` did not match an existing project; find the right one with list_projects, or omit project.",
        [ErrorCodes.ReopenPastDayNotAllowed] = "A task completed on a past day cannot be reopened, so do not pass complete=false; record the follow-up work as a new task with create_tasks.",
        [ErrorCodes.ParentNotFound] = "parentTaskId does not match an existing task; look the parent up with list_tasks, or omit parentTaskId.",
        [ErrorCodes.ParentSelfNotAllowed] = "A task cannot be its own parent; pass a different parentTaskId, or omit it.",
        [ErrorCodes.ParentDepthNotAllowed] = "Only one subtask level is supported, so parentTaskId must name a top-level task, and a task that already has subtasks cannot become a subtask (check with get_task).",
        [ErrorCodes.ParentCompleteBlockedByChildren] = "A parent with open subtasks cannot be completed; complete its subtasks first with update_task or update_tasks (complete=true), then complete the parent.",
        [ErrorCodes.ParentDeleteBlockedByChildren] = "A task with subtasks cannot be deleted; delete the subtasks with delete_task or detach them with update_task (parentTaskId=0), then delete the parent.",
        [ErrorCodes.AssignmentPastDayNotAllowed] = "set_journal_todos can only plan tasks on today or a later day; pass date as today, tomorrow or a future yyyy-MM-dd.",
    };

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

        return Guidance.TryGetValue(ex.Code, out var guidance) ? ex.Message + "\n" + guidance : ex.Message;
    }

    public static McpException Invalid(string message) => new(message);
}
