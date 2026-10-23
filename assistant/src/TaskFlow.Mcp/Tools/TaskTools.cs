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

    [Description("draft or todo (default todo). Tasks cannot be created as blocked: create the task, then call update_task with status=blocked.")]
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
        + "Results are paged (default 25); follow the 'Next page' hint for more. Use responseFormat=detailed to include descriptions and journal info.")]
    public Task<string> ListTasks(
        [Description("open, all, completed, overdue, due_soon, stale, unassigned, today or blocked (Blocked status only). Blocked tasks still appear in the other open views and are flagged. Default open.")] string view = "open",
        [Description("Only tasks in this project (name or id).")] string? project = null,
        [Description("Only this status: draft, todo, blocked or completed.")] string? status = null,
        [Description("Only this priority: low, medium or high.")] string? priority = null,
        [Description("For view=due_soon: how many days ahead to include. Default 7.")] int dueWithinDays = 7,
        [Description("Page size, 1-100. Default 25.")] int limit = 25,
        [Description("Number of results to skip, for paging. Default 0.")] int offset = 0,
        [Description("concise (default) or detailed.")] string responseFormat = "concise",
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var normalizedView = (view ?? "open").Trim().ToLowerInvariant();
            if (!Views.Contains(normalizedView))
            {
                throw ToolGuard.Invalid($"Invalid view '{view}'. Allowed values: {string.Join(", ", Views)}.");
            }

            var today = InputParsing.Today(time);
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
                return $"No tasks match ({label}).";
            }

            if (page.Count == 0)
            {
                return $"{ordered.Count} task(s) match ({label}), but offset {skip} is past the end.";
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

            return sb.ToString().TrimEnd();
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
        + "Tasks cannot be created as blocked: create the task, then call update_task with status=blocked.")]
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

            var today = InputParsing.Today(time);
            var offsetMinutes = InputParsing.OffsetMinutes(time);
            IReadOnlyList<ProjectDto>? projects = null;

            var created = new List<string>();
            var failed = new List<string>();

            foreach (var item in tasks)
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(item.Title))
                    {
                        throw ToolGuard.Invalid("Title is required.");
                    }

                    if (string.Equals(item.Status?.Trim(), "blocked", StringComparison.OrdinalIgnoreCase))
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
                        string.IsNullOrWhiteSpace(item.DueDate) ? null : InputParsing.ToDueDateTime(InputParsing.ParseDate(item.DueDate, today, "dueDate")),
                        string.IsNullOrWhiteSpace(item.JournalDate) ? null : InputParsing.ParseDate(item.JournalDate, today, "journalDate"),
                        item.ParentTaskId,
                        projectId,
                        offsetMinutes);

                    var task = await api.CreateTaskAsync(request, ct);
                    created.Add("+ " + Formatting.Task(task, today, nowUtc: time.GetUtcNow()));
                }
                catch (Exception ex) when (ex is McpException or TaskFlowApiException)
                {
                    failed.Add($"x \"{item.Title}\": {ex.Message}");
                }
            }

            var report = $"Created {created.Count} of {tasks.Count} task(s).\n" + string.Join("\n", created.Concat(failed));
            return created.Count == 0 ? throw new McpException(report) : report;
        });

    [McpServerTool(Name = "update_task", Idempotent = true)]
    [Description(
        "Updates a task. Only the fields you pass change; everything else is kept. Use complete=true to finish a task and complete=false to reopen it. "
        + "Set project to a project name/id to assign or move it, or 'none' to remove it from its project. "
        + "dueDate accepts yyyy-MM-dd, today/tomorrow, or 'none' to clear. Completed tasks planned on a past day cannot be reopened (the API says so). "
        + "Only Todo tasks can be blocked (use status=blocked with an optional blockedReason). status=todo unblocks a Blocked task. Completing a Blocked task clears the block.")]
    public Task<string> UpdateTask(
        [Description("Task id.")] int id,
        [Description("New title (max 100 characters).")] string? title = null,
        [Description("New description. Pass an empty string to clear it.")] string? description = null,
        [Description("draft, todo, blocked or completed.")] string? status = null,
        [Description("low, medium or high.")] string? priority = null,
        [Description("yyyy-MM-dd, today/tomorrow, or 'none' to clear the due date.")] string? dueDate = null,
        [Description("Project name or id to assign, or 'none' to remove the task from its project.")] string? project = null,
        [Description("Parent task id to make this a subtask; 0 removes the parent. Only one subtask level is supported.")] int? parentTaskId = null,
        [Description("true to mark complete, false to reopen.")] bool? complete = null,
        [Description("Reason the task is blocked (max 200 characters). Only valid with status=blocked on a Todo task or a task that is already Blocked. Pass an empty string to clear the reason (the task stays Blocked). Omit to keep the stored reason.")] string? blockedReason = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var today = InputParsing.Today(time);
            var existing = await api.GetTaskAsync(id, ct);
            var changes = new List<string>();

            var newStatus = string.IsNullOrWhiteSpace(status) ? existing.Status.ToLowerInvariant() : InputParsing.NormalizeStatus(status);
            var statusGiven = !string.IsNullOrWhiteSpace(status);
            var isComplete = existing.IsComplete;

            if (complete == true)
            {
                isComplete = true;
                newStatus = "completed";
            }
            else if (complete == false)
            {
                isComplete = false;
                if (newStatus == "completed")
                {
                    newStatus = "todo";
                }
            }
            else if (statusGiven)
            {
                isComplete = newStatus == "completed";
            }

            var finalBlocked = newStatus == "blocked";
            if (finalBlocked)
            {
                isComplete = false;
            }

            var trimmedReason = blockedReason?.Trim();
            if (trimmedReason is { Length: > MaxBlockedReasonLength })
            {
                throw ToolGuard.Invalid($"blockedReason is {trimmedReason.Length} characters; the limit is {MaxBlockedReasonLength}.");
            }

            if (!string.IsNullOrEmpty(trimmedReason) && !finalBlocked)
            {
                throw ToolGuard.Invalid(
                    $"blockedReason needs status=blocked. Task #{id} would end as {newStatus}; pass status=blocked with the reason (only Todo tasks can be blocked), or omit blockedReason.");
            }

            // Omitted keeps the stored reason (null on the PUT); "" clears it and the task stays Blocked.
            var requestReason = trimmedReason is null || !finalBlocked ? null : trimmedReason;

            var newPriority = string.IsNullOrWhiteSpace(priority) ? existing.Priority.ToLowerInvariant() : InputParsing.NormalizePriority(priority);
            var newTitle = string.IsNullOrWhiteSpace(title) ? existing.Title : title.Trim();
            var newDescription = description is null ? existing.Description : (string.IsNullOrWhiteSpace(description) ? null : description);

            DateTime? newDue = existing.DueDate;
            if (!string.IsNullOrWhiteSpace(dueDate))
            {
                newDue = string.Equals(dueDate.Trim(), "none", StringComparison.OrdinalIgnoreCase)
                    ? null
                    : InputParsing.ToDueDateTime(InputParsing.ParseDate(dueDate, today, "dueDate"));
            }

            var newParent = parentTaskId is null ? existing.ParentTaskItemId : (parentTaskId == 0 ? null : parentTaskId);

            AddChange(changes, "title", existing.Title != newTitle);
            AddChange(changes, "description", existing.Description != newDescription);
            var blocking = !existing.IsBlocked && finalBlocked;
            var unblocking = existing.IsBlocked && newStatus == "todo";
            if (blocking)
            {
                changes.Add(string.IsNullOrEmpty(trimmedReason) ? "blocked" : $"blocked (reason: \"{Formatting.CleanReason(trimmedReason)}\")");
            }
            else if (unblocking)
            {
                changes.Add("unblocked");
            }
            else if (existing.IsBlocked && finalBlocked && trimmedReason is not null
                && Formatting.CleanReason(existing.BlockedReason) != Formatting.CleanReason(trimmedReason))
            {
                changes.Add(trimmedReason.Length == 0 ? "blocked reason (cleared)" : "blocked reason");
            }
            else
            {
                AddChange(changes, "status", !finalBlocked && (!string.Equals(existing.Status, newStatus, StringComparison.OrdinalIgnoreCase) || existing.IsComplete != isComplete));
            }

            AddChange(changes, "priority", !string.Equals(existing.Priority, newPriority, StringComparison.OrdinalIgnoreCase));
            AddChange(changes, "dueDate", existing.DueOn != (newDue is { } d ? DateOnly.FromDateTime(d) : null));
            AddChange(changes, "parent", existing.ParentTaskItemId != newParent);

            var request = new UpdateTaskRequest(
                newTitle,
                newDescription,
                newStatus,
                newPriority,
                isComplete,
                newDue,
                newParent,
                AutoCompleteParentWhenChildrenDone: false,
                InputParsing.OffsetMinutes(time),
                requestReason);

            var updated = await api.UpdateTaskAsync(id, request, ct);

            if (!string.IsNullOrWhiteSpace(project))
            {
                if (string.Equals(project.Trim(), "none", StringComparison.OrdinalIgnoreCase))
                {
                    if (existing.ProjectId is { } current)
                    {
                        await api.UnassignTaskFromProjectAsync(current, id, ct);
                        changes.Add("project (removed)");
                        updated = await api.GetTaskAsync(id, ct);
                    }
                }
                else
                {
                    var target = await ProjectResolver.ResolveAsync(api, project, ct);
                    if (existing.ProjectId != target.Id)
                    {
                        await AssignAsync(target.Id, id, ct);
                        changes.Add($"project -> {target.Name}");
                        updated = await api.GetTaskAsync(id, ct);
                    }
                }
            }

            var summary = changes.Count == 0 ? "No changes needed" : "Changed " + string.Join(", ", changes);
            return $"Updated #{id}. {summary}.\n{Formatting.Task(updated, today, detailed: true, nowUtc: time.GetUtcNow())}";
        });

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
        "overdue" => !t.IsDone && t.DueOn < today,
        "due_soon" => !t.IsDone && t.DueOn <= today.AddDays(dueWithinDays),
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
