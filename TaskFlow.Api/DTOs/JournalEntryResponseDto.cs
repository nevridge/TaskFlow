namespace TaskFlow.Api.DTOs;

public class JournalEntryResponseDto
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public string? Summary { get; set; }
    public DateOnly Date { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public IEnumerable<int> TodoTaskItemIds { get; set; } = [];
    public IEnumerable<JournalLogEntryResponseDto> LogEntries { get; set; } = [];

    // Populated only by the Create response when tasks were carried forward into the new entry.
    // GET, PUT and the 409 existingEntry payloads always return 0 and [].
    public int MovedCount { get; set; }
    public IEnumerable<int> MovedTaskItemIds { get; set; } = [];
}
