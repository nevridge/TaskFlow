namespace TaskFlow.Api.DTOs;

/// <summary>Text to append to a journal entry's summary.</summary>
public class AppendJournalSummaryDto
{
    /// <summary>Trimmed, then required. Joined to a non-blank summary by a blank line.</summary>
    public string? Text { get; set; }
}
