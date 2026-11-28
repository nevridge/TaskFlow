using System.Globalization;
using System.Text.Json.Nodes;

namespace TaskFlow.Mcp.Api;

// Response shapes of the TaskFlow API (camelCase JSON). Enum-like values arrive as PascalCase strings.

public sealed record TaskItemDto(
    int Id,
    string Title,
    string? Description,
    DateOnly? DueDate,
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
    string? PreviousStatus = null,
    DateTime? StartedAt = null,
    string? ParentTitle = null,
    int OpenChildCount = 0,
    int? GoalId = null,
    string? GoalTitle = null)
{
    public bool IsBlocked => string.Equals(Status, "Blocked", StringComparison.OrdinalIgnoreCase);

    public bool IsDone => string.Equals(Status, "Completed", StringComparison.OrdinalIgnoreCase);
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
    int BlockedCount = 0,
    int? AreaId = null,
    string? AreaName = null);

/// <summary>ProjectCount includes archived projects.</summary>
public sealed record AreaDto(
    int Id,
    string Name,
    int DisplayOrder,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    int ProjectCount);

/// <summary>A goal inside a project. The task counts include subtasks; open means any status except Completed.</summary>
public sealed record GoalDto(
    int Id,
    int ProjectId,
    string Title,
    string? Description,
    string? DoneWhen,
    string Status,
    string? ParkedReason,
    int DisplayOrder,
    DateTime StatusChangedAt,
    DateTime? ClosedAt,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    int OpenTaskCount,
    int DoneTaskCount);

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

public sealed record CreateGoalRequest(
    int ProjectId,
    string Title,
    string? Description,
    string? DoneWhen,
    string Status,
    int? Position = null);

/// <summary>The goal PUT is full-replace, so every field is always sent. A null Position means "keep"; the API owns the range check.</summary>
public sealed record UpdateGoalRequest(
    string Title,
    string? Description,
    string? DoneWhen,
    string Status,
    string? ParkedReason,
    int? Position = null);

/// <summary>A null GoalId means no goal. A subtask inherits its parent's goal, so a goal is sent only for a non-subtask.</summary>
public sealed record CreateTaskRequest(
    string Title,
    string? Description,
    string Status,
    string Priority,
    DateOnly? DueDate,
    DateOnly? JournalDate,
    int? ParentTaskItemId,
    int? ProjectId,
    int TimezoneOffsetMinutes,
    int? GoalId = null);

/// <summary>The task PUT is full-replace, so every field is always sent. update_task uses <see cref="TaskPatch"/> instead.</summary>
public sealed record UpdateTaskRequest(
    string Title,
    string? Description,
    string Status,
    string Priority,
    DateOnly? DueDate,
    int? ParentTaskItemId,
    bool AutoCompleteParentWhenChildrenDone,
    int TimezoneOffsetMinutes,
    string? BlockedReason = null,
    DateOnly? JournalDate = null);

/// <summary>
/// The property names of the task PATCH body. The API silently drops a name it does not know, so a typo would look
/// like a no-op; keeping them here means each is spelled once.
/// </summary>
public static class TaskPatchFields
{
    public const string Title = "title";
    public const string Status = "status";
    public const string Priority = "priority";
    public const string Description = "description";
    public const string DueDate = "dueDate";
    public const string ParentTaskItemId = "parentTaskItemId";
    public const string BlockedReason = "blockedReason";
    public const string JournalDate = "journalDate";
    public const string ProjectId = "projectId";
    public const string GoalId = "goalId";
    public const string TimezoneOffsetMinutes = "timezoneOffsetMinutes";
}

/// <summary>
/// Builds the body of a task PATCH. The API reads an absent property as "keep" and an explicit null as "clear", and
/// <see cref="TaskFlowApiClient.Json"/> writes every null property of a record, so a nullable-property record would
/// clear every unchanged field. Only the properties set here are written.
/// </summary>
public sealed class TaskPatch
{
    private readonly JsonObject _body = [];

    public bool HasChanges => _body.Count > 0;

    /// <summary>Writes the property with this value, or an explicit JSON null when the value is null (clear).</summary>
    public TaskPatch Set(string name, string? value) => Put(name, value is null ? null : JsonValue.Create(value));

    public TaskPatch Set(string name, int? value) => Put(name, value is null ? null : JsonValue.Create(value.Value));

    public TaskPatch Set(string name, DateOnly? value) =>
        Put(name, value is null ? null : JsonValue.Create(value.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));

    /// <summary>Writes an explicit JSON null: the API clears the property.</summary>
    public TaskPatch Clear(string name) => Put(name, null);

    internal JsonObject ToJson() => _body;

    private TaskPatch Put(string name, JsonNode? node)
    {
        _body[name] = node;
        return this;
    }
}
