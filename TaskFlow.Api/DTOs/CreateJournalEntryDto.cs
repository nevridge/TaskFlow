namespace TaskFlow.Api.DTOs;

public class CreateJournalEntryDto
{
    public required string Title { get; set; }
    public string? Summary { get; set; }
    public DateOnly Date { get; set; }
}
