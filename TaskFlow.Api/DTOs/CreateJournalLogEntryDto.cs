namespace TaskFlow.Api.DTOs;

public class CreateJournalLogEntryDto
{
    public required string Content { get; set; }
    public int? TaskItemId { get; set; }
}
