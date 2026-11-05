using System.ComponentModel;
using System.Net;
using System.Text;
using System.Text.Json;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

[McpServerToolType]
public sealed class JournalTools(TaskFlowApiClient api, TimeProvider time)
{
    // Summary limit of the API, in UTF-16 code units (string.Length).
    private const int MaxSummaryLength = 10000;

    [McpServerTool(Name = "get_journal")]
    [Description(
        "Shows the daily journal for a date: summary, the tasks planned for that day, log entries and notes. Defaults to today. "
        + "Creates the day's journal entry if it does not exist yet (the journal always has one entry per day), so calling it for today is safe. Use it to start planning a day. "
        + "Lists the day's rows. A parent with an open subtask row that day appears as a 'Context' line and is not counted as a planned task; a subtask whose parent is not planned that day appears under a context line built from the parent's title. "
        + "Subtasks that are not planned that day are not shown; use list_tasks to find them.")]
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

            var (allTasks, failure) = await allTasksTask;
            Dictionary<int, TaskItemDto>? tasksById = null;
            if (allTasks is not null)
            {
                tasksById = [];
                foreach (var t in allTasks)
                {
                    tasksById.TryAdd(t.Id, t);
                }
            }

            var rows = Formatting.OrderByUrgency(await todosTask).ToList();
            var position = new Dictionary<int, int>();
            for (var i = 0; i < rows.Count; i++)
            {
                position.TryAdd(rows[i].Id, i);
            }

            var rowIds = position.Keys.ToHashSet();
            var subtaskRows = rows.Where(r => r.ParentTaskItemId is { }).ToLookup(r => r.ParentTaskItemId is { } pid ? pid : 0);

            // A parent is context (not counted) while at least one of its subtask rows that day is open.
            var contextParentIds = subtaskRows.Where(g => g.Any(s => !s.IsDone)).Select(g => g.Key).ToHashSet();
            var contextRowCount = contextParentIds.Count(rowIds.Contains);
            var plannedCount = rows.Count - contextRowCount;

            sb.AppendLine(rows.Count == 0 ? "Planned tasks: none" : $"Planned tasks ({plannedCount}):");
            if (rows.Count > 0)
            {
                var nowUtc = time.GetUtcNow();

                // Subtask rows with a parent that is a row or a context header render nested; everything else is top level.
                bool IsNested(TaskItemDto r) => r.ParentTaskItemId is { } pid && (rowIds.Contains(pid) || contextParentIds.Contains(pid));

                string Line(TaskItemDto t, bool showChildCount) => Formatting.Task(t, today, detailed, nowUtc, showChildCount);

                var units = new List<(int Position, Action Render)>();
                foreach (var row in rows)
                {
                    if (IsNested(row) || contextParentIds.Contains(row.Id))
                    {
                        continue;
                    }

                    var captured = row;
                    units.Add((position[row.Id], () =>
                    {
                        var nested = subtaskRows[captured.Id].ToList();
                        sb.AppendLine("  " + Line(captured, captured.OpenChildCount > 0 && nested.Count == 0));
                        foreach (var sub in nested)
                        {
                            sb.AppendLine("    " + Line(sub, sub.OpenChildCount > 0));
                        }
                    }
                    ));
                }

                foreach (var parentId in contextParentIds)
                {
                    var subs = subtaskRows[parentId].ToList();
                    var first = subs.Min(s => position[s.Id]);
                    units.Add((first, () =>
                    {
                        var parentRow = rows.FirstOrDefault(r => r.Id == parentId);
                        var title = parentRow?.Title ?? subs.Select(s => s.ParentTitle).FirstOrDefault(t => !string.IsNullOrWhiteSpace(t));
                        var label = string.IsNullOrWhiteSpace(title) ? $"#{parentId}" : $"#{parentId} {title.Trim()}";
                        sb.AppendLine($"  Context: {label} (not counted)");
                        foreach (var sub in subs)
                        {
                            sb.AppendLine("    " + Line(sub, sub.OpenChildCount > 0));
                        }
                    }
                    ));
                }

                foreach (var unit in units.OrderBy(u => u.Position))
                {
                    unit.Render();
                }
            }

