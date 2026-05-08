namespace TaskFlow.Api.DTOs;

public class UpdateJournalEntryDto
{
    public required string Title { get; set; }
    public string? Summary { get; set; }
}
