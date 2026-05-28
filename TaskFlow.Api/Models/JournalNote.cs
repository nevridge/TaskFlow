namespace TaskFlow.Api.Models;

public class JournalNote
{
    public int Id { get; set; }
    public required string Content { get; set; }
    public int JournalEntryId { get; set; }
    public JournalEntry JournalEntry { get; set; } = null!;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
