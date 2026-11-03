namespace TaskFlow.Api.Helpers;

/// <summary>Machine-readable 422 codes and bodies shared by more than one controller.</summary>
public static class TaskRuleErrors
{
    public const string PlanCompletedNotAllowedCode = "TASK_PLAN_COMPLETED_NOT_ALLOWED";

    public const string ParentStatusDerivedCode = "TASK_PARENT_STATUS_DERIVED";

    /// <summary>The 422 body <c>{ code, message }</c> returned when the status of a parent with open subtasks is edited directly.</summary>
    public static object ParentStatusDerived() => new
    {
        code = ParentStatusDerivedCode,
        message = "A parent task's status follows its open subtasks and cannot be changed directly."
    };

    /// <summary>The 422 body <c>{ code, message, details }</c> returned when a completed task is planned onto a day.</summary>
    public static object PlanCompletedNotAllowed(DateOnly? assignedDate, DateTime? completedAt, DateOnly? journalDate) => new
    {
        code = PlanCompletedNotAllowedCode,
        message = "Completed tasks cannot be planned onto a different day.",
        details = new { assignedDate, completedAt, journalDate }
    };
}
