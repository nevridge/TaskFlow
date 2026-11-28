using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TaskFlow.Mcp.Api;

/// <summary>Typed client for the TaskFlow REST API (/api/v1). Failures surface as <see cref="TaskFlowApiException"/>.</summary>
public sealed class TaskFlowApiClient(HttpClient http)
{
    internal static JsonSerializerOptions Json { get; } = new(JsonSerializerDefaults.Web);

    private const int ResponseSnippetLength = 300;

    public string BaseUrl => http.BaseAddress?.GetLeftPart(UriPartial.Authority) ?? string.Empty;

    // --- Tasks ---

    public Task<List<TaskItemDto>> GetTasksAsync(CancellationToken ct) =>
        SendAsync<List<TaskItemDto>>(HttpMethod.Get, "TaskItems", null, ct);

    public Task<TaskItemDto> GetTaskAsync(int id, CancellationToken ct) =>
        SendAsync<TaskItemDto>(HttpMethod.Get, $"TaskItems/{id}", null, ct);

    public Task<TaskItemDto> CreateTaskAsync(CreateTaskRequest request, CancellationToken ct) =>
        SendAsync<TaskItemDto>(HttpMethod.Post, "TaskItems", request, ct);

    public Task<TaskItemDto> UpdateTaskAsync(int id, UpdateTaskRequest request, CancellationToken ct) =>
        SendAsync<TaskItemDto>(HttpMethod.Put, $"TaskItems/{id}", request, ct);

    /// <summary>
    /// PATCH: a property left out of <paramref name="patch"/> keeps its value, an explicit null clears it. The project and
    /// goal are part of the same request, so a refusal saves nothing.
    /// </summary>
    public Task<TaskItemDto> PatchTaskAsync(int id, TaskPatch patch, CancellationToken ct) =>
        SendAsync<TaskItemDto>(HttpMethod.Patch, $"TaskItems/{id}", patch.ToJson(), ct);

    public Task DeleteTaskAsync(int id, CancellationToken ct) =>
        SendAsync(HttpMethod.Delete, $"TaskItems/{id}", null, ct);

    public Task<List<TaskEventDto>> GetTaskHistoryAsync(int id, CancellationToken ct) =>
        SendAsync<List<TaskEventDto>>(HttpMethod.Get, $"TaskItems/{id}/history", null, ct);

    public Task<List<NoteDto>> GetTaskNotesAsync(int taskId, CancellationToken ct) =>
        SendAsync<List<NoteDto>>(HttpMethod.Get, $"TaskItems/{taskId}/notes", null, ct);

    public Task<NoteDto> AddTaskNoteAsync(int taskId, string content, CancellationToken ct) =>
        SendAsync<NoteDto>(HttpMethod.Post, $"TaskItems/{taskId}/notes", new { content }, ct);

    // --- Projects ---

    public Task<List<ProjectDto>> GetProjectsAsync(CancellationToken ct) =>
        SendAsync<List<ProjectDto>>(HttpMethod.Get, "Projects", null, ct);

    public Task<ProjectDto> CreateProjectAsync(string name, string? description, int? areaId, CancellationToken ct) =>
        SendAsync<ProjectDto>(HttpMethod.Post, "Projects", new { name, description, areaId }, ct);

    /// <summary>The project PUT is full-replace: a null areaId removes the project from its area.</summary>
    public Task<ProjectDto> UpdateProjectAsync(int id, string name, string? description, bool isArchived, int? areaId, CancellationToken ct) =>
        SendAsync<ProjectDto>(HttpMethod.Put, $"Projects/{id}", new { name, description, isArchived, areaId }, ct);

    // --- Areas ---

    public Task<List<AreaDto>> GetAreasAsync(CancellationToken ct) =>
        SendAsync<List<AreaDto>>(HttpMethod.Get, "Areas", null, ct);

    public Task<AreaDto> CreateAreaAsync(string name, CancellationToken ct) =>
        SendAsync<AreaDto>(HttpMethod.Post, "Areas", new { name }, ct);

    public Task<AreaDto> UpdateAreaAsync(int id, string name, CancellationToken ct) =>
        SendAsync<AreaDto>(HttpMethod.Put, $"Areas/{id}", new { name }, ct);

