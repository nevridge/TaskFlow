using System.ComponentModel;
using System.Net;
using System.Text;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

[McpServerToolType]
public sealed class JournalTools(TaskFlowApiClient api, TimeProvider time)
{
    [McpServerTool(Name = "get_journal")]
    [Description(
        "Shows the daily journal for a date: summary, the tasks planned for that day, log entries and notes. Defaults to today. "
        + "Creates the day's journal entry if it does not exist yet (the journal always has one entry per day), so calling it for today is safe. Use it to start planning a day. "
        + "Each planned task lists its open subtasks (id, title, status) beneath it; completed subtasks are hidden. "
        + "Subtasks are listed only under planned parents; use list_tasks to find subtasks of tasks that are not planned.")]
    public Task<string> GetJournal(
        [Description("yyyy-MM-dd, today, tomorrow or yesterday. Default today.")] string? date = null,
        [Description("concise (default) or detailed (adds descriptions and journal info to planned tasks).")] string responseFormat = "concise",
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var (today, offset) = InputParsing.LocalNow(time);
            var day = InputParsing.ParseDateOrToday(date, today, "date");
            var entry = await JournalResolver.EnsureAsync(api, day, offset, ct);

            var todosTask = api.GetJournalTodosAsync(entry.Id, ct);
            var notesTask = api.GetJournalNotesAsync(entry.Id, ct);
            var allTasksTask = LoadAllTasksAsync(ct);
            await Task.WhenAll(todosTask, notesTask, allTasksTask);

            var detailed = Formatting.IsDetailed(responseFormat);
            var sb = new StringBuilder();
            sb.AppendLine($"Journal {day:yyyy-MM-dd} (entry #{entry.Id}){(day == today ? " - today" : string.Empty)}");
            sb.AppendLine(string.IsNullOrWhiteSpace(entry.Summary) ? "Summary: (none)" : "Summary: " + entry.Summary.Trim());

            var todos = Formatting.OrderByUrgency(await todosTask).ToList();
            sb.AppendLine(todos.Count == 0 ? "Planned tasks: none" : $"Planned tasks ({todos.Count}):");
            if (todos.Count > 0)
            {
                var nowUtc = time.GetUtcNow();
                var plannedIds = todos.Select(t => t.Id).ToHashSet();
                var (allTasks, failure) = await allTasksTask;
                var subtasks = allTasks is null ? null : Formatting.OpenSubtasksByParent(allTasks);
                var marker = day == today ? " | planned today" : " | planned this day";
                foreach (var task in todos)
                {
                    sb.AppendLine("  " + Formatting.Task(task, today, detailed, nowUtc, showChildCount: subtasks is null));
                    if (subtasks is null)
                    {
                        continue;
                    }

                    var open = Formatting.OrderByUrgency(subtasks[task.Id]).ToList();
                    if (open.Count == 0)
                    {
                        continue;
                    }

                    sb.AppendLine($"    Open subtasks ({open.Count}):");
                    foreach (var sub in open)
                    {
                        sb.Append($"      - #{sub.Id} [{sub.Status}] {sub.Title}");
                        if (detailed && sub.IsBlocked)
                        {
                            sb.Append(" | ").Append(Formatting.BlockedLabel(sub, nowUtc));
                        }

                        if (plannedIds.Contains(sub.Id))
                        {
                            sb.Append(marker);
                        }

                        sb.AppendLine();
                    }
                }

                if (failure is not null)
                {
                    sb.AppendLine($"Note: open subtasks could not be loaded ({failure}); call list_tasks to see them.");
                }
            }

            var logs = entry.LogEntries.OrderBy(l => l.CreatedAt).ToList();
            if (logs.Count > 0)
            {
                sb.AppendLine($"Log ({logs.Count}):");
                foreach (var log in logs)
                {
                    var link = log.TaskItemId is { } taskId
                        ? $" [task #{taskId}{(log.LinkedTaskDeleted ? ", deleted" : string.Empty)}]"
                        : string.Empty;
                    sb.AppendLine($"  {LocalTime(log.CreatedAt)} {Formatting.Preview(log.Content, 400)}{link}");
                }
            }

            var notes = notesTask.Result.OrderBy(n => n.CreatedAt).ToList();
            if (notes.Count > 0)
            {
                sb.AppendLine($"Notes ({notes.Count}):");
                foreach (var note in notes)
                {
                    sb.AppendLine("  - " + Formatting.Preview(note.Content, 400));
                }
            }

            return sb.ToString().TrimEnd();
        });

    [McpServerTool(Name = "set_journal_todos")]
    [Description(
        "Plans a day: adds existing tasks to a day's journal and/or removes them. Use after the user confirms what to focus on. "
        + "Tasks are linked, not copied, and the API rejects planning onto a past day. Removing a task also removes its subtasks from that day.")]
    public Task<string> SetJournalTodos(
        [Description("Task ids to plan for the day.")] IReadOnlyList<int>? add = null,
        [Description("Task ids to remove from the day.")] IReadOnlyList<int>? remove = null,
        [Description("yyyy-MM-dd, today, tomorrow or yesterday. Default today.")] string? date = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var toAdd = add?.Distinct().ToList() ?? [];
            var toRemove = remove?.Distinct().ToList() ?? [];
            if (toAdd.Count == 0 && toRemove.Count == 0)
            {
                throw ToolGuard.Invalid("Pass task ids in 'add' and/or 'remove'.");
            }

            var (today, offset) = InputParsing.LocalNow(time);
            var day = InputParsing.ParseDateOrToday(date, today, "date");
            var entry = toAdd.Count > 0
                ? await JournalResolver.EnsureAsync(api, day, offset, ct)
                : await JournalResolver.FindAsync(api, day, ct)
                    ?? throw ToolGuard.Invalid($"There is no journal entry for {day:yyyy-MM-dd}, so nothing can be removed.");

            var titles = (await api.GetTasksAsync(ct)).ToDictionary(t => t.Id, t => t.Title);
            string Label(int id) => titles.TryGetValue(id, out var title) ? $"#{id} {title}" : $"#{id}";

            var results = new List<string>();
            var succeeded = 0;

            foreach (var id in toAdd)
            {
                try
                {
                    await api.AddJournalTodoAsync(entry.Id, id, offset, ct);
                    results.Add($"+ {Label(id)} planned for {day:yyyy-MM-dd}");
                    succeeded++;
                }
                catch (TaskFlowApiException ex) when (ex.Status == HttpStatusCode.Conflict)
                {
                    results.Add($"= {Label(id)} was already planned for {day:yyyy-MM-dd}");
                    succeeded++;
                }
                catch (TaskFlowApiException ex)
                {
                    results.Add($"x {Label(id)}: {ex.Message}");
                }
            }

            foreach (var id in toRemove)
            {
                try
                {
                    await api.RemoveJournalTodoAsync(entry.Id, id, ct);
                    results.Add($"- {Label(id)} removed from {day:yyyy-MM-dd}");
                    succeeded++;
                }
                catch (TaskFlowApiException ex)
                {
                    results.Add($"x {Label(id)}: {ex.Message}");
                }
            }

            var report = $"Journal {day:yyyy-MM-dd}:\n" + string.Join("\n", results);
            return succeeded == 0 ? throw new McpException(report) : report;
        });

    [McpServerTool(Name = "add_log_entry")]
    [Description("Adds a timestamped log line to a day's journal (what happened, progress, blockers), optionally linked to a task. Defaults to today and creates the day's entry if needed. Max 2000 characters. To record that a task is waiting on someone, use update_task status=blocked instead.")]
    public Task<string> AddLogEntry(
        [Description("What to log (max 2000 characters).")] string content,
        [Description("Task id to link this log line to, if it is about a specific task.")] int? taskId = null,
        [Description("yyyy-MM-dd, today, tomorrow or yesterday. Default today.")] string? date = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (string.IsNullOrWhiteSpace(content))
            {
                throw ToolGuard.Invalid("Log content is required.");
            }

            var (today, offset) = InputParsing.LocalNow(time);
            var day = InputParsing.ParseDateOrToday(date, today, "date");
            var entry = await JournalResolver.EnsureAsync(api, day, offset, ct);
            var log = await api.AddLogEntryAsync(entry.Id, content.Trim(), taskId, ct);

            return $"Logged on {day:yyyy-MM-dd}{(log.TaskItemId is { } id ? $" (linked to task #{id}{(log.LinkedTaskTitle is null ? string.Empty : $" {log.LinkedTaskTitle}")})" : string.Empty)}: {Formatting.Preview(log.Content, 200)}";
        });

    [McpServerTool(Name = "update_journal")]
    [Description("Updates a day's journal: replaces its summary text and/or adds a note. Pass at least one of summary or note. The summary REPLACES the existing one (read it with get_journal first if you want to extend it); notes are appended. Defaults to today.")]
    public Task<string> UpdateJournal(
        [Description("New summary text (max 10000 characters). Replaces the current summary.")] string? summary = null,
        [Description("A note to append (max 2000 characters).")] string? note = null,
        [Description("yyyy-MM-dd, today, tomorrow or yesterday. Default today.")] string? date = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (summary is null && string.IsNullOrWhiteSpace(note))
            {
                throw ToolGuard.Invalid("Pass 'summary' and/or 'note'.");
            }

            var (today, offset) = InputParsing.LocalNow(time);
            var day = InputParsing.ParseDateOrToday(date, today, "date");
            var entry = await JournalResolver.EnsureAsync(api, day, offset, ct);
            var done = new List<string>();

            if (summary is not null)
            {
                await api.UpdateJournalEntryAsync(entry.Id, entry.Title, summary, ct);
                done.Add("summary replaced");
            }

            if (!string.IsNullOrWhiteSpace(note))
            {
                await api.AddJournalNoteAsync(entry.Id, note.Trim(), ct);
                done.Add("note added");
            }

            return $"Journal {day:yyyy-MM-dd}: {string.Join(", ", done)}.";
        });

    // Subtask enrichment is optional: API failures degrade the journal instead of failing it.
    // Cancellation and McpException are deliberately not caught.
    private async Task<(List<TaskItemDto>? Tasks, string? Failure)> LoadAllTasksAsync(CancellationToken ct)
    {
        try
        {
            return (await api.GetTasksAsync(ct), null);
        }
        catch (Exception ex) when (ex is TaskFlowApiException or HttpRequestException)
        {
            return (null, Formatting.CleanReason(ex.Message));
        }
    }

    private string LocalTime(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), time.LocalTimeZone).ToString("HH:mm");
}
