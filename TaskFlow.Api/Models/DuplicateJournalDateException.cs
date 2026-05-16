namespace TaskFlow.Api.Models;

public class DuplicateJournalDateException(DateOnly date)
    : Exception($"A journal entry already exists for {date:O}.")
{
    public DateOnly Date { get; } = date;
}
