namespace TaskFlow.Mcp.Api;

// Response shapes of the TaskFlow API (camelCase JSON). Enum-like values arrive as PascalCase strings.

public sealed record TaskItemDto(
    int Id,
    string Title,
    string? Description,
    bool IsComplete,
    DateTime? DueDate,
    string Status,
    string Priority,
    int? ParentTaskItemId,
    int? ProjectId,
    string? ProjectName,
    int? CurrentJournalEntryId,
    DateOnly? FirstTaggedDate,
    DateOnly? LastMovedDate,
    int ChildTaskCount,
    DateOnly? CurrentJournalDate,
    int MoveCount,
    int DaysTagged,
    string? BlockedReason = null,
    DateTime? BlockedAt = null,
    string? PreviousStatus = null)
{
    public bool IsBlocked => string.Equals(Status, "Blocked", StringComparison.OrdinalIgnoreCase);

    public bool IsDone => IsComplete || string.Equals(Status, "Completed", StringComparison.OrdinalIgnoreCase);

    public DateOnly? DueOn => DueDate is { } due ? DateOnly.FromDateTime(due) : null;
}

public sealed record ProjectDto(
    int Id,
    string Name,
    string? Description,
    bool IsArchived,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    int OpenTaskCount,
    int CompletedTaskCount,
    int BlockedCount = 0);

public sealed record NoteDto(
    int Id,
    string Content,
    DateTime CreatedAt,
    DateTime? UpdatedAt);

public sealed record TaskEventDto(
    int Id,
    int TaskItemId,
    string EventType,
    DateTime OccurredAtUtc,
    string? ChangeSummary);

public sealed record LogEntryDto(
    int Id,
    string Content,
    int JournalEntryId,
    DateTime CreatedAt,
    int? TaskItemId,
    string? LinkedTaskTitle,
    bool LinkedTaskDeleted);

public sealed record JournalEntryDto(
    int Id,
    string Title,
    string? Summary,
    DateOnly Date,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    IReadOnlyList<int> TodoTaskItemIds,
    IReadOnlyList<LogEntryDto> LogEntries);

// Request shapes.

public sealed record CreateTaskRequest(
    string Title,
    string? Description,
    string Status,
    string Priority,
    DateTime? DueDate,
    DateOnly? JournalDate,
    int? ParentTaskItemId,
    int? ProjectId,
    int TimezoneOffsetMinutes);

/// <summary>The task PUT is full-replace, so every field is always sent.</summary>
public sealed record UpdateTaskRequest(
    string Title,
    string? Description,
    string Status,
    string Priority,
    bool IsComplete,
    DateTime? DueDate,
    int? ParentTaskItemId,
    bool AutoCompleteParentWhenChildrenDone,
    int TimezoneOffsetMinutes,
    string? BlockedReason = null);
