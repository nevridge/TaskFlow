namespace TaskFlow.Api.DTOs;

public class ReorderGoalsDto
{
    public int ProjectId { get; set; }

    /// <summary>Every Next goal of the project exactly once, in the wanted display order.</summary>
    public List<int> GoalIds { get; set; } = [];
}
