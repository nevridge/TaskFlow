using System.ComponentModel;
using System.Text;
using ModelContextProtocol.Server;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

[McpServerToolType]
public sealed class ReviewTools(TaskFlowApiClient api, TimeProvider time)
{
    private const int MaxHistoryLookups = 300;
    private const int HistoryParallelism = 8;
    private const int ListLimit = 10;

    [McpServerTool(Name = "weekly_review", ReadOnly = true)]
    [Description(
        "Read-only summary of a period (default: the last 7 days ending today) for status updates and weekly reviews: tasks completed and added (grouped by project), "
        + "what is overdue or stalled right now, a per-project snapshot, and journal activity. Lists currently Blocked tasks as a separate group. Draft the write-up from this; it does not change anything.")]
    public Task<string> WeeklyReview(
        [Description("First day, yyyy-MM-dd. Default: 6 days before 'to'.")] string? from = null,
        [Description("Last day, yyyy-MM-dd or today. Default today.")] string? to = null,
        CancellationToken ct = default) =>
        ToolGuard.RunAsync(api, ct, async () =>
        {
            var today = InputParsing.Today(time);
            var end = InputParsing.ParseDateOrToday(to, today, "to");
            var start = string.IsNullOrWhiteSpace(from) ? end.AddDays(-6) : InputParsing.ParseDate(from, today, "from");
            if (start > end)
            {
                throw ToolGuard.Invalid($"'from' ({start:yyyy-MM-dd}) is after 'to' ({end:yyyy-MM-dd}).");
            }

            var tasks = await api.GetTasksAsync(ct);
            var projects = await api.GetProjectsAsync(ct);
            var journal = await api.GetJournalEntriesAsync(ct);

            var lookups = tasks.OrderByDescending(t => t.Id).Take(MaxHistoryLookups).ToList();
            var histories = await LoadHistoriesAsync(lookups, ct);

            var completed = new List<TaskItemDto>();
            var added = new List<TaskItemDto>();
            foreach (var (task, events) in histories)
            {
                if (events.Any(e => e.EventType == "Completed" && InRange(e.OccurredAtUtc, start, end)))
                {
                    completed.Add(task);
                }

                if (events.Any(e => e.EventType == "TaskCreated" && InRange(e.OccurredAtUtc, start, end)))
                {
                    added.Add(task);
                }
            }

            var open = tasks.Where(t => !t.IsDone).ToList();
            var overdue = Formatting.OrderByDue(open.Where(t => t.DueOn < today)).ToList();
            var stalled = Formatting.OrderByUrgency(open.Where(t => !t.IsBlocked && TaskTools.IsStale(t))).ToList();

            // Built from the current task list, so the 300-history cap above does not affect this group.
            var blocked = Formatting.OrderByUrgency(open.Where(t => t.IsBlocked)).ToList();
            var nowUtc = time.GetUtcNow();

            var sb = new StringBuilder();
            sb.AppendLine($"Review {start:yyyy-MM-dd} to {end:yyyy-MM-dd}");

            AppendGrouped(sb, "Completed", completed);
            AppendGrouped(sb, "Added", added);

            sb.AppendLine($"Open now: {open.Count} (overdue {overdue.Count}, stalled {stalled.Count})");
            AppendList(sb, "Blocked", blocked, today, nowUtc);
            AppendList(sb, "Overdue", overdue, today, nowUtc);
            AppendList(sb, "Stalled (moved 3+ times or tagged 7+ days)", stalled, today, nowUtc);

            var activeProjects = projects.Where(p => !p.IsArchived).ToList();
            if (activeProjects.Count > 0)
            {
                sb.AppendLine("Projects:");
                foreach (var p in activeProjects)
                {
                    var projectOverdue = overdue.Count(t => t.ProjectId == p.Id);
                    sb.AppendLine($"  {p.Name}: {p.OpenTaskCount} open{Formatting.BlockedCountText(p.BlockedCount)} / {p.CompletedTaskCount} done{(projectOverdue > 0 ? $", {projectOverdue} overdue" : string.Empty)}");
                }

                var unassigned = open.Count(t => t.ProjectId is null);
                if (unassigned > 0)
                {
                    sb.AppendLine($"  (no project): {unassigned} open");
                }
            }

            var days = journal.Where(e => e.Date >= start && e.Date <= end).OrderBy(e => e.Date).ToList();
            var logCount = days.Sum(e => e.LogEntries.Count);
            sb.AppendLine($"Journal: {days.Count} day(s) with entries, {logCount} log entr{(logCount == 1 ? "y" : "ies")}");
            foreach (var day in days.Where(d => !string.IsNullOrWhiteSpace(d.Summary)))
            {
                sb.AppendLine($"  {day.Date:yyyy-MM-dd}: {Formatting.Preview(day.Summary!, 200)}");
            }

            if (tasks.Count > lookups.Count)
            {
                sb.AppendLine($"Note: completed/added counts only cover the {lookups.Count} most recent of {tasks.Count} tasks.");
            }

            return sb.ToString().TrimEnd();
        });

    private async Task<List<(TaskItemDto Task, List<TaskEventDto> Events)>> LoadHistoriesAsync(List<TaskItemDto> tasks, CancellationToken ct)
    {
        using var gate = new SemaphoreSlim(HistoryParallelism);
        var results = await Task.WhenAll(tasks.Select(async task =>
        {
            await gate.WaitAsync(ct);
            try
            {
                return (task, events: await api.GetTaskHistoryAsync(task.Id, ct));
            }
            finally
            {
                gate.Release();
            }
        }));

        return [.. results];
    }

    private bool InRange(DateTime utc, DateOnly start, DateOnly end)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), time.LocalTimeZone);
        var date = DateOnly.FromDateTime(local);
        return date >= start && date <= end;
    }

    private static void AppendGrouped(StringBuilder sb, string title, List<TaskItemDto> items)
    {
        sb.AppendLine($"{title} ({items.Count}):");
        foreach (var group in items.GroupBy(t => t.ProjectName ?? "No project").OrderBy(g => g.Key))
        {
            sb.AppendLine($"  {group.Key} ({group.Count()}): " + string.Join("; ", group.Take(ListLimit).Select(t => $"#{t.Id} {t.Title}"))
                + (group.Count() > ListLimit ? $"; ... +{group.Count() - ListLimit} more" : string.Empty));
        }
    }

    private static void AppendList(StringBuilder sb, string title, List<TaskItemDto> items, DateOnly today, DateTimeOffset nowUtc)
    {
        if (items.Count == 0)
        {
            return;
        }

        sb.AppendLine($"{title}:");
        foreach (var task in items.Take(ListLimit))
        {
            sb.AppendLine("  " + Formatting.Task(task, today, nowUtc: nowUtc));
        }

        if (items.Count > ListLimit)
        {
            sb.AppendLine($"  ... and {items.Count - ListLimit} more");
        }
    }
}
