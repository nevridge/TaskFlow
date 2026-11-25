using TaskFlow.Contracts;

namespace TaskFlow.Api.DTOs;

public class CreateGoalDto
{
    public int ProjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? DoneWhen { get; set; }

    /// <summary>Next (default) or Now.</summary>
    public GoalStatus? Status { get; set; }
}
