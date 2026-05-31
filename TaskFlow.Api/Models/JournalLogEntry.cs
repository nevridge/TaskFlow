namespace TaskFlow.Api.Models;

public class JournalLogEntry
{
    public int Id { get; set; }
    public required string Content { get; set; }
    public int JournalEntryId { get; set; }
    public JournalEntry JournalEntry { get; set; } = null!;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? TaskItemId { get; set; }
    public TaskItem? TaskItem { get; set; }
    public string? LinkedTaskTitleSnapshot { get; set; }
}
