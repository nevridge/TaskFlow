using System.Net;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>Finds or creates the journal entry for a date. The API has no by-date lookup, so this filters the list.</summary>
internal static class JournalResolver
{
    public static async Task<JournalEntryDto?> FindAsync(TaskFlowApiClient api, DateOnly date, CancellationToken ct) =>
        (await api.GetJournalEntriesAsync(ct)).FirstOrDefault(e => e.Date == date);

    public static async Task<JournalEntryDto> EnsureAsync(TaskFlowApiClient api, DateOnly date, CancellationToken ct)
    {
        if (await FindAsync(api, date, ct) is { } existing)
        {
            return existing;
        }

        try
        {
            return await api.CreateJournalEntryAsync(date, $"Journal {date:MM-dd-yyyy}", ct);
        }
        catch (TaskFlowApiException ex) when (ex.Status == HttpStatusCode.Conflict)
        {
            // Created concurrently (for example by the web app): use the entry that now exists.
            var found = await FindAsync(api, date, ct);
            if (found is null)
            {
                throw;
            }

            return found;
        }
    }
}