    /// <summary>Sends only the choices that are supplied; the API rejects more than one.</summary>
    public Task DeleteAreaAsync(int id, int? moveToAreaId, string? newAreaName, bool noArea, CancellationToken ct)
    {
        var query = new List<string>();
        if (moveToAreaId is { } target)
        {
            query.Add($"moveToAreaId={target}");
        }

        if (newAreaName is not null)
        {
            query.Add($"newAreaName={Uri.EscapeDataString(newAreaName)}");
        }

        if (noArea)
        {
            query.Add("noArea=true");
        }

        var path = query.Count == 0 ? $"Areas/{id}" : $"Areas/{id}?{string.Join('&', query)}";
        return SendAsync(HttpMethod.Delete, path, null, ct);
    }

    // --- Goals ---

    /// <summary>A project's goals, in the API's order: Now, Next, Parked, then Done and Dropped.</summary>
    public Task<List<GoalDto>> GetGoalsAsync(int projectId, CancellationToken ct) =>
        SendAsync<List<GoalDto>>(HttpMethod.Get, $"Goals?projectId={projectId}", null, ct);

    public Task<GoalDto> CreateGoalAsync(CreateGoalRequest request, CancellationToken ct) =>
        SendAsync<GoalDto>(HttpMethod.Post, "Goals", request, ct);

    public Task<GoalDto> UpdateGoalAsync(int id, UpdateGoalRequest request, CancellationToken ct) =>
        SendAsync<GoalDto>(HttpMethod.Put, $"Goals/{id}", request, ct);

    /// <summary><paramref name="goalIds"/> must hold every Next goal of the project exactly once.</summary>
    public Task ReorderGoalsAsync(int projectId, IReadOnlyList<int> goalIds, CancellationToken ct) =>
        SendAsync(HttpMethod.Put, "Goals/order", new { projectId, goalIds }, ct);

    public Task<GoalDto> SwapNowGoalAsync(int id, CancellationToken ct) =>
        SendAsync<GoalDto>(HttpMethod.Post, $"Goals/{id}/swap-now", null, ct);

    public Task DeleteGoalAsync(int id, CancellationToken ct) =>
        SendAsync(HttpMethod.Delete, $"Goals/{id}", null, ct);

    public Task AssignTaskToGoalAsync(int goalId, int taskItemId, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, $"Goals/{goalId}/tasks", new { taskItemId }, ct);

    public Task RemoveTaskFromGoalAsync(int goalId, int taskItemId, CancellationToken ct) =>
        SendAsync(HttpMethod.Delete, $"Goals/{goalId}/tasks/{taskItemId}", null, ct);

    // --- Journal ---

    public Task<List<JournalEntryDto>> GetJournalEntriesAsync(CancellationToken ct) =>
        SendAsync<List<JournalEntryDto>>(HttpMethod.Get, "JournalEntries", null, ct);

    public Task<JournalEntryDto> CreateJournalEntryAsync(DateOnly date, string title, int timezoneOffsetMinutes, CancellationToken ct) =>
        SendAsync<JournalEntryDto>(HttpMethod.Post, "JournalEntries", new { title, summary = (string?)null, date, timezoneOffsetMinutes }, ct);

    public Task<JournalEntryDto> UpdateJournalEntryAsync(int id, string title, string? summary, CancellationToken ct) =>
        SendAsync<JournalEntryDto>(HttpMethod.Put, $"JournalEntries/{id}", new { title, summary }, ct);

    /// <summary>Atomic on the server: trims the text and adds it after the existing summary and a blank line. Returns the updated entry.</summary>
    public Task<JournalEntryDto> AppendJournalSummaryAsync(int id, string text, CancellationToken ct) =>
        SendAsync<JournalEntryDto>(HttpMethod.Post, $"JournalEntries/{id}/summary/append", new { text }, ct);

    public Task<List<TaskItemDto>> GetJournalTodosAsync(int entryId, CancellationToken ct) =>
        SendAsync<List<TaskItemDto>>(HttpMethod.Get, $"JournalEntries/{entryId}/todos", null, ct);

    public Task AddJournalTodoAsync(int entryId, int taskItemId, int timezoneOffsetMinutes, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, $"JournalEntries/{entryId}/todos", new { taskItemId, timezoneOffsetMinutes }, ct);

    public Task RemoveJournalTodoAsync(int entryId, int taskItemId, CancellationToken ct) =>
        SendAsync(HttpMethod.Delete, $"JournalEntries/{entryId}/todos/{taskItemId}", null, ct);

    public Task<LogEntryDto> AddLogEntryAsync(int entryId, string content, int? taskItemId, CancellationToken ct) =>
        SendAsync<LogEntryDto>(HttpMethod.Post, $"JournalEntries/{entryId}/logs", new { content, taskItemId }, ct);

