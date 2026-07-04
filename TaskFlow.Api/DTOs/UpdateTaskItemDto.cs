using TaskFlow.Api.Models;

namespace TaskFlow.Api.DTOs;

/// <summary>
/// Update payload for <c>PUT /api/v1/TaskItems/{id}</c>. Field semantics are mixed:
/// <list type="bullet">
/// <item><description><b>Full-replace</b> — <see cref="Title"/>, <see cref="Description"/>,
/// <see cref="IsComplete"/>, <see cref="DueDate"/>, and <see cref="ParentTaskItemId"/> always
/// overwrite the existing value with whatever is sent, including <c>null</c>. Omitting
/// <see cref="ParentTaskItemId"/> (or sending it as <c>null</c>) clears the task's parent link.</description></item>
/// <item><description><b>Merge-on-null</b> — <see cref="Status"/> and <see cref="Priority"/> are
/// only applied when non-null; a <c>null</c> value leaves the existing stored value unchanged.</description></item>
/// </list>
/// Callers must explicitly resend full-replace fields (e.g. <c>parentTaskItemId</c>) on every
/// update or they will be cleared.
/// </summary>
public class UpdateTaskItemDto
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Status? Status { get; set; }
    public bool IsComplete { get; set; }
    public Priority? Priority { get; set; }
    public DateTime? DueDate { get; set; }
    public int? ParentTaskItemId { get; set; }
    public bool AutoCompleteParentWhenChildrenDone { get; set; }
    public int? TimezoneOffsetMinutes { get; set; }
}
