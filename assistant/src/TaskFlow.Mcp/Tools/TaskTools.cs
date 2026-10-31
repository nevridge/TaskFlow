using System.ComponentModel;
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
        + "Only Todo or InProgress tasks can be blocked. status=todo on a Blocked task unblocks it and restores its previous status (Todo or InProgress); on an InProgress task it moves it back to Todo. "
        + "Completing a Blocked task clears the block.";
    public const string Priority = "low, medium or high.";
    public const string DueDate = "The deadline: yyyy-MM-dd, today/tomorrow, or 'none' to clear the due date. Separate from journalDate; it does not plan the task.";
    public const string Project = "Project name or id to assign, or 'none' to remove the task from its project.";
    public const string ParentTaskId = "Parent task id to make this a subtask; 0 removes the parent. Only one subtask level is supported.";
    public const string Complete = "true to mark complete, false to reopen.";
    public const string JournalDate = "Plans the task on this day: today, tomorrow or yyyy-MM-dd, and the day must be today or later. "
        + "Omit to leave the planned day unchanged (empty or whitespace counts as omitted). Planning cannot be cleared via update; use set_journal_todos. "
        + "Not the deadline (that is dueDate). Planning a parent task does not plan its subtasks.";
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

            var tasks = await api.GetTasksAsync(ct);

            IEnumerable<TaskItemDto> query = tasks.Where(t => MatchesView(t, normalizedView, today, Math.Max(dueWithinDays, 0)));

            var filters = new List<string>();
            if (!string.IsNullOrWhiteSpace(project))
            {
                var resolved = await ProjectResolver.ResolveAsync(api, project, ct);
                query = query.Where(t => t.ProjectId == resolved.Id);
                filters.Add($"project={resolved.Name}");
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
    [Description("Gets everything about one task: fields, project, notes and recent history (created, moved between days, blocked, completed...). For a Blocked task it shows the reason, (Nd) days blocked (<1d if under a day) and when it was blocked. Use before updating a task or when the user asks what happened with it.")]
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

                    int? projectId = null;
                    if (!string.IsNullOrWhiteSpace(item.Project))
                    {
                        projects ??= await api.GetProjectsAsync(ct);
                        projectId = ProjectResolver.Resolve(projects, item.Project).Id;
                    }

                    var request = new CreateTaskRequest(
                        item.Title.Trim(),
                        item.Description,
                        InputParsing.NormalizeStatus(item.Status ?? "todo"),
                        InputParsing.NormalizePriority(item.Priority ?? "low"),
                        string.IsNullOrWhiteSpace(item.DueDate) ? null : InputParsing.ParseDate(item.DueDate, today, "dueDate"),
                        string.IsNullOrWhiteSpace(item.JournalDate) ? null : InputParsing.ParseDate(item.JournalDate, today, "journalDate"),
                        item.ParentTaskId,
                        projectId,
                        offset);

                    var task = await api.CreateTaskAsync(request, ct);
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
                    failed.Add($"x \"{item.Title}\": {ex.Message}");
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

    private static bool IsBlockedStatus(string? status) =>
        string.Equals(status?.Trim(), "blocked", StringComparison.OrdinalIgnoreCase);

    [McpServerTool(Name = "update_task", Idempotent = true)]
    [Description(
        "Updates a task. Only the fields you pass change; everything else is kept. Use complete=true to finish a task and complete=false to reopen it. "
        + "Set project to a project name/id to assign or move it, or 'none' to remove it from its project. "
        + "dueDate is the deadline (yyyy-MM-dd, today/tomorrow, or 'none' to clear) and does not plan the task. "
        + "journalDate plans the task on a day (today or later); it is not the deadline. Planning is not removed via update (use set_journal_todos). Completed tasks planned on a past day cannot be reopened (the API says so). "
        + "Start a Todo task with status=inprogress. Only Todo or InProgress tasks can be blocked (use status=blocked with an optional blockedReason). "
        + "status=todo on a Blocked task unblocks it and restores its previous status (Todo or InProgress); on an InProgress task it moves it back to Todo. Completing a Blocked task clears the block.")]
    public Task<string> UpdateTask(
        [Description(UpdateFieldText.Id)] int id,
        [Description(UpdateFieldText.Title)] string? title = null,
        [Description(UpdateFieldText.Description)] string? description = null,
        [Description(UpdateFieldText.Status)] string? status = null,
        [Description(UpdateFieldText.Priority)] string? priority = null,
        [Description(UpdateFieldText.DueDate)] string? dueDate = null,
        [Description(UpdateFieldText.Project)] string? project = null,
        [Description(UpdateFieldText.ParentTaskId)] int? parentTaskId = null,
        [Description(UpdateFieldText.Complete)] bool? complete = null,
        [Description(UpdateFieldText.BlockedReason)] string? blockedReason = null,
        [Description(UpdateFieldText.JournalDate)] string? journalDate = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var (today, offset) = InputParsing.LocalNow(time);
            var outcome = await UpdateTaskCoreAsync(
                id, title, description, status, priority, dueDate, project, parentTaskId, complete, blockedReason, journalDate, today, offset, ct);
            var summary = outcome.Changes.Count == 0 ? "No changes needed" : "Changed " + string.Join(", ", outcome.Changes);
            return $"Updated #{id}. {summary}.{(outcome.Note is null ? string.Empty : " " + outcome.Note)}\n{Formatting.Task(outcome.Task, today, detailed: true, nowUtc: time.GetUtcNow())}";
        });

    [McpServerTool(Name = "update_tasks", Idempotent = true)]
    [Description(
        "Updates several tasks in one call (up to 25). Use for 2 or more tasks; use update_task for a single task. "
        + "Each item needs the task id and only the fields to change, exactly as in update_task (status, priority, dueDate, journalDate, project, complete, blockedReason...); fields you leave out keep their value. "
        + "Items are independent: a failure is reported on its own 'x #id' line and does not stop the others. Retry only the 'x' items; "
        + "a retry of a past-day journalDate failure should change or drop that item's journalDate. "
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
                        item.Id, item.Title, item.Description, item.Status, item.Priority, item.DueDate, item.Project, item.ParentTaskId, item.Complete, item.BlockedReason, item.JournalDate, today, offset, ct);
                    var summary = (outcome.Changes.Count == 0 ? "No changes needed" : "Changed " + string.Join(", ", outcome.Changes))
                        + (outcome.Note is null ? string.Empty : ". " + outcome.Note);
                    lines.Add($"+ #{item.Id} \"{Formatting.CleanReason(outcome.Task.Title)}\": {summary}");
                    updated++;
                }
                catch (Exception ex) when (ex is McpException or TaskFlowApiException)
                {
                    var reason = ex is TaskFlowApiException apiEx ? ToolGuard.WithGuidance(apiEx) : ex.Message;
                    lines.Add($"x #{item.Id}: {Formatting.CleanReason(reason)}");
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

        // Omitted keeps the stored reason (null on the PUT); "" clears it and the task stays Blocked.
        var requestReason = trimmedReason is null || !finalBlocked ? null : trimmedReason;

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

        var request = new UpdateTaskRequest(
            newTitle,
            newDescription,
            newStatus,
            newPriority,
            newDue,
            newParent,
            AutoCompleteParentWhenChildrenDone: false,
            offset,
            requestReason,
            JournalDate: planDay);

        var updated = await api.UpdateTaskAsync(id, request, ct);

        if (unblockedIndex >= 0)
        {
            // The API restores the previous status (Todo or InProgress); report what the PUT response says, not a guess.
            changes[unblockedIndex] = $"unblocked (now {updated.Status})";
        }

        // The project step runs after the PUT. When it fails after the PUT already planned the task, say so.
        var refreshed = false;
        if (!string.IsNullOrWhiteSpace(project))
        {
            try
            {
                var reloaded = await ApplyProjectAsync(project, existing, id, changes, ct);
                if (reloaded is not null)
                {
                    updated = reloaded;
                    refreshed = true;
                }
            }
            catch (Exception ex) when (planDay is not null && (ex is TaskFlowApiException or McpException))
            {
                var reason = ex is TaskFlowApiException apiEx ? ToolGuard.WithGuidance(apiEx) : ex.Message;
                var action = string.Equals(project.Trim(), "none", StringComparison.OrdinalIgnoreCase)
                    ? "removing it from its project"
                    : $"assigning it to project '{project.Trim()}'";
                throw new McpException(
                    $"Task #{id} was updated and planned for {planDay:yyyy-MM-dd}, but {action} failed: {reason}. Retry only the project change.",
                    ex);
            }
        }

        string? note = null;
        if (planDay is { } day)
        {
            // Report the planned day from confirmed data: the PUT response, or a re-read when it does not carry the day.
            if (updated.CurrentJournalDate != day && !refreshed)
            {
                try
                {
                    updated = await api.GetTaskAsync(id, ct);
                }
                catch (Exception ex) when (ex is TaskFlowApiException or McpException)
                {
                    // The PUT succeeded; do not turn a failed confirmation into a failed update.
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

    // Returns the re-read task when the project changed, otherwise null.
    private async Task<TaskItemDto?> ApplyProjectAsync(string project, TaskItemDto existing, int id, List<string> changes, CancellationToken ct)
    {
        if (string.Equals(project.Trim(), "none", StringComparison.OrdinalIgnoreCase))
        {
            if (existing.ProjectId is { } current)
            {
                await api.UnassignTaskFromProjectAsync(current, id, ct);
                changes.Add("project (removed)");
                return await api.GetTaskAsync(id, ct);
            }

            return null;
        }

        var target = await ProjectResolver.ResolveAsync(api, project, ct);
        if (existing.ProjectId != target.Id)
        {
            await AssignAsync(target.Id, id, ct);
            changes.Add($"project -> {target.Name}");
            return await api.GetTaskAsync(id, ct);
        }

        return null;
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

    private async Task AssignAsync(int projectId, int taskId, CancellationToken ct)
    {
        try
        {
            await api.AssignTaskToProjectAsync(projectId, taskId, ct);
        }
        catch (TaskFlowApiException ex) when (ex.Status == HttpStatusCode.Conflict)
        {
            // Already in the project: nothing to do.
        }
    }

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
