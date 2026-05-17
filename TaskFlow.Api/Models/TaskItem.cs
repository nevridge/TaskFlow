namespace TaskFlow.Api.Models;

public class TaskItem
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public bool IsComplete { get; set; }
    public Priority Priority { get; set; } = Priority.Low;
    public Status Status { get; set; } = Status.Draft;
    public DateTime? DueDate { get; set; }
    public DateOnly? FirstTaggedDate { get; set; }
    public int MoveCount { get; set; }
    public int? CurrentJournalEntryId { get; set; }
    public JournalEntry? CurrentJournalEntry { get; set; }
    public ICollection<Note> Notes { get; set; } = [];
}
