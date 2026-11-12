using TaskFlow.Contracts;

namespace TaskFlow.Api.Helpers;

/// <summary>Machine-readable 422 codes and bodies shared by more than one controller.</summary>
public static class TaskRuleErrors
{
    /// <summary>The 422 body <c>{ code, message }</c> returned when the status of a parent with open subtasks is edited directly.</summary>
    public static object ParentStatusDerived() => new
    {
        code = ErrorCodes.ParentStatusDerived,
        message = "A parent task's status follows its open subtasks and cannot be changed directly."
    };

    /// <summary>The 422 body <c>{ code, message }</c> returned when an open task would be attached to a Completed parent.</summary>
    public static object ParentCompletedNotAllowed() => new
    {
        code = ErrorCodes.ParentCompletedNotAllowed,
        message = "A completed task can't have open subtasks. Reopen the parent first, or keep this subtask completed."
    };

    /// <summary>The 422 body <c>{ code, message, details }</c> returned when a task with open subtasks is planned onto a day.</summary>
    public static object PlanHasOpenSubtasks(int taskItemId, DateOnly? journalDate) => new
    {
        code = ErrorCodes.PlanHasOpenSubtasks,
        message = "A task with open subtasks can't be planned on a day. Plan its subtasks instead.",
        details = new { taskItemId, journalDate }
    };

    /// <summary>The 422 body <c>{ code, message, details }</c> returned when a completed task is planned onto a day.</summary>
    public static object PlanCompletedNotAllowed(DateOnly? assignedDate, DateTime? completedAt, DateOnly? journalDate) => new
    {
        code = ErrorCodes.PlanCompletedNotAllowed,
        message = "Completed tasks cannot be planned onto a different day.",
        details = new { assignedDate, completedAt, journalDate }
    };
}
