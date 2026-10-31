using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Time.Testing;
using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Tests;

internal sealed record RecordedRequest(HttpMethod Method, string Path, string? Body);

/// <summary>
/// Stub for the TaskFlow API. Routes match on method + path (relative to /api/v1/). Several responses for the
/// same route are served in order, with the last one repeating. Unrouted requests return 404.
/// </summary>
internal sealed class StubHandler : HttpMessageHandler
{
    private readonly Dictionary<(HttpMethod, string), Queue<Func<HttpResponseMessage>>> _routes = [];

    private readonly object _gate = new();

    public List<RecordedRequest> Requests { get; } = [];

    public Exception? Throw { get; set; }

    public StubHandler On(HttpMethod method, string path, object? body = null, HttpStatusCode status = HttpStatusCode.OK)
    {
        var key = (method, path);
        if (!_routes.TryGetValue(key, out var queue))
        {
            _routes[key] = queue = new Queue<Func<HttpResponseMessage>>();
        }

        queue.Enqueue(() => Respond(status, body));
        return this;
    }

    public StubHandler Fail(HttpMethod method, string path, Exception exception)
    {
        var key = (method, path);
        if (!_routes.TryGetValue(key, out var queue))
        {
            _routes[key] = queue = new Queue<Func<HttpResponseMessage>>();
        }

        queue.Enqueue(() => throw exception);
        return this;
    }

    public StubHandler Get(string path, object? body) => On(HttpMethod.Get, path, body);

    public StubHandler Post(string path, object? body = null, HttpStatusCode status = HttpStatusCode.OK) => On(HttpMethod.Post, path, body, status);

    public StubHandler Put(string path, object? body = null, HttpStatusCode status = HttpStatusCode.OK) => On(HttpMethod.Put, path, body, status);

    public StubHandler Delete(string path, HttpStatusCode status = HttpStatusCode.NoContent, object? body = null) => On(HttpMethod.Delete, path, body, status);

    public IEnumerable<RecordedRequest> Sent(HttpMethod method, string path) =>
        Requests.Where(r => r.Method == method && r.Path == path);

    public JsonElement BodyOf(HttpMethod method, string path) =>
        JsonDocument.Parse(Sent(method, path).Last().Body!).RootElement;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (Throw is not null)
        {
            throw Throw;
        }

        var path = request.RequestUri!.AbsolutePath["/api/v1/".Length..];
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);

        Func<HttpResponseMessage>? next = null;
        lock (_gate)
        {
            Requests.Add(new RecordedRequest(request.Method, path, body));
            if (_routes.TryGetValue((request.Method, path), out var queue))
            {
                next = queue.Count > 1 ? queue.Dequeue() : queue.Peek();
            }
        }

        return next is null ? new HttpResponseMessage(HttpStatusCode.NotFound) : next();
    }

    private static HttpResponseMessage Respond(HttpStatusCode status, object? body)
    {
        var response = new HttpResponseMessage(status);
        if (body is not null)
        {
            var json = body is string s ? s : JsonSerializer.Serialize(body, TaskFlowApiClient.Json);
            response.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        return response;
    }
}

/// <summary>
/// Fixed-instant clock that counts reads. GetLocalNow is non-virtual and calls GetUtcNow, so we count GetUtcNow.
/// </summary>
internal sealed class CountingTimeProvider : TimeProvider
{
    private readonly TimeZoneInfo _zone;
    private readonly DateTimeOffset _utc;

    public CountingTimeProvider(int offsetMinutes = -420, DateTimeOffset? utc = null)
    {
        // CreateCustomTimeZone needs whole-minute offsets within +/-14h.
        _zone = TimeZoneInfo.CreateCustomTimeZone("test", TimeSpan.FromMinutes(offsetMinutes), "test", "test");
        _utc = utc ?? new DateTimeOffset(2026, 10, 9, 17, 0, 0, TimeSpan.Zero);
    }

    public int UtcReads { get; set; }

    public override TimeZoneInfo LocalTimeZone => _zone;

    public override DateTimeOffset GetUtcNow()
    {
        UtcReads++;
        return _utc;
    }
}

internal static class Fixtures
{
    // 2026-10-09 10:00 local at UTC-7 (17:00Z)
    public static readonly DateOnly Today = new(2026, 10, 9);

    public static FakeTimeProvider Time()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 10, 9, 17, 0, 0, TimeSpan.Zero));
        time.SetLocalTimeZone(TimeZoneInfo.CreateCustomTimeZone("test", TimeSpan.FromHours(-7), "test", "test"));
        return time;
    }

    public static FakeTimeProvider Time(DateTimeOffset utc, int offsetMinutes)
    {
        var time = new FakeTimeProvider(utc);
        time.SetLocalTimeZone(TimeZoneInfo.CreateCustomTimeZone("test", TimeSpan.FromMinutes(offsetMinutes), "test", "test"));
        return time;
    }

    public static TaskFlowApiClient Client(StubHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://localhost:8081/api/v1/") });

    public static object Task(
        int id,
        string title = "Task",
        string status = "Todo",
        string priority = "Low",
        string? due = null,
        int? projectId = null,
        string? projectName = null,
        int? parentId = null,
        bool isComplete = false,
        int moveCount = 0,
        int daysTagged = 0,
        string? plannedOn = null,
        string? description = null,
        string? blockedReason = null,
        string? blockedAt = null,
        string? previousStatus = null,
        int childTaskCount = 0,
        string? startedAt = null) => new
        {
            id,
            title,
            description,
            isComplete,
            dueDate = due,
            status,
            priority,
            parentTaskItemId = parentId,
            projectId,
            projectName,
            currentJournalEntryId = (int?)null,
            childTaskCount,
            currentJournalDate = plannedOn,
            moveCount,
            daysTagged,
            blockedReason,
            blockedAt,
            previousStatus,
            startedAt,
        };

    public static object Project(int id, string name, bool archived = false, int open = 0, int done = 0, string? description = null, int blockedCount = 0) => new
    {
        id,
        name,
        description,
        isArchived = archived,
        createdAt = "2026-10-01T00:00:00Z",
        openTaskCount = open,
        completedTaskCount = done,
        blockedCount,
    };

    public static object Journal(int id, string date, string? summary = null, object[]? logs = null) => new
    {
        id,
        title = $"Journal {date}",
        summary,
        date,
        createdAt = "2026-10-09T00:00:00Z",
        todoTaskItemIds = Array.Empty<int>(),
        logEntries = logs ?? [],
    };

    public static object Event(int taskId, string type, string utc, string? summary = null) => new
    {
        id = 1,
        taskItemId = taskId,
        eventType = type,
        occurredAtUtc = utc,
        changeSummary = summary,
    };
}
