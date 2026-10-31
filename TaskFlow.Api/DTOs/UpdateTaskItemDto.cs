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
}
