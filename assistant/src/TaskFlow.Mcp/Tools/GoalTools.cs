using System.ComponentModel;
using System.Net;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

[McpServerToolType]
public sealed class GoalTools(TaskFlowApiClient api, TimeProvider time)
{
    private const string ProjectText = "The goal's project: name or id (required).";

    [McpServerTool(Name = "list_goals", ReadOnly = true)]
    [Description("Lists a project's goals: the Now goal, then Next goals in order, then Parked, then Done and Dropped (newest first). "
        + "Each line has the goal's #id, status, parked reason, the date its status last changed, the closed date and open/done task counts. "
        + "A project has at most one Now goal. Call it before save_goal, swap_now or delete_goal. To see a goal's tasks, use list_tasks with project and goal.")]
    public Task<string> ListGoals(
        [Description(ProjectText)] string project,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var resolved = await ResolveProjectAsync(project, ct);
            var goals = await api.GetGoalsAsync(resolved.Id, ct);

            return goals.Count == 0
                ? $"No goals in project '{resolved.Name}' yet."
                : $"{goals.Count} goal(s) in project '{resolved.Name}':\n" + string.Join("\n", goals.Select(g => Formatting.Goal(g, time.LocalTimeZone)));
        });

    [McpServerTool(Name = "save_goal")]
    [Description("Creates or edits a goal in a project. Omit 'goal' to create: 'title' is required and status can only be next (default) or now. "
        + "Pass 'goal' (title or id) to edit: omitted fields are kept, and an empty string clears description or doneWhen. "
        + "Titles may repeat, so repeating a create makes a second goal. "
        + "A project has one Now goal: to make another goal Now while one exists, use swap_now. "
        + "status=parked needs a parkedReason. done or dropped needs every task of the goal completed. "
        + "While the Now goal has tasks in progress it cannot go back to next or parked. "
        + "Only create or change goals when the user asks.")]
    public Task<string> SaveGoal(
        [Description(ProjectText)] string project,
        [Description("Existing goal to edit, by title or id. Omit to create a new goal.")] string? goal = null,
        [Description("Goal title (max 100 characters). Required to create; when editing, omit to keep it.")] string? title = null,
        [Description("Longer description. Omit to keep it; an empty string clears it.")] string? description = null,
        [Description("What has to be true for the goal to be done. Omit to keep it; an empty string clears it.")] string? doneWhen = null,
        [Description("next, now, parked, done or dropped. A new goal takes only next (default) or now. Omit to keep the status when editing.")] string? status = null,
        [Description("Why the goal is parked (max 200 characters). Required when it becomes parked; only valid when the resulting status is parked.")] string? parkedReason = null,
        [Description("Place among the project's Next goals, 1 = first. Only valid when the resulting status is next; the API refuses an out-of-range position or a non-Next result, and a refusal changes nothing.")] int? position = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var creating = string.IsNullOrWhiteSpace(goal);
            var requested = string.IsNullOrWhiteSpace(status) ? null : InputParsing.NormalizeGoalStatus(status);
            var newTitle = string.IsNullOrWhiteSpace(title) ? null : title.Trim();
            var reason = string.IsNullOrWhiteSpace(parkedReason) ? null : parkedReason.Trim();

            if (creating)
            {
                if (newTitle is null)
                {
                    throw ToolGuard.Invalid("Pass 'title' to create a goal, or 'goal' to edit one. Nothing was changed.");
                }

                if (requested is not (null or "next" or "now"))
                {
                    throw ToolGuard.Invalid($"A new goal can only be next or now, not {requested}. Create it as next, then call save_goal again to change its status. Nothing was changed.");
                }
            }

            var resolved = await ResolveProjectAsync(project, ct);
            // Only an edit reads the goals, to resolve the goal by title. The API owns the position rules.
            var existing = creating ? null : GoalResolver.Resolve(await api.GetGoalsAsync(resolved.Id, ct), goal!, resolved.Name);
            var resulting = requested ?? existing?.Status.ToLowerInvariant() ?? "next";

            if (reason is not null && resulting != "parked")
            {
                throw ToolGuard.Invalid($"parkedReason is only valid for a parked goal, and this one would be {resulting}. Pass status=parked, or omit parkedReason. Nothing was changed.");
            }

            GoalDto saved;
            try
            {
                saved = await ToolGuard.WriteAsync(api, ct, () => existing is null
                    ? api.CreateGoalAsync(new CreateGoalRequest(resolved.Id, newTitle!, Optional(description, null), Optional(doneWhen, null), resulting, position), ct)
                    : api.UpdateGoalAsync(
                        existing.Id,
                        new UpdateGoalRequest(
                            newTitle ?? existing.Title,
                            Optional(description, existing.Description),
                            Optional(doneWhen, existing.DoneWhen),
                            resulting,
                            resulting == "parked" ? reason ?? existing.ParkedReason : null,
                            position),
                        ct));
            }
            catch (McpException ex) when (ex.InnerException is TaskFlowApiException { Status: HttpStatusCode.Conflict })
            {
                var next = existing is null
                    ? "Create it with status=next, then call swap_now if the user agrees to make it the Now goal."
                    : "To make this goal Now, call swap_now if the user agrees; send any other changes with save_goal without status.";
                throw ToolGuard.Invalid($"{ex.Message}\n{next}");
            }

            var placed = position is { } at ? $" | position {at} in Next" : string.Empty;
            return $"{(existing is null ? "Created" : "Saved")} goal in project '{resolved.Name}': {Formatting.Goal(saved, time.LocalTimeZone)}{placed}";
        });

    [McpServerTool(Name = "swap_now", Idempotent = true)]
    [Description("Makes a goal the project's Now goal. The previous Now goal goes to the top of Next. "
        + "Call it only when the user asked for it or agreed. "
        + "It is refused while the current Now goal has tasks in progress (pause or block them first), and a Done or Dropped goal cannot be swapped in.")]
    public Task<string> SwapNow(
        [Description(ProjectText)] string project,
        [Description("The goal to make Now: title or id.")] string goal,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var resolved = await ResolveProjectAsync(project, ct);
            var goals = await api.GetGoalsAsync(resolved.Id, ct);
            var target = GoalResolver.Resolve(goals, Required(goal), resolved.Name);
            var previous = goals.FirstOrDefault(g => IsStatus(g, "Now") && g.Id != target.Id);

            var now = await api.SwapNowGoalAsync(target.Id, ct);

            return IsStatus(target, "Now")
                ? $"Goal {Formatting.GoalLabel(now)} is already the Now goal of project '{resolved.Name}'."
                : $"Goal {Formatting.GoalLabel(now)} is now the Now goal of project '{resolved.Name}'."
                    + (previous is null ? string.Empty : $" {Formatting.GoalLabel(previous)} moved to the top of Next.");
        });

    [McpServerTool(Name = "delete_goal", Destructive = true)]
    [Description("Deletes a goal. Its tasks are kept in the project with no goal (Unsorted). "
        + "A goal with no tasks is deleted immediately, even with confirmed=false, so confirmed=false is not a dry run. "
        + "For a goal with tasks, a call without confirmed=true deletes nothing and says how many tasks would return to Unsorted. "
        + "Call it only when the user asked to delete that exact goal, and set confirmed=true only after they agreed.")]
    public Task<string> DeleteGoal(
        [Description(ProjectText)] string project,
        [Description("Goal to delete: its id or exact title (any casing). A partial title is not accepted.")] string goal,
        [Description("Set true only after the user has seen how many tasks are affected and agreed. A goal with no tasks is deleted even when false. Default false.")] bool confirmed = false,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var resolved = await ResolveProjectAsync(project, ct);
            var goals = await api.GetGoalsAsync(resolved.Id, ct);
            var target = ResolveForDelete(goals, Required(goal), resolved.Name);
            var label = $"{Formatting.GoalLabel(target)} (project '{resolved.Name}')";
            var tasks = target.OpenTaskCount + target.DoneTaskCount;

            if (tasks > 0 && !confirmed)
            {
                return $"Nothing was deleted. Goal {label} has {tasks} task(s) ({target.OpenTaskCount} open) that would return to Unsorted. "
                    + "Ask the user, then call delete_goal again with confirmed=true.";
            }

            await api.DeleteGoalAsync(target.Id, ct);

            return tasks == 0
                ? $"Deleted goal {label}. It had no tasks."
                : $"Deleted goal {label}. {tasks} task(s) returned to Unsorted.";
        });

    /// <summary>An empty goal is deleted on the first call, so the goal to delete is never guessed from a partial title.</summary>
    private static GoalDto ResolveForDelete(IReadOnlyList<GoalDto> goals, string goal, string projectName)
    {
        var key = goal.Trim();
        var isId = int.TryParse(key, out var id) && goals.Any(g => g.Id == id);
        var exact = goals.Where(g => string.Equals(g.Title, key, StringComparison.OrdinalIgnoreCase)).ToList();

        if (!isId && exact.Count > 1)
        {
            throw ToolGuard.Invalid($"Several goals are titled '{key}': {GoalResolver.List(exact)}. Pass the goal id. Nothing was deleted.");
        }

        var target = GoalResolver.Resolve(goals, key, projectName);

        return isId || exact.Count == 1
            ? target
            : throw ToolGuard.Invalid($"No goal is titled '{key}'. Did you mean {Formatting.GoalLabel(target)}? delete_goal needs the exact title or id. Nothing was deleted.");
    }

    private async Task<ProjectDto> ResolveProjectAsync(string project, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(project)
            ? throw ToolGuard.Invalid("Pass 'project': the name or id of the goal's project.")
            : await ProjectResolver.ResolveAsync(api, project, ct);

    private static string Required(string goal) =>
        string.IsNullOrWhiteSpace(goal) ? throw ToolGuard.Invalid("Pass 'goal': the title or id of the goal.") : goal;

    /// <summary>Omitted keeps the current value; an empty or blank string clears it.</summary>
    private static string? Optional(string? value, string? current) =>
        value is null ? current : (string.IsNullOrWhiteSpace(value) ? null : value);

    private static bool IsStatus(GoalDto goal, string status) => string.Equals(goal.Status, status, StringComparison.OrdinalIgnoreCase);
}