            var logs = entry.LogEntries.OrderBy(l => l.CreatedAt).ToList();
            if (logs.Count > 0)
            {
                sb.AppendLine($"Log ({logs.Count}):");
                foreach (var log in logs)
                {
                    sb.AppendLine($"  {LocalTime(log.CreatedAt)} {Formatting.Preview(log.Content, 400)}{Formatting.LogTaskLink(log, tasksById)}");
                }

                if (failure is not null && logs.Any(l => l.TaskItemId is not null))
                {
                    sb.AppendLine($"Note: task details unavailable for linked log lines ({failure}).");
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
        + "Tasks are linked, not copied, and the API rejects planning onto a past day. "
        + "A task with open subtasks cannot be planned (Blocked counts as open): plan its subtasks instead. A completed task cannot be planned onto a different day.")]
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
                    results.Add($"x {Label(id)}: {ToolGuard.WithGuidance(ex)}");
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
                    results.Add($"x {Label(id)}: {ToolGuard.WithGuidance(ex)}");
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
    [Description(
        "Updates a day's journal: changes its summary text and/or adds a note. Pass at least one of summary or note. "
        + "The summary REPLACES the whole existing summary unless append=true, which adds it after a blank line (no need to read the entry first). "
        + "append=true is not idempotent: a retried call adds the text twice, so check with get_journal before retrying. Notes are always appended. Defaults to today.")]
    public Task<string> UpdateJournal(
        [Description("Summary text (max 10000 characters in total). Replaces the whole current summary unless append=true, then it is added after the current summary.")] string? summary = null,
        [Description("A note to append (max 2000 characters).")] string? note = null,
        [Description("yyyy-MM-dd, today, tomorrow or yesterday. Default today.")] string? date = null,
        [Description("true adds to the existing summary after a blank line, no need to read it first; default false replaces.")] bool append = false,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            if (summary is null && string.IsNullOrWhiteSpace(note))
            {
                throw ToolGuard.Invalid("Pass 'summary' and/or 'note'.");
            }

            if (append && string.IsNullOrWhiteSpace(summary))
            {
                throw ToolGuard.Invalid("append=true needs a non-blank 'summary' to add. To add only a note, omit append and pass 'note'.");
            }

            var (today, offset) = InputParsing.LocalNow(time);
            var day = InputParsing.ParseDateOrToday(date, today, "date");
            var entry = await JournalResolver.EnsureAsync(api, day, offset, ct);
            var done = new List<string>();
            string? appended = null;

            if (append)
            {
                // Read-then-PUT is not atomic: an edit made between the read and the PUT is overwritten.
                var addition = summary!.Trim();
                var existing = entry.Summary;
                var combined = string.IsNullOrWhiteSpace(existing) ? addition : existing.TrimEnd() + "\n\n" + addition;
                if (combined.Length > MaxSummaryLength)
                {
                    throw ToolGuard.Invalid(
                        $"The combined summary would be {combined.Length} characters (existing {existing?.Length ?? 0} + new {addition.Length}); the limit is {MaxSummaryLength}. Nothing was saved, and any note passed was skipped too. "
                        + "Shorten the new text, or pass append=false to rewrite the whole summary.");
                }

                await api.UpdateJournalEntryAsync(entry.Id, entry.Title, combined, ct);
                appended = $"Appended to the journal summary for {day:yyyy-MM-dd} (now {combined.Length} of {MaxSummaryLength} characters).";
            }
            else if (summary is not null)
            {
                await api.UpdateJournalEntryAsync(entry.Id, entry.Title, summary, ct);
                done.Add("summary replaced");
            }

            if (!string.IsNullOrWhiteSpace(note))
            {
                await api.AddJournalNoteAsync(entry.Id, note.Trim(), ct);
                done.Add("note added");
            }

            if (appended is not null)
            {
                return done.Count == 0 ? appended : $"{appended} Note added.";
            }

            return $"Journal {day:yyyy-MM-dd}: {string.Join(", ", done)}.";
        });

    // Subtask enrichment is optional: API failures degrade the journal instead of failing it.
    // A timeout (TaskCanceledException without caller cancellation) and an unreadable body (JsonException) degrade too.
    // Caller cancellation and McpException are deliberately not caught.
    private async Task<(List<TaskItemDto>? Tasks, string? Failure)> LoadAllTasksAsync(CancellationToken ct)
    {
        try
        {
            return (await api.GetTasksAsync(ct), null);
        }
        catch (Exception ex) when (ex is TaskFlowApiException or HttpRequestException or JsonException
            || ex is TaskCanceledException && !ct.IsCancellationRequested)
        {
            return (null, Formatting.CleanReason(ex.Message));
        }
    }

    private string LocalTime(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), time.LocalTimeZone).ToString("HH:mm");
}
