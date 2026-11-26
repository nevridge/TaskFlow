using System.ComponentModel;
using System.Globalization;
using System.Net;
using System.Text;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>One task to create with create_tasks.</summary>
public sealed class NewTask
{
    [Description("Task title (required, max 100 characters).")]
    public string Title { get; set; } = string.Empty;

    [Description("Optional longer description.")]
    public string? Description { get; set; }

    [Description("low, medium or high. Default low.")]
    public string? Priority { get; set; }

    [Description("draft, todo or inprogress (default todo). Tasks cannot be created as blocked: create the task, then call update_task with status=blocked.")]
    public string? Status { get; set; }

    [Description("Due date as yyyy-MM-dd, or today/tomorrow.")]
    public string? DueDate { get; set; }

    [Description("Project name or id. The project must already exist (see list_projects).")]
    public string? Project { get; set; }

    [Description("Goal title or id within 'project' (project is required with goal). The goal must already exist (see list_goals). Omit or 'none' for no goal; a subtask takes its parent's goal.")]
    public string? Goal { get; set; }

    [Description("Id of a parent task, to make this a subtask. Only one subtask level is supported.")]
    public int? ParentTaskId { get; set; }

    [Description("Plan the task on this journal day (yyyy-MM-dd or today). The API rejects past days.")]
    public string? JournalDate { get; set; }
}

/// <summary>Parameter wording shared by update_task and the update_tasks item, so the two cannot drift.</summary>
internal static class UpdateFieldText
{
    public const string Id = "Task id.";
    public const string Title = "New title (max 100 characters).";
    public const string Description = "New description. Pass an empty string to clear it.";
    public const string Status = "draft, todo, inprogress, blocked or completed (any casing). inprogress = work has started; only Todo tasks can be started. "
        + "While the project has a Now goal, a task in a Next or Parked goal cannot be started or completed. "
        + "Only Todo or InProgress tasks can be blocked. status=todo on a Blocked task unblocks it: InProgress is restored only if the goal rule allows it, otherwise the task becomes Todo. On an InProgress task, status=todo moves it back to Todo. "
        + "Completing a Blocked task clears the block.";
    public const string Priority = "low, medium or high.";
    public const string DueDate = "The deadline: yyyy-MM-dd, today/tomorrow, or 'none' to clear the due date. Separate from journalDate; it does not plan the task.";
    public const string Project = "Project name or id to assign, or 'none' to remove the task from its project. An unknown or ambiguous project rejects the whole update before anything is saved.";
    public const string Goal = "Goal title or id within the task's project (the new one when 'project' is passed), or 'none' to remove it. "
        + "Omit to leave it alone, but moving projects clears it and gaining a parent takes the parent's goal. A subtask's goal cannot be set directly. Moving an InProgress subtask into its parent's project is refused when the parent's goal is not Now. "
        + "An unknown or ambiguous goal rejects the whole update before anything is saved.";
    public const string ParentTaskId = "Parent task id to make this a subtask; 0 removes the parent. Only one subtask level is supported.";
    public const string Complete = "true to mark complete, false to reopen.";
    public const string JournalDate = "Plans the task on this day: today, tomorrow or yyyy-MM-dd, and the day must be today or later. "
        + "Omit to leave the planned day unchanged (empty or whitespace counts as omitted). Planning cannot be cleared via update; use set_journal_todos. "
        + "Not the deadline (that is dueDate). A task with open subtasks cannot be planned: plan its subtasks instead.";
    public const string BlockedReason = "Reason the task is blocked (max 200 characters). Only valid with status=blocked on a Todo or InProgress task or a task that is already Blocked. Pass an empty string to clear the reason (the task stays Blocked). Omit to keep the stored reason.";
}

/// <summary>One task update for update_tasks. Same fields as update_task; only the fields that are set change.</summary>
public sealed class TaskUpdate
{
    [Description("Task id (required).")]
    public int Id { get; set; }

    [Description(UpdateFieldText.Title)]
    public string? Title { get; set; }

    [Description(UpdateFieldText.Description)]
    public string? Description { get; set; }

    [Description(UpdateFieldText.Status)]
    public string? Status { get; set; }

    [Description(UpdateFieldText.Priority)]
    public string? Priority { get; set; }

    [Description(UpdateFieldText.DueDate)]
    public string? DueDate { get; set; }

    [Description(UpdateFieldText.Project)]
    public string? Project { get; set; }

    [Description(UpdateFieldText.Goal)]
    public string? Goal { get; set; }

    [Description(UpdateFieldText.ParentTaskId)]
    public int? ParentTaskId { get; set; }

    [Description(UpdateFieldText.Complete)]
    public bool? Complete { get; set; }

    [Description(UpdateFieldText.BlockedReason)]
    public string? BlockedReason { get; set; }

    [Description(UpdateFieldText.JournalDate)]
    public string? JournalDate { get; set; }
}

[McpServerToolType]
public sealed class TaskTools(TaskFlowApiClient api, TimeProvider time)
{
    public const int StaleMoves = 3;
    public const int StaleDays = 7;
    private const int MaxPageSize = 100;
    private const int MaxBatch = 25;
    private const int HistoryPreview = 10;
    private const int MaxBlockedReasonLength = 200;

    private static readonly string[] Views = ["open", "all", "completed", "overdue", "due_soon", "stale", "unassigned", "today", "blocked"];

    internal static bool IsStale(TaskItemDto t) => t.MoveCount >= StaleMoves || t.DaysTagged >= StaleDays;

