using TaskFlow.Api.Models;

namespace TaskFlow.Api.DTOs;

/// <summary>
/// Partial-update payload for <c>PATCH /api/v1/TaskItems/{id}</c> (JSON Merge Patch semantics).
/// A property that is absent from the JSON body is left unchanged. A property that is present,
/// including an explicit <c>null</c>, is applied. Presence is recorded by the property setters,
/// which System.Text.Json invokes only for properties that appear in the body.
/// <list type="bullet">
/// <item><description><see cref="Title"/>: present with <c>null</c> or empty fails validation.</description></item>
/// <item><description><see cref="Description"/>, <see cref="DueDate"/>, <see cref="ParentTaskItemId"/>:
/// present with <c>null</c> clears the value.</description></item>
/// <item><description><see cref="Status"/>, <see cref="Priority"/>: <c>null</c> is treated as absent.</description></item>
/// </list>
/// Completion is expressed only through <see cref="Status"/>. The project cannot be changed here.
/// </summary>
public class PatchTaskItemDto
{
    private readonly HashSet<string> _present = new(StringComparer.OrdinalIgnoreCase);
    private string? _title;
    private string? _description;
    private Status? _status;
    private Priority? _priority;
    private DateOnly? _dueDate;
    private int? _parentTaskItemId;
    private string? _blockedReason;

    public string? Title
    {
        get => _title;
        set { _title = value; _present.Add(nameof(Title)); }
    }

    public string? Description
    {
        get => _description;
        set { _description = value; _present.Add(nameof(Description)); }
    }

    public Status? Status
    {
        get => _status;
        set { _status = value; _present.Add(nameof(Status)); }
    }

    public Priority? Priority
    {
        get => _priority;
        set { _priority = value; _present.Add(nameof(Priority)); }
    }

    public DateOnly? DueDate
    {
        get => _dueDate;
        set { _dueDate = value; _present.Add(nameof(DueDate)); }
    }

    public int? ParentTaskItemId
    {
        get => _parentTaskItemId;
        set { _parentTaskItemId = value; _present.Add(nameof(ParentTaskItemId)); }
    }

    /// <summary>
    /// Optional reason for a blocked task. Absent keeps the stored reason; present with <c>null</c> or
    /// <c>""</c> clears it; a non-empty value is trimmed and saved. Only meaningful while the task is
    /// (or is becoming) Blocked, otherwise a non-empty value is rejected with 422. Note the asymmetry
    /// with PUT, where <c>null</c> keeps the reason.
    /// </summary>
    public string? BlockedReason
    {
        get => _blockedReason;
        set { _blockedReason = value; _present.Add(nameof(BlockedReason)); }
    }

    public bool AutoCompleteParentWhenChildrenDone { get; set; }

    public int? TimezoneOffsetMinutes { get; set; }

    /// <summary>Returns true when the named property was supplied in the request body (case-insensitive).</summary>
    public bool IsPresent(string propertyName) => _present.Contains(propertyName);
}