    public Task<List<NoteDto>> GetJournalNotesAsync(int entryId, CancellationToken ct) =>
        SendAsync<List<NoteDto>>(HttpMethod.Get, $"JournalEntries/{entryId}/notes", null, ct);

    public Task<NoteDto> AddJournalNoteAsync(int entryId, string content, CancellationToken ct) =>
        SendAsync<NoteDto>(HttpMethod.Post, $"JournalEntries/{entryId}/notes", new { content }, ct);

    // --- Plumbing ---

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var response = await SendCoreAsync(method, path, body, ct);
        var result = await response.Content.ReadFromJsonAsync<T>(Json, ct);
        return result ?? throw new TaskFlowApiException(response.StatusCode, null, $"{method} {path} returned an empty response.");
    }

    private async Task SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var response = await SendCoreAsync(method, path, body, ct);
    }

    private async Task<HttpResponseMessage> SendCoreAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType(), options: Json);
        }

        var response = await http.SendAsync(request, ct);
        if (response.IsSuccessStatusCode)
        {
            return response;
        }

        try
        {
            throw await ToExceptionAsync(method, path, response, ct);
        }
        finally
        {
            response.Dispose();
        }
    }

    internal static async Task<TaskFlowApiException> ToExceptionAsync(HttpMethod method, string path, HttpResponseMessage response, CancellationToken ct)
    {
        var raw = response.Content is null ? string.Empty : await response.Content.ReadAsStringAsync(ct);

        if ((int)response.StatusCode >= 500)
        {
            // Never relay server stack traces to the model; point at the API logs instead.
            return new TaskFlowApiException(
                response.StatusCode,
                null,
                $"The TaskFlow API failed with {(int)response.StatusCode} on {method} {path}. This is a server-side error; check the API logs (Seq, http://localhost:5380).");
        }

        var (code, message, details) = ParseError(raw);

        if (response.StatusCode == HttpStatusCode.NotFound && code is null)
        {
            message = $"Not found ({method} {path}): the item does not exist.";
        }

        message ??= response.StatusCode switch
        {
            HttpStatusCode.NotFound => $"Not found ({method} {path}): the item does not exist.",
            _ => $"{method} {path} failed with {(int)response.StatusCode} {response.ReasonPhrase}."
                + (raw.Length > 0 ? $" {Truncate(raw)}" : string.Empty),
        };

        return new TaskFlowApiException(response.StatusCode, code, code is null ? message : $"{message} [{code}]", details);
    }

    /// <summary>
    /// Understands the API's error shapes: { code, message }, { message }, a FluentValidation array,
    /// and ASP.NET ProblemDetails with an errors map.
    /// </summary>
    private static (string? Code, string? Message, JsonElement? Details) ParseError(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return (null, null, null);
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;

            if (root.ValueKind == JsonValueKind.Array)
            {
                var failures = root.EnumerateArray()
                    .Select(e => (Prop: GetString(e, "propertyName"), Msg: GetString(e, "errorMessage")))
                    .Where(f => f.Msg is not null)
                    .Select(f => string.IsNullOrEmpty(f.Prop) ? f.Msg! : $"{f.Prop}: {f.Msg}")
                    .ToList();
                return (null, failures.Count > 0 ? "Validation failed - " + string.Join("; ", failures) : null, null);
            }

            if (root.ValueKind != JsonValueKind.Object)
            {
                return (null, null, null);
            }

            var code = GetString(root, "code");
            var message = GetString(root, "message");
            // Cloned: the element must outlive the document.
            JsonElement? details = root.TryGetProperty("details", out var found) ? found.Clone() : null;
            if (message is not null)
            {
                return (code, message, details);
            }

            if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Object)
            {
                var items = errors.EnumerateObject()
                    .SelectMany(p => p.Value.ValueKind == JsonValueKind.Array
                        ? p.Value.EnumerateArray().Select(v => $"{p.Name}: {v.GetString()}")
                        : [$"{p.Name}: {p.Value}"]);
                // ASP.NET ProblemDetails extensions serialize at the root, so a root "code" is the API error code.
                return (code, "Validation failed - " + string.Join("; ", items), details);
            }

            return (code, GetString(root, "title"), details);
        }
        catch (JsonException)
        {
            return (null, null, null);
        }
    }

    private static string? GetString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string Truncate(string value) =>
        value.Length <= ResponseSnippetLength ? value : value[..ResponseSnippetLength] + "...";
}
