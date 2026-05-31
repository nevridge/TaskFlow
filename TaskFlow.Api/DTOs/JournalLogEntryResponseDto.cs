namespace TaskFlow.Api.DTOs;

public class JournalLogEntryResponseDto
{
    public int Id { get; set; }
    public required string Content { get; set; }
    public int JournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? TaskItemId { get; set; }
    public string? LinkedTaskTitle { get; set; }
    public bool LinkedTaskDeleted { get; set; }
}
