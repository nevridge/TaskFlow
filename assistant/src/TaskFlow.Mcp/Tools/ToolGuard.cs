using System.Net;
using System.Text.Json;
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
        [ErrorCodes.TaskGoalNotNow] = "Ask the user whether to swap that task's goal to Now with swap_now, or to take the task (for a subtask, its parent) off the goal with update_task (goal=none).",
        [ErrorCodes.GoalNowHasInProgressTasks] = "Pause (status=todo) or block (status=blocked) the named tasks with update_task or update_tasks, then retry.",
        [ErrorCodes.GoalHasOpenTasks] = "Complete the named tasks, or take them (for a subtask, its parent) off the goal with update_task (goal=none), then retry.",
    };

    private const int MaxNamedTasks = 20;

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

    /// <summary>
    /// Appends one line of next-step guidance for known 422 codes, and for the goal rules a further line naming the
    /// tasks or the Now goal from <c>details</c>. Other errors pass through unchanged.
    /// </summary>
    internal static string WithGuidance(TaskFlowApiException ex)
    {
        if (ex.Status != HttpStatusCode.UnprocessableEntity || ex.Code is null
            || !Guidance.TryGetValue(ex.Code, out var guidance))
        {
            return ex.Message;
        }

        var named = DetailsLine(ex);
        return ex.Message + "\n" + guidance + (named is null ? string.Empty : "\n" + named);
    }

    /// <summary>Null when there is nothing to name, including when <c>details</c> has an unexpected shape.</summary>
    private static string? DetailsLine(TaskFlowApiException ex)
    {
        if (ex.Details is not { ValueKind: JsonValueKind.Object } details)
        {
            return null;
        }

        return ex.Code switch
        {
            ErrorCodes.TaskGoalNotNow => Named(details, "nowGoalId", "nowGoalTitle") is { } goal ? $"Now goal: {goal}" : null,
            ErrorCodes.GoalNowHasInProgressTasks => TasksLine("Tasks in progress", details),
            ErrorCodes.GoalHasOpenTasks => TasksLine("Open tasks", details),
            _ => null,
        };
    }

    private static string? TasksLine(string label, JsonElement details)
    {
        if (!details.TryGetProperty("tasks", out var tasks) || tasks.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var names = tasks.EnumerateArray().Select(t => Named(t, "id", "title")).ToList();
        if (names.Count == 0 || names.Contains(null))
        {
            return null;
        }

        var more = names.Count > MaxNamedTasks ? $" and {names.Count - MaxNamedTasks} more" : string.Empty;
        return $"{label}: {string.Join("; ", names.Take(MaxNamedTasks))}{more}";
    }

    /// <summary>"#id title" from two members of an object, or null when either is missing or of another type.</summary>
    private static string? Named(JsonElement element, string idName, string titleName) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(idName, out var id) && id.ValueKind == JsonValueKind.Number
        && element.TryGetProperty(titleName, out var title) && title.ValueKind == JsonValueKind.String
            ? $"#{id.GetRawText()} {Formatting.CleanReason(title.GetString())}"
            : null;

    public static McpException Invalid(string message) => new(message);
}
