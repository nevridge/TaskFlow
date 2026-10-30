namespace TaskFlow.Api.Repositories;

internal sealed record MoveEventProjection(int Id, DateTime OccurredAtUtc, DateOnly? From, DateOnly? To);

/// <summary>
/// Single copy of the "last moved date" rule: the latest event (by OccurredAtUtc) that carries a journal date,
/// resolved as ToJournalDate ?? FromJournalDate. Ties on OccurredAtUtc resolve to the lowest event Id.
/// </summary>
internal static class LastMovedDateResolver
{
    public static DateOnly? Resolve(IEnumerable<MoveEventProjection> events) =>
        events
            .Where(e => (e.To ?? e.From).HasValue)
            .OrderByDescending(e => e.OccurredAtUtc)
            .ThenBy(e => e.Id)
            .Select(e => e.To ?? e.From)
            .FirstOrDefault();
}
