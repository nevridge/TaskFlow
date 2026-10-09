using System.Text;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>Compact, human-readable text for tool results (names first, IDs for follow-up calls).</summary>
internal static class Formatting
{
    private const int DescriptionPreviewLength = 200;

    public static bool IsDetailed(string? responseFormat) =>
        string.Equals(responseFormat, "detailed", StringComparison.OrdinalIgnoreCase);

    public static string Task(TaskItemDto t, DateOnly today, bool detailed = false)
    {
        var sb = new StringBuilder();
        sb.Append('#').Append(t.Id).Append(" [").Append(t.Priority).Append('/').Append(t.Status).Append("] ").Append(t.Title);

        if (t.DueOn is { } due)
        {
            sb.Append(" | due ").Append(due.ToString("yyyy-MM-dd"));
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

            if (t.ChildTaskCount > 0)
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
        $"#{p.Id} {p.Name}{(p.IsArchived ? " (archived)" : string.Empty)} - {p.OpenTaskCount} open / {p.CompletedTaskCount} done"
        + (string.IsNullOrWhiteSpace(p.Description) ? string.Empty : $" | {Preview(p.Description)}");

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
            .ThenBy(t => t.DueOn ?? DateOnly.MaxValue)
            .ThenBy(t => t.Id);

    public static IOrderedEnumerable<TaskItemDto> OrderByDue(IEnumerable<TaskItemDto> tasks) =>
        tasks.OrderBy(t => t.DueOn ?? DateOnly.MaxValue)
            .ThenBy(t => PriorityRank(t.Priority))
            .ThenBy(t => t.Id);
}
