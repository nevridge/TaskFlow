using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tools;

/// <summary>Shared task-history lookups used by weekly_review and list_tasks.</summary>
internal static class HistoryLookup
{
    public const int MaxHistoryLookups = 300;
    public const int HistoryParallelism = 8;
    public const string CompletedEvent = "Completed";

    internal static async Task<List<(TaskItemDto Task, List<TaskEventDto> Events)>> LoadHistoriesAsync(
        TaskFlowApiClient api, IReadOnlyList<TaskItemDto> tasks, CancellationToken ct)
    {
        using var gate = new SemaphoreSlim(HistoryParallelism);
        var results = await Task.WhenAll(tasks.Select(async task =>
        {
            await gate.WaitAsync(ct);
            try
            {
                return (task, events: await api.GetTaskHistoryAsync(task.Id, ct));
            }
            finally
            {
                gate.Release();
            }
        }));

        return [.. results];
    }

    internal static bool InRange(DateTime utc, TimeZoneInfo zone, DateOnly start, DateOnly end)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);
        var date = DateOnly.FromDateTime(local);
        return date >= start && date <= end;
    }
}
