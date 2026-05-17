namespace TaskFlow.Api.Models;

public class TaskItemEvent
{
    public int Id { get; set; }
    public int TaskItemId { get; set; }
    public TaskItem? TaskItem { get; set; }
    public string EventType { get; set; } = string.Empty;
    public DateTime OccurredAtUtc { get; set; }
    public int? FromJournalEntryId { get; set; }
    public int? ToJournalEntryId { get; set; }
    public DateOnly? FromJournalDate { get; set; }
    public DateOnly? ToJournalDate { get; set; }
    public string? ChangeSummary { get; set; }
}