    [McpServerTool(Name = "list_tasks", ReadOnly = true)]
    [Description(
        "Lists tasks, most urgent first. Use 'view' to choose what you want: open (default), overdue, due_soon (open tasks overdue or due within dueWithinDays), "
        + "stale (moved 3+ times or tagged 7+ days), unassigned (open tasks with no project), today (planned on today's journal), blocked (Blocked status only), completed, all. "
        + "Blocked tasks still appear in the other open views and are flagged 'blocked: <reason> (Nd)', where (Nd) = days blocked, <1d if under a day. "
        + "To find what was finished on or between days, use completedFrom/completedTo with view=completed or all. Use plannedDate for tasks on a given day's journal. "
        + "Lines show 'goal: <title>' for a task in a goal; filter with goal (with project), or goal=none for Unsorted tasks. "
        + "Results are paged (default 25); follow the 'Next page' hint for more. Use responseFormat=detailed to include descriptions and journal info.")]
    public Task<string> ListTasks(
        [Description("open, all, completed, overdue, due_soon, stale, unassigned, today or blocked (Blocked status only). Blocked tasks still appear in the other open views and are flagged. Default open.")] string view = "open",
        [Description("Only tasks in this project (name or id).")] string? project = null,
        [Description("Only this status: draft, todo, inprogress, blocked or completed.")] string? status = null,
        [Description("Only this priority: low, medium or high.")] string? priority = null,
        [Description("For view=due_soon: how many days ahead to include. Default 7.")] int dueWithinDays = 7,
        [Description("Page size, 1-100. Default 25.")] int limit = 25,
        [Description("Number of results to skip, for paging. Default 0.")] int offset = 0,
        [Description("concise (default) or detailed.")] string responseFormat = "concise",
        [Description("Only tasks completed on or after this day (inclusive, local time). yyyy-MM-dd, today, tomorrow or yesterday. Only done tasks are checked: a reopened task is not matched. Based on completion history of the 300 highest-id matching done tasks; see the incomplete-results note.")] string? completedFrom = null,
        [Description("Only tasks completed on or before this day (inclusive, local time). yyyy-MM-dd, today, tomorrow or yesterday. Must not be earlier than completedFrom.")] string? completedTo = null,
        [Description("Only tasks planned on the journal of this day. yyyy-MM-dd, today, tomorrow or yesterday. Done tasks need view=all.")] string? plannedDate = null,
        [Description("Only tasks in this goal (title or id; needs 'project'), or 'none' for Unsorted tasks: in a project but in no goal.")] string? goal = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var normalizedView = (view ?? "open").Trim().ToLowerInvariant();
            if (!Views.Contains(normalizedView))
            {
                throw ToolGuard.Invalid($"Invalid view '{view}'. Allowed values: {string.Join(", ", Views)}.");
            }

            var today = InputParsing.Today(time);
            DateOnly? from = string.IsNullOrWhiteSpace(completedFrom) ? null : InputParsing.ParseDate(completedFrom, today, "completedFrom");
            DateOnly? to = string.IsNullOrWhiteSpace(completedTo) ? null : InputParsing.ParseDate(completedTo, today, "completedTo");
            DateOnly? planned = string.IsNullOrWhiteSpace(plannedDate) ? null : InputParsing.ParseDate(plannedDate, today, "plannedDate");
            if (from is { } f && to is { } t2 && f > t2)
            {
                throw ToolGuard.Invalid($"'completedFrom' ({f:yyyy-MM-dd}) is after 'completedTo' ({t2:yyyy-MM-dd}).");
            }

            var goalKey = string.IsNullOrWhiteSpace(goal) ? null : goal.Trim();
            var unsorted = IsNone(goalKey);
            if (goalKey is not null && !unsorted && string.IsNullOrWhiteSpace(project))
            {
                throw ToolGuard.Invalid("Filtering by a goal needs 'project': goals belong to a project. Only goal=none works without it.");
            }

            var tasks = await api.GetTasksAsync(ct);

            IEnumerable<TaskItemDto> query = tasks.Where(t => MatchesView(t, normalizedView, today, Math.Max(dueWithinDays, 0)));

            var filters = new List<string>();
            if (!string.IsNullOrWhiteSpace(project))
            {
                var resolved = await ProjectResolver.ResolveAsync(api, project, ct);
                query = query.Where(t => t.ProjectId == resolved.Id);
                filters.Add($"project={resolved.Name}");

                if (goalKey is not null && !unsorted)
                {
                    var wanted = GoalResolver.Resolve(await api.GetGoalsAsync(resolved.Id, ct), goalKey, resolved.Name);
                    query = query.Where(t => t.GoalId == wanted.Id);
                    filters.Add($"goal={Formatting.CleanReason(wanted.Title)}");
                }
            }

            if (unsorted)
            {
                query = query.Where(t => t.ProjectId is not null && t.GoalId is null);
                filters.Add("goal=none");
            }

            if (!string.IsNullOrWhiteSpace(status))
            {
                var wanted = InputParsing.NormalizeStatus(status);
                query = query.Where(t => string.Equals(t.Status, wanted, StringComparison.OrdinalIgnoreCase));
                filters.Add($"status={wanted}");
            }

            if (!string.IsNullOrWhiteSpace(priority))
            {
                var wanted = InputParsing.NormalizePriority(priority);
                query = query.Where(t => string.Equals(t.Priority, wanted, StringComparison.OrdinalIgnoreCase));
                filters.Add($"priority={wanted}");
            }

            if (planned is { } plannedDay)
            {
                query = query.Where(t => t.CurrentJournalDate == plannedDay);
                filters.Add($"plannedDate={plannedDay:yyyy-MM-dd}");
            }

            var capNote = string.Empty;
            if (from is not null || to is not null)
            {
                // Not-done tasks are skipped on purpose, so a reopened task whose Completed event is in range
                // is excluded, unlike weekly_review.
                var candidates = query.Where(t => t.IsDone).ToList();
                var lookups = candidates.Count > HistoryLookup.MaxHistoryLookups
                    ? candidates.OrderByDescending(t => t.Id).Take(HistoryLookup.MaxHistoryLookups).ToList()
                    : candidates;
                if (candidates.Count > HistoryLookup.MaxHistoryLookups)
                {
                    capNote = $"\nNote: results may be incomplete; completed history was checked for only the {HistoryLookup.MaxHistoryLookups} highest-id of {candidates.Count} candidate tasks. "
                        + "Narrow with project, status, priority or plannedDate, or use weekly_review for a summary.";
                }

                var start = from ?? DateOnly.MinValue;
                var end = to ?? DateOnly.MaxValue;
                var histories = await HistoryLookup.LoadHistoriesAsync(api, lookups, ct);
                query = histories
                    .Where(h => h.Events.Any(e => e.EventType == HistoryLookup.CompletedEvent
                        && HistoryLookup.InRange(e.OccurredAtUtc, time.LocalTimeZone, start, end)))
                    .Select(h => h.Task)
                    .ToList();

                if (from is { } fromDay)
                {
                    filters.Add($"completedFrom={fromDay:yyyy-MM-dd}");
                }

                if (to is { } toDay)
                {
                    filters.Add($"completedTo={toDay:yyyy-MM-dd}");
                }
            }

            var ordered = (normalizedView is "overdue" or "due_soon"
                    ? Formatting.OrderByDue(query)
                    : Formatting.OrderByUrgency(query))
                .ToList();

            var pageSize = InputParsing.Clamp(limit, 1, MaxPageSize);
            var skip = Math.Max(offset, 0);
            var page = ordered.Skip(skip).Take(pageSize).ToList();
            var label = $"view={normalizedView}" + (filters.Count > 0 ? ", " + string.Join(", ", filters) : string.Empty);

            if (ordered.Count == 0)
            {
                var tip = normalizedView == "open" && (from is not null || to is not null)
                    ? " Tip: view=open excludes completed tasks; use view=completed or view=all with completedFrom/completedTo."
                    : string.Empty;
                return $"No tasks match ({label}).{tip}{capNote}";
            }

            if (page.Count == 0)
            {
                return $"{ordered.Count} task(s) match ({label}), but offset {skip} is past the end.{capNote}";
            }

            var detailed = Formatting.IsDetailed(responseFormat);
            var sb = new StringBuilder();
            sb.AppendLine($"{ordered.Count} task(s) match ({label}). Showing {skip + 1}-{skip + page.Count}.");
            foreach (var task in page)
            {
                sb.AppendLine(Formatting.Task(task, today, detailed, time.GetUtcNow()));
            }

            if (skip + page.Count < ordered.Count)
            {
                sb.AppendLine($"Next page: offset={skip + page.Count}");
            }

            return sb.ToString().TrimEnd() + capNote;
        });

    [McpServerTool(Name = "get_task", ReadOnly = true)]
    [Description("Gets everything about one task: fields, project, goal, notes and recent history (created, moved between days, blocked, completed...). For a Blocked task it shows the reason, (Nd) days blocked (<1d if under a day) and when it was blocked. Use before updating a task or when the user asks what happened with it.")]
    public Task<string> GetTask(
        [Description("Task id.")] int id,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var today = InputParsing.Today(time);
            var taskTask = api.GetTaskAsync(id, ct);
            var notesTask = api.GetTaskNotesAsync(id, ct);
            var historyTask = api.GetTaskHistoryAsync(id, ct);
            await Task.WhenAll(taskTask, notesTask, historyTask);

            var sb = new StringBuilder();
            sb.AppendLine(Formatting.Task(taskTask.Result, today, detailed: true, nowUtc: time.GetUtcNow()));

            var notes = notesTask.Result;
            if (notes.Count > 0)
            {
                sb.AppendLine($"Notes ({notes.Count}):");
                foreach (var note in notes.OrderBy(n => n.CreatedAt))
                {
                    sb.AppendLine($"  - [{LocalDate(note.CreatedAt)}] {Formatting.Preview(note.Content, 400)}");
                }
            }

            var history = historyTask.Result.OrderByDescending(e => e.OccurredAtUtc).Take(HistoryPreview).ToList();
            if (history.Count > 0)
            {
                sb.AppendLine("Recent history (newest first):");
                foreach (var e in history)
                {
                    sb.AppendLine($"  - {LocalDate(e.OccurredAtUtc)} {e.EventType}: {Formatting.CleanReason(e.ChangeSummary)}");
                }
            }

            return sb.ToString().TrimEnd();
        });

    [McpServerTool(Name = "create_tasks")]
    [Description(
        "Creates one or more tasks (up to 25). Use for a single task or to turn notes into many tasks. Each task needs a title; priority defaults to low and status to todo. "
        + "Tasks that fail (for example an unknown project) are reported individually and do not stop the others. Do not guess due dates or projects: leave them out unless the user said so. "
        + "Tasks cannot be created as blocked: create the task, then call update_task with status=blocked. "
        + "goal puts a task in a goal of its project (project required), in the same request: a refused task is not created. A subtask takes its parent's goal, so goal on a subtask must be the parent's goal or be omitted. "
        + "A timeout may or may not have created the task: check with list_tasks or get_task before retrying create_tasks, or it makes a duplicate. "
        + "While the project has a Now goal, a task in a Next or Parked goal cannot be started or completed. "
        + "An open task cannot be created under a Completed parent (parentTaskId): reopen the parent first or leave the parent out. "
        + "Tasks are still created when a possible duplicate (an existing open or done task with the same title, ignoring case and extra spaces) is found; the line is flagged `!`. "
        + "The duplicate check is best-effort: if existing tasks cannot be read, tasks are still created and the report says the check was skipped. "
        + "Tell the user; do not delete anything without confirmation.")]
    public Task<string> CreateTasks(
        [Description("The tasks to create.")] IReadOnlyList<NewTask> tasks,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (tasks is null || tasks.Count == 0)
            {
                throw ToolGuard.Invalid("Pass at least one task.");
            }

            if (tasks.Count > MaxBatch)
            {
                throw ToolGuard.Invalid($"Too many tasks ({tasks.Count}). Create at most {MaxBatch} per call.");
            }

            var (today, offset) = InputParsing.LocalNow(time);
            IReadOnlyList<ProjectDto>? projects = null;
            var goalsByProject = new Dictionary<int, IReadOnlyList<GoalDto>>();

            var created = new List<string>();
            var failed = new List<string>();

            // Duplicate warnings are advisory: when the lookup fails, the tasks are still created.
            // Runs only when at least one item can reach the API, so all-invalid batches make no request.
            var existingByTitle = new Dictionary<string, TaskItemDto>(StringComparer.OrdinalIgnoreCase);
            var duplicateCheckSkipped = false;
            if (tasks.Any(t => !string.IsNullOrWhiteSpace(t.Title) && !IsBlockedStatus(t.Status)))
            {
                try
                {
                    // Unfiltered: returns open and done tasks.
                    foreach (var existing in (await api.GetTasksAsync(ct)).OrderBy(t => t.Id))
                    {
                        existingByTitle.TryAdd(Formatting.NormalizeTitle(existing.Title), existing);
                    }
                }
                catch (Exception ex) when ((ex is TaskFlowApiException or McpException or HttpRequestException)
                    || (ex is TaskCanceledException && !ct.IsCancellationRequested))
                {
                    duplicateCheckSkipped = true;
                    existingByTitle.Clear();
                }
            }

            var batchByTitle = new Dictionary<string, TaskItemDto>(StringComparer.OrdinalIgnoreCase);
            var duplicates = 0;

            foreach (var item in tasks)
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(item.Title))
                    {
                        throw ToolGuard.Invalid("Title is required.");
                    }

                    if (IsBlockedStatus(item.Status))
                    {
                        throw ToolGuard.Invalid("Cannot create a task as blocked. Create it first, then call update_task with status=blocked and a blockedReason.");
                    }

                    ProjectDto? project = null;
                    if (!string.IsNullOrWhiteSpace(item.Project))
                    {
                        projects ??= await api.GetProjectsAsync(ct);
                        project = ProjectResolver.Resolve(projects, item.Project);
                    }

                    GoalDto? goal = null;
                    if (!string.IsNullOrWhiteSpace(item.Goal) && !IsNone(item.Goal))
                    {
                        if (project is null)
                        {
                            throw ToolGuard.Invalid("goal needs project: goals belong to a project.");
                        }

                        if (!goalsByProject.TryGetValue(project.Id, out var goals))
                        {
                            goalsByProject[project.Id] = goals = await api.GetGoalsAsync(project.Id, ct);
                        }

                        goal = GoalResolver.Resolve(goals, item.Goal, project.Name);
                    }

                    var goalId = goal is null ? null : await GoalIdForCreateAsync(item.ParentTaskId, project, goal, ct);

                    var request = new CreateTaskRequest(
                        item.Title.Trim(),
                        item.Description,
                        InputParsing.NormalizeStatus(item.Status ?? "todo"),
                        InputParsing.NormalizePriority(item.Priority ?? "low"),
                        string.IsNullOrWhiteSpace(item.DueDate) ? null : InputParsing.ParseDate(item.DueDate, today, "dueDate"),
                        string.IsNullOrWhiteSpace(item.JournalDate) ? null : InputParsing.ParseDate(item.JournalDate, today, "journalDate"),
                        item.ParentTaskId,
                        project?.Id,
                        offset,
                        goalId);

                    // The goal travels in the same request, so a refusal creates nothing.
                    var task = await ToolGuard.WriteAsync(api, ct, () => api.CreateTaskAsync(request, ct), ToolGuard.CreateTaskTimeoutHint);

                    var line = "+ " + Formatting.Task(task, today, nowUtc: time.GetUtcNow());

                    // An existing task wins over an earlier item in this batch; one warning per item.
                    var key = Formatting.NormalizeTitle(item.Title);
                    if (existingByTitle.TryGetValue(key, out var match) || batchByTitle.TryGetValue(key, out match))
                    {
                        line += $" ! Possible duplicate of #{match.Id} \"{Formatting.CleanReason(match.Title)}\" ({(match.IsDone ? "done" : "open")})";
                        duplicates++;
                    }

                    batchByTitle.TryAdd(key, task);
                    created.Add(line);
                }
                catch (Exception ex) when (ex is McpException or TaskFlowApiException)
                {
                    failed.Add($"x \"{item.Title}\": {(ex is TaskFlowApiException apiEx ? ToolGuard.WithGuidance(apiEx) : ex.Message)}");
                    if (ex is ApiUnreachableException)
                    {
                        // The API is too slow: more requests would fail the same way, and a retry blind to this one could duplicate it.
                        failed.AddRange(tasks.Skip(failed.Count + created.Count).Select(t => $"x \"{t.Title}\": not attempted"));
                        break;
                    }
                }
                catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
                {
                    // The API went away mid-batch: report what was created and what was not attempted, so a retry does not duplicate.
                    failed.Add($"x \"{item.Title}\": {(ex is HttpRequestException ? "cannot reach the TaskFlow API" : "request timed out")}");
                    failed.AddRange(tasks.Skip(failed.Count + created.Count).Select(t => $"x \"{t.Title}\": not attempted"));
                    break;
                }
            }

            var report = $"Created {created.Count} of {tasks.Count} task(s){(duplicates > 0 ? $", {duplicates} possible duplicate(s)" : string.Empty)}.\n"
                + string.Join("\n", created.Concat(failed));
            if (duplicateCheckSkipped)
            {
                report += "\nDuplicate check skipped: could not read existing tasks.";
            }

            return created.Count == 0 ? throw new McpException(report) : report;
        });

    private const string SubtaskGoalText = "its goal follows that parent and can't be set directly. Change the parent's goal, or omit goal.";

    /// <summary>
    /// The goal to send on a create. A subtask takes its parent's goal, and the API refuses any goalId on a subtask, so
    /// the goal is omitted when it is the one the parent gives and refused here, before the POST, when it is not.
    /// </summary>
    private async Task<int?> GoalIdForCreateAsync(int? parentTaskId, ProjectDto? project, GoalDto goal, CancellationToken ct)
    {
        if (parentTaskId is not { } parentId)
        {
            return goal.Id;
        }

        TaskItemDto parent;
        try
        {
            parent = await api.GetTaskAsync(parentId, ct);
        }
        catch (TaskFlowApiException)
        {
            return null; // The POST reports a bad parent in its own words.
        }

        if (parent.GoalId == goal.Id && parent.ProjectId == project?.Id)
        {
            return null;
        }

        throw ToolGuard.Invalid($"The new task would be a subtask of #{parentId}, so {SubtaskGoalText} Nothing was created.");
    }

    private static bool IsNone(string? value) => string.Equals(value?.Trim(), "none", StringComparison.OrdinalIgnoreCase);

    private static bool IsBlockedStatus(string? status) =>
        string.Equals(status?.Trim(), "blocked", StringComparison.OrdinalIgnoreCase);

    [McpServerTool(Name = "update_task", Idempotent = true)]
    [Description(
        "Updates a task. Only the fields you pass change; everything else is kept. Use complete=true to finish a task and complete=false to reopen it. "
        + "While the project has a Now goal, a task in a Next or Parked goal cannot be started or completed. "
        + "Set project to a project name/id to assign or move it, or 'none' to remove it from its project. goal puts the task in a goal of its project, or 'none' removes it. "
        + "A project or goal change is saved together with the other fields in one request, and a refusal changes nothing, so the call can simply be corrected and repeated. "
        + "Moving a task to another project resets its goal (inherited from the parent, else none), and a task in no project cannot have a goal. "
        + "dueDate is the deadline (yyyy-MM-dd, today/tomorrow, or 'none' to clear) and does not plan the task. "
        + "journalDate plans the task on a day (today or later); it is not the deadline. Planning is not removed via update (use set_journal_todos). Completed tasks planned on a past day cannot be reopened (the API says so). "
        + "A task with open subtasks (Blocked counts as open) cannot get a journalDate: plan its subtasks instead. A parent's status follows its subtasks, so change the subtasks, not the parent. A completed task cannot be planned onto a different day. "
        + "Start a Todo task with status=inprogress. Only Todo or InProgress tasks can be blocked (use status=blocked with an optional blockedReason). "
        + "status=todo on a Blocked task unblocks it: InProgress is restored only if the goal rule allows it, otherwise the task becomes Todo. On an InProgress task, status=todo moves it back to Todo. Completing a Blocked task clears the block.")]
    public Task<string> UpdateTask(
        [Description(UpdateFieldText.Id)] int id,
        [Description(UpdateFieldText.Title)] string? title = null,
        [Description(UpdateFieldText.Description)] string? description = null,
        [Description(UpdateFieldText.Status)] string? status = null,
        [Description(UpdateFieldText.Priority)] string? priority = null,
        [Description(UpdateFieldText.DueDate)] string? dueDate = null,
        [Description(UpdateFieldText.Project)] string? project = null,
        [Description(UpdateFieldText.Goal)] string? goal = null,
        [Description(UpdateFieldText.ParentTaskId)] int? parentTaskId = null,
        [Description(UpdateFieldText.Complete)] bool? complete = null,
        [Description(UpdateFieldText.BlockedReason)] string? blockedReason = null,
        [Description(UpdateFieldText.JournalDate)] string? journalDate = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var (today, offset) = InputParsing.LocalNow(time);
            var outcome = await UpdateTaskCoreAsync(
                id, title, description, status, priority, dueDate, project, goal, parentTaskId, complete, blockedReason, journalDate, today, offset, ct);
            var summary = outcome.Changes.Count == 0 ? "No changes needed" : "Changed " + string.Join(", ", outcome.Changes);
            return $"Updated #{id}. {summary}.{(outcome.Note is null ? string.Empty : " " + outcome.Note)}\n{Formatting.Task(outcome.Task, today, detailed: true, nowUtc: time.GetUtcNow())}";
        });

    [McpServerTool(Name = "update_tasks", Idempotent = true)]
    [Description(
        "Updates several tasks in one call (up to 25). Use for 2 or more tasks; use update_task for a single task. "
        + "Each item needs the task id and only the fields to change, exactly as in update_task (status, priority, dueDate, journalDate, project, goal, complete, blockedReason...); fields you leave out keep their value. "
        + "While a project has a Now goal, a task in a Next or Parked goal cannot be started or completed; status=todo on a Blocked task then leaves it Todo, not InProgress. "
        + "Items are independent and each is all-or-nothing, project and goal changes included: a failure is reported on its own 'x #id' line, that item changed nothing, and it does not stop the others. Only the 'x' items need a retry. "
        + "Moving a task to another project resets its goal (inherited from the parent, else none). "
        + "A retry of a past-day journalDate failure should change or drop that item's journalDate. "
        + "A task with open subtasks (Blocked counts as open) cannot get a journalDate: plan its subtasks instead. A parent's status follows its subtasks, so change the subtasks, not the parent. A completed task cannot be planned onto a different day. "
        + "If the API cannot be reached, the remaining items are marked 'not attempted'. A task id may appear only once per call.")]
    public Task<string> UpdateTasks(
        [Description("The task updates. Each item: id (required) plus the fields to change.")] IReadOnlyList<TaskUpdate> tasks,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (tasks is null || tasks.Count == 0)
            {
                throw ToolGuard.Invalid("Pass at least one task.");
            }

            if (tasks.Count > MaxBatch)
            {
                throw ToolGuard.Invalid($"Too many tasks ({tasks.Count}). Update at most {MaxBatch} per call; split the rest into another call.");
            }

            var seen = new HashSet<int>();
            foreach (var item in tasks)
            {
                if (!seen.Add(item.Id))
                {
                    throw ToolGuard.Invalid($"Task id {item.Id} appears twice; merge the changes into one item.");
                }
            }

            var (today, offset) = InputParsing.LocalNow(time);
            var lines = new List<string>();
            var updated = 0;
            var stopped = false;

            foreach (var item in tasks)
            {
                if (stopped)
                {
                    lines.Add($"x #{item.Id}: not attempted");
                    continue;
                }

                try
                {
                    var outcome = await UpdateTaskCoreAsync(
                        item.Id, item.Title, item.Description, item.Status, item.Priority, item.DueDate, item.Project, item.Goal, item.ParentTaskId, item.Complete, item.BlockedReason, item.JournalDate, today, offset, ct);
                    var summary = (outcome.Changes.Count == 0 ? "No changes needed" : "Changed " + string.Join(", ", outcome.Changes))
                        + (outcome.Note is null ? string.Empty : ". " + outcome.Note);
                    lines.Add($"+ #{item.Id} \"{Formatting.CleanReason(outcome.Task.Title)}\": {summary}");
                    updated++;
                }
                catch (Exception ex) when (ex is McpException or TaskFlowApiException)
                {
                    var reason = ex is TaskFlowApiException apiEx ? ToolGuard.WithGuidance(apiEx) : ex.Message;
                    lines.Add($"x #{item.Id}: {Formatting.CleanReason(reason)}");
                    stopped = ex is ApiUnreachableException;
                }
                catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
                {
                    // The API is unreachable or too slow: more requests would fail the same way.
                    lines.Add($"x #{item.Id}: {(ex is HttpRequestException ? "cannot reach the TaskFlow API" : "request timed out")}");
                    stopped = true;
                }
            }

            var report = $"Updated {updated} of {tasks.Count} task(s).\n" + string.Join("\n", lines);
            return updated == 0 ? throw new McpException(report) : report;
        });

    private sealed record UpdateOutcome(TaskItemDto Task, List<string> Changes, string? Note = null);

    // No ToolGuard here: callers decide how failures surface (update_task rethrows, update_tasks reports per item).
    private async Task<UpdateOutcome> UpdateTaskCoreAsync(
        int id,
        string? title,
        string? description,
        string? status,
        string? priority,
        string? dueDate,
        string? project,
        string? goal,
        int? parentTaskId,
        bool? complete,
        string? blockedReason,
        string? journalDate,
        DateOnly today,
        int offset,
        CancellationToken ct)
    {
        var existing = await api.GetTaskAsync(id, ct);
        var changes = new List<string>();

        var newStatus = string.IsNullOrWhiteSpace(status) ? existing.Status.ToLowerInvariant() : InputParsing.NormalizeStatus(status);

        if (complete == true)
        {
            newStatus = "completed";
        }
        else if (complete == false && newStatus == "completed")
        {
            newStatus = "todo";
        }

        if (StartBlockedMessage(id, existing.Status, newStatus) is { } startMessage)
        {
            throw ToolGuard.Invalid(startMessage);
        }

        var finalBlocked = newStatus == "blocked";

        var trimmedReason = blockedReason?.Trim();
        if (trimmedReason is { Length: > MaxBlockedReasonLength })
        {
            throw ToolGuard.Invalid($"blockedReason is {trimmedReason.Length} characters; the limit is {MaxBlockedReasonLength}.");
        }

        if (!string.IsNullOrEmpty(trimmedReason) && !finalBlocked)
        {
            throw ToolGuard.Invalid(
                $"blockedReason needs status=blocked. Task #{id} would end as {newStatus}; pass status=blocked with the reason (only Todo or InProgress tasks can be blocked), or omit blockedReason.");
        }

        var newPriority = string.IsNullOrWhiteSpace(priority) ? existing.Priority.ToLowerInvariant() : InputParsing.NormalizePriority(priority);
        var newTitle = string.IsNullOrWhiteSpace(title) ? existing.Title : title.Trim();
        var newDescription = description is null ? existing.Description : (string.IsNullOrWhiteSpace(description) ? null : description);

        DateOnly? newDue = existing.DueDate;
        if (!string.IsNullOrWhiteSpace(dueDate))
        {
            newDue = string.Equals(dueDate.Trim(), "none", StringComparison.OrdinalIgnoreCase)
                ? null
                : InputParsing.ParseDate(dueDate, today, "dueDate");
        }

        var newParent = parentTaskId is null ? existing.ParentTaskItemId : (parentTaskId == 0 ? null : parentTaskId);

        // Null (absent) is sent as null, which leaves the planned day unchanged. Update never un-plans.
        var planDay = InputParsing.ParsePlanDay(journalDate, today, "journalDate");

        AddChange(changes, "title", existing.Title != newTitle);
        AddChange(changes, "description", existing.Description != newDescription);
        var blocking = !existing.IsBlocked && finalBlocked;
        var unblocking = existing.IsBlocked && newStatus == "todo";
        var unblockedIndex = -1;
        if (blocking)
        {
            changes.Add(string.IsNullOrEmpty(trimmedReason) ? "blocked" : $"blocked (reason: \"{Formatting.CleanReason(trimmedReason)}\")");
        }
        else if (unblocking)
        {
            unblockedIndex = changes.Count;
            changes.Add("unblocked");
        }
        else if (existing.IsBlocked && finalBlocked && trimmedReason is not null
            && Formatting.CleanReason(existing.BlockedReason) != Formatting.CleanReason(trimmedReason))
        {
            changes.Add(trimmedReason.Length == 0 ? "blocked reason (cleared)" : "blocked reason");
        }
        else
        {
            AddChange(changes, "status", !finalBlocked && !string.Equals(existing.Status, newStatus, StringComparison.OrdinalIgnoreCase));
        }

        AddChange(changes, "priority", !string.Equals(existing.Priority, newPriority, StringComparison.OrdinalIgnoreCase));
        AddChange(changes, "dueDate", existing.DueDate != newDue);
        AddChange(changes, "parent", existing.ParentTaskItemId != newParent);

        // Resolve the project before anything is written, so an unknown or ambiguous project rejects the whole update.
        // "none" removes the project and needs no lookup. A null target with removeProject false means no project change.
        var removeProject = false;
        ProjectDto? target = null;
        var projectKey = project?.Trim();
        if (!string.IsNullOrEmpty(projectKey))
        {
            if (string.Equals(projectKey, "none", StringComparison.OrdinalIgnoreCase))
            {
                removeProject = true;
            }
            else
            {
                target = await ProjectResolver.ResolveAsync(api, projectKey, ct);
            }
        }

        // The goal is resolved before anything is written, within the project the task will end up in.
        var goalKey = goal?.Trim();
        var removeGoal = IsNone(goalKey);
        GoalDto? targetGoal = null;
        if (!string.IsNullOrEmpty(goalKey) && !removeGoal)
        {
            var goalProjectId = removeProject ? null : target?.Id ?? existing.ProjectId;
            if (goalProjectId is not { } inProject)
            {
                throw ToolGuard.Invalid($"Task #{id} would have no project, and goals belong to a project. Pass project with goal, or omit goal. Nothing was changed.");
            }

            var projectName = target?.Name ?? existing.ProjectName ?? $"#{inProject}";
            targetGoal = GoalResolver.Resolve(await api.GetGoalsAsync(inProject, ct), goalKey, projectName);
        }

        var goalRequested = removeGoal || targetGoal is not null;
        var sendGoal = false;
        if (goalRequested)
        {
            var resultingProject = removeProject ? null : target?.Id ?? existing.ProjectId;
            var projectChanging = removeProject ? existing.ProjectId is not null : target is not null && existing.ProjectId != target.Id;
            sendGoal = await CheckGoalChangeAsync(existing, newParent, resultingProject, projectChanging, targetGoal, ct);
        }

        // PATCH keeps what is left out and clears what is sent as null (the PUT cleared by omission), so each field is
        // written only when this call changes it, and an explicit null only when the user asked to clear.
        var patch = new TaskPatch();
        if (newTitle != existing.Title)
        {
            patch.Set(TaskPatchFields.Title, newTitle);
        }

        if (!string.Equals(existing.Status, newStatus, StringComparison.OrdinalIgnoreCase))
        {
            patch.Set(TaskPatchFields.Status, newStatus);
        }

        if (!string.Equals(existing.Priority, newPriority, StringComparison.OrdinalIgnoreCase))
        {
            patch.Set(TaskPatchFields.Priority, newPriority);
        }

        if (existing.Description != newDescription)
        {
            patch.Set(TaskPatchFields.Description, newDescription);
        }

        if (existing.DueDate != newDue)
        {
            patch.Set(TaskPatchFields.DueDate, newDue);
        }

        if (existing.ParentTaskItemId != newParent)
        {
            patch.Set(TaskPatchFields.ParentTaskItemId, newParent);
        }

        // Omitted keeps the stored reason; "" clears it and the task stays Blocked.
        if (finalBlocked && trimmedReason is not null && trimmedReason != (existing.BlockedReason ?? string.Empty).Trim())
        {
            patch.Set(TaskPatchFields.BlockedReason, trimmedReason);
        }

        // Absent leaves the planned day unchanged. Update never un-plans.
        if (planDay is not null)
        {
            patch.Set(TaskPatchFields.JournalDate, planDay);
        }

        if (removeProject && existing.ProjectId is not null)
        {
            patch.Clear(TaskPatchFields.ProjectId);
        }
        else if (target is not null && existing.ProjectId != target.Id)
        {
            patch.Set(TaskPatchFields.ProjectId, target.Id);
        }

        if (sendGoal)
        {
            if (targetGoal is null)
            {
                patch.Clear(TaskPatchFields.GoalId);
            }
            else
            {
                patch.Set(TaskPatchFields.GoalId, targetGoal.Id);
            }
        }

        // Fields, project and goal travel in one request, so a refusal changes none of them. A call that changes nothing
        // sends nothing.
        var updated = existing;
        if (patch.HasChanges)
        {
            patch.Set(TaskPatchFields.TimezoneOffsetMinutes, offset);
            updated = await ToolGuard.WriteAsync(api, ct, () => api.PatchTaskAsync(id, patch, ct), ToolGuard.PatchTimeoutHint);
        }

        if (unblockedIndex >= 0)
        {
            // The API restores InProgress only when the goal rule allows it, otherwise the task becomes Todo;
            // report what the response says, not a guess.
            changes[unblockedIndex] = $"unblocked (now {updated.Status})";
        }

        // Compared with the task as it was read, so a same-value project or goal is not reported as changed, and a goal
        // that a project move or re-parent reset is.
        if (existing.ProjectId != updated.ProjectId)
        {
            changes.Add(updated.ProjectId is null ? "project (removed)" : $"project -> {updated.ProjectName ?? target?.Name}");
        }

        if (existing.GoalId != updated.GoalId)
        {
            changes.Add(updated.GoalId is null ? "goal (removed)" : $"goal -> {Formatting.CleanReason(updated.GoalTitle)}");
        }

        string? note = null;
        if (planDay is { } day)
        {
            // Report the planned day from confirmed data: the response, or a re-read when it does not carry the day.
            if (updated.CurrentJournalDate != day)
            {
                try
                {
                    updated = await api.GetTaskAsync(id, ct);
                }
                catch (Exception ex) when (ex is TaskFlowApiException or McpException)
                {
                    // The update succeeded; do not turn a failed confirmation into a failed update.
                }
            }

            if (updated.CurrentJournalDate == day)
            {
                if (day != existing.CurrentJournalDate)
                {
                    changes.Add($"planned {day:yyyy-MM-dd}");
                }
            }
            else
            {
                note = $"The update succeeded, but planning on {day:yyyy-MM-dd} could not be confirmed. Check with get_task.";
            }
        }

        return new UpdateOutcome(updated, changes, note);
    }

    /// <summary>
    /// Rejects, before anything is written, a goal change the API would always refuse: a subtask whose goal would differ
    /// from the one its parent gives it (the API refuses any goalId on a subtask, even the inherited one), or a move into
    /// a Done or Dropped goal. Returns whether goalId belongs in the PATCH: it is left out when the goal is the one the
    /// task has now or the one the parent gives.
    /// </summary>
    private async Task<bool> CheckGoalChangeAsync(
        TaskItemDto existing, int? newParent, int? resultingProject, bool projectChanging, GoalDto? goal, CancellationToken ct)
    {
        if (newParent is { } parentId)
        {
            var inherited = existing.GoalId;
            if (existing.ParentTaskItemId != newParent || existing.ProjectId != resultingProject)
            {
                TaskItemDto parent;
                try
                {
                    parent = await api.GetTaskAsync(parentId, ct);
                }
                catch (TaskFlowApiException)
                {
                    return false; // The PATCH reports a bad parent in its own words.
                }

                inherited = parent.ProjectId == resultingProject ? parent.GoalId : null;
            }

            if (goal?.Id != inherited)
            {
                throw ToolGuard.Invalid($"Task #{existing.Id} would be a subtask of #{parentId}, so {SubtaskGoalText} Nothing was changed.");
            }

            return false;
        }

        if (goal is not null && goal.Id != existing.GoalId
            && (string.Equals(goal.Status, "Done", StringComparison.OrdinalIgnoreCase)
                || string.Equals(goal.Status, "Dropped", StringComparison.OrdinalIgnoreCase)))
        {
            throw ToolGuard.Invalid(
                $"Goal {Formatting.GoalLabel(goal)} is {goal.Status}, so a task can't be assigned to it. "
                + "Pick an open goal, or omit goal. Nothing was changed.");
        }

        // A project change resets the goal before the explicit one is judged, so the stored goal is no reason to leave it out.
        return goal?.Id != existing.GoalId || (projectChanging && goal is not null);
    }

    /// <summary>
    /// The one start rule: only Todo tasks can move to InProgress (the API rejects Draft and Completed; Blocked follows the
    /// block rules and is forwarded). Returns a recovery message, or null when the start is allowed or not a start.
    /// </summary>
    private static string? StartBlockedMessage(int id, string existingStatus, string finalStatus)
    {
        if (finalStatus != "inprogress")
        {
            return null;
        }

        if (string.Equals(existingStatus, "Draft", StringComparison.OrdinalIgnoreCase))
        {
            return $"Task #{id} is {existingStatus}, so it can't be started. Only Todo tasks can be started. Set status=todo first, then status=inprogress.";
        }

        if (string.Equals(existingStatus, "Completed", StringComparison.OrdinalIgnoreCase))
        {
            return $"Task #{id} is {existingStatus}, so it can't be started. Reopen it first (complete=false), then set status=inprogress.";
        }

        return null;
    }

    [McpServerTool(Name = "delete_task", Destructive = true)]
    [Description("Permanently deletes a task and its notes. Cannot be undone. Tasks that still have subtasks cannot be deleted (delete or reassign the subtasks first). Confirm with the user before calling.")]
    public Task<string> DeleteTask(
        [Description("Task id.")] int id,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var existing = await api.GetTaskAsync(id, ct);
            await api.DeleteTaskAsync(id, ct);
            return $"Deleted #{id} \"{existing.Title}\".";
        });

    [McpServerTool(Name = "add_task_note")]
    [Description("Adds a note to a task (progress, decisions, links). Max 2000 characters. Notes are append-only here; use get_task to read them.")]
    public Task<string> AddTaskNote(
        [Description("Task id.")] int taskId,
        [Description("Note text (max 2000 characters).")] string content,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (string.IsNullOrWhiteSpace(content))
            {
                throw ToolGuard.Invalid("Note content is required.");
            }

            await api.AddTaskNoteAsync(taskId, content.Trim(), ct);
            return $"Added note to task #{taskId}.";
        });

    private static bool MatchesView(TaskItemDto t, string view, DateOnly today, int dueWithinDays) => view switch
    {
        "all" => true,
        "blocked" => t.IsBlocked,
        "completed" => t.IsDone,
        "open" => !t.IsDone,
        "overdue" => !t.IsDone && t.DueDate < today,
        "due_soon" => !t.IsDone && t.DueDate <= today.AddDays(dueWithinDays),
        "stale" => !t.IsDone && IsStale(t),
        "unassigned" => !t.IsDone && t.ProjectId is null,
        "today" => !t.IsDone && t.CurrentJournalDate == today,
        _ => false,
    };

    private static void AddChange(List<string> changes, string name, bool changed)
    {
        if (changed)
        {
            changes.Add(name);
        }
    }

    private string LocalDate(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), time.LocalTimeZone).ToString("yyyy-MM-dd");
}
