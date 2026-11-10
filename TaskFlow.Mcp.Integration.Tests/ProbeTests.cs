using TaskFlow.Mcp.Integration.Tests.Infrastructure;

namespace TaskFlow.Mcp.Integration.Tests;

public sealed class ProbeTests : IntegrationTestBase
{
    [Fact]
    public async Task Create_WithoutDueDate_ReturnsNullDueDate()
    {
        // Catches a DueDate shape change that breaks the null case (client models DueDate as DateOnly?).
        var created = await Client.CreateTaskAsync(
            new TaskFlow.Mcp.Api.CreateTaskRequest("No due", null, "todo", "medium", null, null, null, null, TestClock.OffsetMinutes),
            Ct);

        Assert.Null(created.DueDate);
        Assert.Null((await Client.GetTaskAsync(created.Id, Ct)).DueDate);
    }

    [Fact]
    public async Task Journal_OnFreshDatabase_IsEmpty()
    {
        // Catches the journal read failing (or inventing entries) on an empty database.
        Assert.Empty(await Client.GetJournalEntriesAsync(Ct));
    }

    [Fact]
    public async Task Plan_OnToday_Twice_DoesNotDuplicateTodo()
    {
        // Catches a re-run of the same plan request attaching the task to the entry twice (idempotent re-run).
        var task = await CreateTaskAsync("Plan twice");
        await UpdateTaskAsync(task, journalDate: TestClock.Today());
        var again = await UpdateTaskAsync(task, journalDate: TestClock.Today());

        var entry = Assert.Single(await Client.GetJournalEntriesAsync(Ct));
        Assert.Single(entry.TodoTaskItemIds, id => id == task.Id);
        Assert.Equal(entry.Id, again.CurrentJournalEntryId);
    }
}
