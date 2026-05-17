namespace TaskFlow.Api.DTOs;

public class TaskItemResponseDto
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public bool IsComplete { get; set; }
    public DateTime? DueDate { get; set; }
    public string Status { get; set; } = "Draft";
    public string Priority { get; set; } = "Low"; // String representation of the priority
    public DateOnly? CurrentJournalDate { get; set; }
    public int MoveCount { get; set; }
    public int DaysTagged { get; set; }
}
