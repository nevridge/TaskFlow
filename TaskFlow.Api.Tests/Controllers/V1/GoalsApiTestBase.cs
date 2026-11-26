using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TaskFlow.Api.Tests.Infrastructure;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>The real HTTP pipeline over its own database, with the setup calls the goal tests share.</summary>
public abstract class GoalsApiTestBase : IAsyncDisposable
{
    private readonly ApiVersioningFactory _factory = new();

    protected GoalsApiTestBase()
    {
        Client = _factory.CreateClient();
    }

    protected HttpClient Client { get; }

    protected static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _factory.DisposeAsync();
        GC.SuppressFinalize(this);
    }

    protected async Task<JsonElement> GetJsonAsync(string url) => await Client.GetFromJsonAsync<JsonElement>(url, Ct);

    protected async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, object? body = null)
    {
        using var request = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        using var response = await Client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        return (response.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone());
    }

    private async Task<int> CreateAsync(string url, object body)
    {
        var (status, json) = await SendAsync(HttpMethod.Post, url, body);
        Assert.Equal(HttpStatusCode.Created, status);
        return json.GetProperty("id").GetInt32();
    }

    protected Task<int> CreateProjectAsync(string name = "Alpha") => CreateAsync("/api/v1/Projects", new { name });

    protected Task<int> CreateGoalAsync(int projectId, string title, string status = "next") =>
        CreateAsync("/api/v1/Goals", new { projectId, title, status });

    protected Task<int> CreateTaskAsync(int projectId, string status = "todo", int? parentTaskItemId = null) =>
        CreateAsync("/api/v1/TaskItems", new { title = "Task", status, projectId, parentTaskItemId });

    protected async Task AssignAsync(int goalId, int taskItemId)
    {
        var (status, _) = await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{goalId}/tasks", new { taskItemId });
        Assert.Equal(HttpStatusCode.NoContent, status);
    }

    protected Task<JsonElement> GetTaskAsync(int id) => GetJsonAsync($"/api/v1/TaskItems/{id}");

    protected static int? GoalIdOf(JsonElement task) =>
        task.GetProperty("goalId") is { ValueKind: JsonValueKind.Number } id ? id.GetInt32() : null;
}
