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

    /// <summary>
    /// Optional 1-based place among the project's Next goals (1 = first). Absent appends. 400 when the goal would not
    /// be Next or the position is outside 1..N+1; nothing is saved.
    /// </summary>
    public int? Position { get; set; }
}
