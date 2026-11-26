using TaskFlow.Contracts;

namespace TaskFlow.Api.DTOs;

/// <summary>Full replacement of a goal's editable fields. A goal's project cannot be changed.</summary>
public class UpdateGoalDto
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? DoneWhen { get; set; }

    /// <summary>Required.</summary>
    public GoalStatus? Status { get; set; }

    /// <summary>Required when <c>status</c> is Parked, ignored otherwise.</summary>
    public string? ParkedReason { get; set; }

    /// <summary>
    /// Optional 1-based place among the project's other Next goals (1 = first; a goal already Next is not counted
    /// among them). Absent keeps the goal's place, or appends when it becomes Next. 400 when the goal would not be
    /// Next or the position is outside 1..N+1; nothing is saved.
    /// </summary>
    public int? Position { get; set; }
}
