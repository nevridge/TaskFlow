using TaskFlow.Api.Models;

namespace TaskFlow.Api.DTOs;

/// <summary>
/// Update payload for <c>PUT /api/v1/TaskItems/{id}</c>. Field semantics are mixed:
/// <list type="bullet">
/// <item><description><b>Full-replace</b> — <see cref="Title"/>, <see cref="Description"/>,
/// <see cref="DueDate"/>, and <see cref="ParentTaskItemId"/> always
/// overwrite the existing value with whatever is sent, including <c>null</c>. Omitting
/// <see cref="ParentTaskItemId"/> (or sending it as <c>null</c>) clears the task's parent link.</description></item>
/// <item><description><b>Merge-on-null</b> — <see cref="Status"/> and <see cref="Priority"/> are
/// only applied when non-null; a <c>null</c> value leaves the existing stored value unchanged.</description></item>
/// </list>
/// Callers must explicitly resend full-replace fields (e.g. <c>parentTaskItemId</c>) on every
/// update or they will be cleared. Completion is expressed only through <see cref="Status"/>.
/// Use <c>PATCH /api/v1/TaskItems/{id}</c> for partial updates.
/// </summary>
public class UpdateTaskItemDto
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Status? Status { get; set; }
    public Priority? Priority { get; set; }
    public DateOnly? DueDate { get; set; }
    public int? ParentTaskItemId { get; set; }

    /// <summary>
    /// Optional blocked reason (merge-on-null): <c>null</c> keeps the stored reason, <c>""</c> clears it,
    /// a non-empty value is trimmed and saved. Note the asymmetry with PATCH, where a present
    /// <c>null</c> clears the reason.
    /// </summary>
    public string? BlockedReason { get; set; }

    public bool AutoCompleteParentWhenChildrenDone { get; set; }
    public int? TimezoneOffsetMinutes { get; set; }

    /// <summary>
    /// Optional journal day to plan the task on. <c>null</c>/absent leaves the planned day unchanged;
    /// there is no way to un-plan through an update. Only today-or-later (the user's today, derived from
    /// <see cref="TimezoneOffsetMinutes"/>, UTC when no offset is sent) is accepted, otherwise 422
    /// <c>TASK_CREATION_PAST_DAY_NOT_ALLOWED</c> and nothing is changed. Re-sending the day the task is
    /// already planned on succeeds, even when that day is in the past. A task that has a completion time
    /// (<c>completedAt</c>) cannot be planned onto a different day: 422 <c>TASK_PLAN_COMPLETED_NOT_ALLOWED</c>
    /// (reopen first, plan second). Completing a not-yet-completed task and planning it in the same request is
    /// rejected the same way (the completion is stamped first, so the task counts as completed) and the whole
    /// update is rolled back: complete and plan in two requests is not possible either, because the second one
    /// is rejected once <c>completedAt</c> exists. A legacy Completed task with no <c>completedAt</c> can still be planned.
    /// A missing journal entry is created.
    /// The field update and the planning are atomic. Planning a parent does not plan its subtasks, and no
    /// carry-forward of other tasks happens.
    /// </summary>
    public DateOnly? JournalDate { get; set; }
}
