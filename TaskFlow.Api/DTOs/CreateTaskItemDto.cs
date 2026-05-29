using TaskFlow.Api.Models;

namespace TaskFlow.Api.DTOs;

public class CreateTaskItemDto
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Status Status { get; set; } = Status.Draft;
    public bool IsComplete { get; set; }
    public Priority Priority { get; set; } = Priority.Low;
    public DateTime? DueDate { get; set; }
    public DateOnly? JournalDate { get; set; }
    public int? ParentTaskItemId { get; set; }
    /// <summary>
    /// The user's timezone offset in minutes (e.g. -420 for PDT, 0 for UTC). Optional.
    /// </summary>
    public int? TimezoneOffsetMinutes { get; set; }
}
