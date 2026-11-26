using TaskFlow.Api.Models;
using TaskFlow.Contracts;

namespace TaskFlow.Api.DTOs;

public class CreateTaskItemDto
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Status Status { get; set; } = Status.Draft;
    public Priority Priority { get; set; } = Priority.Low;
    public DateOnly? DueDate { get; set; }
    public DateOnly? JournalDate { get; set; }
    public int? ParentTaskItemId { get; set; }
    /// <summary>
    /// Optional project to create the task in. After creation, PATCH <c>projectId</c> (or the Projects
    /// assign/unassign endpoints) changes it; PUT never does.
    /// </summary>
    public int? ProjectId { get; set; }
    /// <summary>
    /// Optional goal to create the task in. It must be an open goal of <see cref="ProjectId"/> (400 otherwise, 404 when
    /// unknown) and cannot be set on a subtask (<see cref="ParentTaskItemId"/>), whose goal follows its parent.
    /// Absent: a subtask inherits its parent's goal, any other task has none.
    /// </summary>
    public int? GoalId { get; set; }
    /// <summary>
    /// The user's timezone offset in minutes (e.g. -420 for PDT, 0 for UTC). Optional.
    /// </summary>
    public int? TimezoneOffsetMinutes { get; set; }
}
