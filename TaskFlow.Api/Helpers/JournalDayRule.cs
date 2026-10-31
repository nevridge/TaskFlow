using System.Linq.Expressions;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Helpers;

/// <summary>
/// The single rule deciding which journal day a task is a todo row on. Shared by the todos endpoint and the
/// journal entry <c>TodoTaskItemIds</c> so the two cannot drift.
/// A completed task that has a <c>CompletedAt</c> is shown on the user's local day it was completed; every other
/// task is shown on the day it is linked to. A task is therefore a todo row on exactly one day.
/// </summary>
public static class JournalDayRule
{
    /// <summary>True for a Completed task with a stored completion instant: it is attributed to its completion day.</summary>
    public static bool IsCompletionDayRow(TaskItem task) =>
        task.Status == Status.Completed && task.CompletedAt != null;

    /// <summary>
    /// The UTC instants bounding the local calendar <paramref name="day"/>: start inclusive, end exclusive.
    /// A null offset falls back to UTC. This is a deliberate exception to carry-forward's no-UTC-fallback rule
    /// (see <see cref="UserDateHelper"/>): a viewer that sends no offset simply gets UTC days.
    /// </summary>
    public static (DateTime StartUtc, DateTime EndUtc) GetUtcRange(DateOnly day, int? offsetMinutes)
    {
        var start = DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc)
            .AddMinutes(-(offsetMinutes ?? 0));
        return (start, start.AddDays(1));
    }

    /// <summary>
    /// The day a task is a todo row on. Completion-day rows use the local day of <c>CompletedAt</c>; all others use
    /// <paramref name="linkedDate"/>, the date of the task's own linked journal entry (null when unlinked).
    /// </summary>
    public static DateOnly? GetAttributedDay(TaskItem task, DateOnly? linkedDate, int? offsetMinutes) =>
        IsCompletionDayRow(task)
            ? UserDateHelper.GetUserDate(task.CompletedAt!.Value, offsetMinutes)
            : linkedDate;

    /// <summary>
    /// Database-side form of the rule for the entry <paramref name="entryId"/>: linked there and not a
    /// completion-day row, or a completion-day row with <c>CompletedAt</c> in [<paramref name="lo"/>, <paramref name="hi"/>).
    /// </summary>
    public static Expression<Func<TaskItem, bool>> OnDayPredicate(int entryId, DateTime lo, DateTime hi) =>
        t => (t.CurrentJournalEntryId == entryId && !(t.Status == Status.Completed && t.CompletedAt != null))
            || (t.Status == Status.Completed && t.CompletedAt != null && t.CompletedAt >= lo && t.CompletedAt < hi);
}
