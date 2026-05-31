namespace TaskFlow.Api.DTOs;

public class UpdateJournalLogEntryDto
{
    public required string Content { get; set; }
    public int? TaskItemId { get; set; }
}
