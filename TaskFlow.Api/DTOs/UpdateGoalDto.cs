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
}
