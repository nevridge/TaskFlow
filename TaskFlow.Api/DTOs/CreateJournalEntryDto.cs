namespace TaskFlow.Api.DTOs;

public class CreateJournalEntryDto
{
    public required string Title { get; set; }
    public string? Summary { get; set; }
    public DateOnly Date { get; set; }

    /// <summary>Minutes ahead of UTC (e.g. -300 for UTC-5). Null means not supplied; no carry-forward happens.</summary>
    public int? TimezoneOffsetMinutes { get; set; }
}
