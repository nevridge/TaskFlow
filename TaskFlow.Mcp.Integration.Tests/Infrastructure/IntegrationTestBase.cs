using TaskFlow.Mcp.Api;

namespace TaskFlow.Mcp.Integration.Tests.Infrastructure;

/// <summary>Gives every test its own API host and database (carry-forward and planning make shared state unsafe).</summary>
public abstract class IntegrationTestBase : IAsyncLifetime
{
    protected McpHarness Harness { get; private set; } = null!;

    protected TaskFlowApiClient Client => Harness.Client;

    protected static CancellationToken Ct => TestContext.Current.CancellationToken;

    public ValueTask InitializeAsync()
    {
        Harness = McpHarness.Create();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        if (Harness is not null)
        {
            await Harness.DisposeAsync();
        }

        GC.SuppressFinalize(this);
    }

    protected Task<TaskItemDto> CreateTaskAsync(
        string title,
        string status = "todo",
        int? parentId = null,
        DateOnly? journalDate = null,
        string? description = "Created by the integration tests",
        DateOnly? dueDate = null) =>
        Client.CreateTaskAsync(
            new CreateTaskRequest(
                title, description, status, "medium", dueDate ?? TestClock.Today().AddDays(7),
                journalDate, parentId, null, TestClock.OffsetMinutes),
            Ct);

    /// <summary>The PUT is full replace, so start from the current task and override what the test changes.</summary>
    protected Task<TaskItemDto> UpdateTaskAsync(
        TaskItemDto task,
        string? title = null,
        string? description = null,
        string? status = null,
        DateOnly? dueDate = null,
        string? blockedReason = null,
        DateOnly? journalDate = null) =>
        Client.UpdateTaskAsync(
            task.Id,
            new UpdateTaskRequest(
                title ?? task.Title,
                description ?? task.Description,
                status ?? task.Status.ToLowerInvariant(),
                task.Priority.ToLowerInvariant(),
                dueDate ?? task.DueDate,
                task.ParentTaskItemId,
                false,
                TestClock.OffsetMinutes,
                blockedReason,
                journalDate),
            Ct);
}
