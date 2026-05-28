namespace TaskFlow.Api.DTOs;

public class JournalNoteResponseDto
{
    public int Id { get; set; }
    public required string Content { get; set; }
    public int JournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
