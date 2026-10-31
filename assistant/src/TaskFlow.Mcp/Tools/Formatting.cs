using System.Globalization;
using System.Text;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>Compact, human-readable text for tool results (names first, IDs for follow-up calls).</summary>
internal static class Formatting
{
    private const int DescriptionPreviewLength = 200;

    public static bool IsDetailed(string? responseFormat) =>
        string.Equals(responseFormat, "detailed", StringComparison.OrdinalIgnoreCase);

    /// <summary>Link suffix for a journal log line, e.g. " [task #5 | Apollo | High]". Empty when the log has no linked task.</summary>
    public static string LogTaskLink(LogEntryDto log, IReadOnlyDictionary<int, TaskItemDto>? tasksById)
    {
        if (log.TaskItemId is not { } taskId)
        {
            return string.Empty;
        }

        if (log.LinkedTaskDeleted)
        {
            return $" [task #{taskId}, deleted]";
        }

        if (tasksById is null || !tasksById.TryGetValue(taskId, out var task))
        {
            return $" [task #{taskId}]";
        }

        var parts = new List<string> { $"task #{taskId}" };
        if (!string.IsNullOrWhiteSpace(task.ProjectName))
        {
            parts.Add(task.ProjectName);
        }

        if (!string.IsNullOrWhiteSpace(task.Priority))
        {
            parts.Add(task.Priority);
        }

        return $" [{string.Join(" | ", parts)}]";
    }

    public static string Task(TaskItemDto t, DateOnly today, bool detailed = false, DateTimeOffset? nowUtc = null, bool showChildCount = true)
    {
        var sb = new StringBuilder();
        sb.Append('#').Append(t.Id).Append(" [").Append(t.Priority).Append('/').Append(t.Status).Append("] ").Append(t.Title);

        if (t.IsBlocked)
        {
            sb.Append(" | ").Append(BlockedLabel(t, nowUtc));
        }

        if (t.DueDate is { } due)
        {
            sb.Append(" | due ").Append(due.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            if (!t.IsDone && due < today)
            {
                sb.Append(" (OVERDUE ").Append(today.DayNumber - due.DayNumber).Append('d').Append(')');
            }
        }

        if (!string.IsNullOrEmpty(t.ProjectName))
        {
            sb.Append(" | project: ").Append(t.ProjectName);
        }

        if (t.ParentTaskItemId is { } parent)
        {
            sb.Append(" | subtask of #").Append(parent);
        }

        if (t.MoveCount > 0)
        {
            sb.Append(" | moved ").Append(t.MoveCount).Append('x');
        }

        if (detailed)
        {
            if (t.CurrentJournalDate is { } day)
            {
                sb.Append(" | planned ").Append(day.ToString("yyyy-MM-dd"));
            }

            if (t.DaysTagged > 0)
            {
                sb.Append(" | tagged ").Append(t.DaysTagged).Append('d');
            }

            if (t.IsBlocked && BlockedAtUtc(t) is { } since)
            {
                sb.Append(" | blocked since ").Append(since.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)).Append(" UTC");
            }

            if (showChildCount && t.ChildTaskCount > 0)
            {
                sb.Append(" | ").Append(t.ChildTaskCount).Append(" subtask(s)");
            }

            if (!string.IsNullOrWhiteSpace(t.Description))
            {
                sb.Append(" | ").Append(Preview(t.Description));
            }
        }

        return sb.ToString();
    }

    public static string Project(ProjectDto p) =>
        $"#{p.Id} {p.Name}{(p.IsArchived ? " (archived)" : string.Empty)} - {p.OpenTaskCount} open{BlockedCountText(p.BlockedCount)} / {p.CompletedTaskCount} done"
        + (string.IsNullOrWhiteSpace(p.Description) ? string.Empty : $" | {Preview(p.Description)}");

    /// <summary>" (N blocked)" when N is above 0, otherwise empty.</summary>
    public static string BlockedCountText(int count) => count > 0 ? $" ({count} blocked)" : string.Empty;

    /// <summary>"blocked: reason (4d)", or "blocked (4d)" with no reason. The duration is omitted without BlockedAt or a clock.</summary>
    public static string BlockedLabel(TaskItemDto t, DateTimeOffset? nowUtc)
    {
        var sb = new StringBuilder("blocked");
        var reason = CleanReason(t.BlockedReason);
        if (reason.Length > 0)
        {
            sb.Append(": ").Append(reason);
        }

        if (BlockedAtUtc(t) is { } since && nowUtc is { } now)
        {
            var days = (int)Math.Max(0, Math.Floor((now - since).TotalDays));
            sb.Append(days == 0 ? " (<1d)" : $" ({days}d)");
        }

        return sb.ToString();
    }

    /// <summary>Trims and collapses runs of whitespace to one space. Case is kept; compare with an ignore-case comparer.</summary>
    public static string NormalizeTitle(string? title) =>
        string.Join(' ', (title ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

    /// <summary>Strips control characters and collapses newlines so a reason stays on one line.</summary>
    public static string CleanReason(string? reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            return string.Empty;
        }

        var sb = new StringBuilder(reason.Length);
        foreach (var ch in reason)
        {
            sb.Append(char.IsControl(ch) ? ' ' : ch);
        }

        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static DateTimeOffset? BlockedAtUtc(TaskItemDto t)
    {
        if (t.BlockedAt is not { } at)
        {
            return null;
        }

        var utc = at.Kind == DateTimeKind.Local ? at.ToUniversalTime() : DateTime.SpecifyKind(at, DateTimeKind.Utc);
        return new DateTimeOffset(utc);
    }

    public static string Preview(string text, int max = DescriptionPreviewLength)
    {
        var flat = text.ReplaceLineEndings(" ").Trim();
        return flat.Length <= max ? flat : flat[..max] + "...";
    }

    public static int PriorityRank(string priority) => priority.ToLowerInvariant() switch
    {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    };

    public static IOrderedEnumerable<TaskItemDto> OrderByUrgency(IEnumerable<TaskItemDto> tasks) =>
        tasks.OrderBy(t => PriorityRank(t.Priority))
            .ThenBy(t => t.DueDate ?? DateOnly.MaxValue)
            .ThenBy(t => t.Id);

    /// <summary>Open (not done) subtasks grouped by parent id. Group order follows the source; order each group at render time.</summary>
    public static ILookup<int, TaskItemDto> OpenSubtasksByParent(IEnumerable<TaskItemDto> tasks) =>
        tasks.Where(t => !t.IsDone && t.ParentTaskItemId != null)
            .ToLookup(t => t.ParentTaskItemId!.Value);

    public static IOrderedEnumerable<TaskItemDto> OrderByDue(IEnumerable<TaskItemDto> tasks) =>
        tasks.OrderBy(t => t.DueDate ?? DateOnly.MaxValue)
            .ThenBy(t => PriorityRank(t.Priority))
            .ThenBy(t => t.Id);
}
