namespace TaskFlow.Api.Models;

public class JournalEntry
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public string? Summary { get; set; }
    public DateOnly Date { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public ICollection<TaskItem> Todos { get; set; } = [];
    public ICollection<JournalLogEntry> LogEntries { get; set; } = [];
    public ICollection<JournalNote> Notes { get; set; } = [];
}
