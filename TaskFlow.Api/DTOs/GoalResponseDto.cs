namespace TaskFlow.Api.DTOs;

public class GoalResponseDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public string? DoneWhen { get; set; }
    public required string Status { get; set; }
    public string? ParkedReason { get; set; }
    public int DisplayOrder { get; set; }
    public DateTime StatusChangedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Tasks of the goal that are not Completed, subtasks included.</summary>
    public int OpenTaskCount { get; set; }
    public int DoneTaskCount { get; set; }
}
