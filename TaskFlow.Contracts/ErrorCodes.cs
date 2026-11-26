namespace TaskFlow.Contracts;

/// <summary>Machine-readable error codes returned in the <c>code</c> field of API 422 (and one 409) bodies.</summary>
public static class ErrorCodes
{
    /// <summary>Returned when a task references a project that does not exist.</summary>
    public const string ProjectNotFound = "TASK_PROJECT_NOT_FOUND";

    /// <summary>Returned when a task is created on a past journal day.</summary>
    public const string CreationPastDayNotAllowed = "TASK_CREATION_PAST_DAY_NOT_ALLOWED";

    /// <summary>Returned when a concurrent request planned the task on a journal day first (409).</summary>
    public const string JournalAssignmentConflict = "TASK_JOURNAL_ASSIGNMENT_CONFLICT";

    /// <summary>Returned when a task completed on a past day is reopened.</summary>
    public const string ReopenPastDayNotAllowed = "TASK_REOPEN_PAST_DAY_NOT_ALLOWED";

    /// <summary>Returned when the parent task does not exist.</summary>
    public const string ParentNotFound = "TASK_PARENT_NOT_FOUND";

    /// <summary>Returned when a task is set as its own parent.</summary>
    public const string ParentSelfNotAllowed = "TASK_PARENT_SELF_NOT_ALLOWED";

    /// <summary>Returned when a subtask would be nested deeper than one level.</summary>
    public const string ParentDepthNotAllowed = "TASK_PARENT_DEPTH_NOT_ALLOWED";

    /// <summary>Returned when a parent with open subtasks is completed.</summary>
    public const string ParentCompleteBlockedByChildren = "TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN";

    /// <summary>Returned when a parent with subtasks is deleted.</summary>
    public const string ParentDeleteBlockedByChildren = "TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN";

    /// <summary>Returned when a draft task is blocked.</summary>
    public const string BlockDraftNotAllowed = "TASK_BLOCK_DRAFT_NOT_ALLOWED";

    /// <summary>Returned when a completed task is blocked.</summary>
    public const string BlockCompletedNotAllowed = "TASK_BLOCK_COMPLETED_NOT_ALLOWED";

    /// <summary>Returned when a blocked reason is set on a task that is not blocked.</summary>
    public const string BlockedReasonRequiresBlockedStatus = "TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS";

    /// <summary>Returned when a task is created already blocked.</summary>
    public const string CreateBlockedNotAllowed = "TASK_CREATE_BLOCKED_NOT_ALLOWED";

    /// <summary>Returned when a task cannot be started from its current state.</summary>
    public const string StartNotAllowed = "TASK_START_NOT_ALLOWED";

    /// <summary>Returned when a task is planned on a past journal day.</summary>
    public const string AssignmentPastDayNotAllowed = "TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED";

    /// <summary>Returned when a completed task is planned onto a different day.</summary>
    public const string PlanCompletedNotAllowed = "TASK_PLAN_COMPLETED_NOT_ALLOWED";

    /// <summary>Returned when the status of a parent with open subtasks is edited directly.</summary>
    public const string ParentStatusDerived = "TASK_PARENT_STATUS_DERIVED";

    /// <summary>Returned when an open task is attached to a completed parent.</summary>
    public const string ParentCompletedNotAllowed = "TASK_PARENT_COMPLETED_NOT_ALLOWED";

    /// <summary>Returned when a task with open subtasks is planned onto a day.</summary>
    public const string PlanHasOpenSubtasks = "TASK_PLAN_HAS_OPEN_SUBTASKS";

    /// <summary>Returned when a task in a Next or Parked goal would be started or completed, or an InProgress subtask moved into that goal, while its project has a Now goal.</summary>
    public const string TaskGoalNotNow = "TASK_GOAL_NOT_NOW";

    /// <summary>Returned when the Now goal would be moved back to Next or Parked while it has tasks in progress.</summary>
    public const string GoalNowHasInProgressTasks = "GOAL_NOW_HAS_INPROGRESS_TASKS";

    /// <summary>Returned when a goal with open tasks would be set to Done or Dropped.</summary>
    public const string GoalHasOpenTasks = "GOAL_HAS_OPEN_TASKS";
}
