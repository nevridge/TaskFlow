using System.Net;
using System.Text.Json;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// The goal contract over the real HTTP pipeline (JSON names, casing, routing and query binding), which the
/// assistant is written against.
/// </summary>
public sealed class GoalsHttpTests : GoalsApiTestBase
{
    [Fact]
    public async Task GoalJson_UsesTheContractNames_PascalCaseStatusAndUtcDates()
    {
        var projectId = await CreateProjectAsync();
        var (_, created) = await SendAsync(
            HttpMethod.Post, "/api/v1/Goals", new { projectId, title = "g", description = "d", doneWhen = "w" });
        var id = created.GetProperty("id").GetInt32();
        await AssignAsync(id, await CreateTaskAsync(projectId));
        await AssignAsync(id, await CreateTaskAsync(projectId, "completed"));

        var goal = await GetJsonAsync($"/api/v1/Goals/{id}");

        Assert.Equal(
            ["closedAt", "createdAt", "description", "displayOrder", "doneTaskCount", "doneWhen", "id", "openTaskCount",
                "parkedReason", "projectId", "status", "statusChangedAt", "title", "updatedAt"],
            goal.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal("Next", goal.GetProperty("status").GetString());
        Assert.Equal("w", goal.GetProperty("doneWhen").GetString());
        Assert.Equal(1, goal.GetProperty("openTaskCount").GetInt32());
        Assert.Equal(1, goal.GetProperty("doneTaskCount").GetInt32());
        Assert.EndsWith("Z", goal.GetProperty("statusChangedAt").GetString());
    }

    [Fact]
    public async Task List_BindsProjectAndStatus_AndRejectsAnUnknownStatus()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var now = await CreateGoalAsync(alpha, "now", "now");
        await CreateGoalAsync(alpha, "next");
        await CreateGoalAsync(beta, "other", "now");

        var filtered = await GetJsonAsync($"/api/v1/Goals?projectId={alpha}&status=now");
        var bad = await SendAsync(HttpMethod.Get, "/api/v1/Goals?status=soon");

        Assert.Equal(now, Assert.Single(filtered.EnumerateArray()).GetProperty("id").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, bad.Status);
    }

    [Fact]
    public async Task PutOrder_ReachesReorder_NotTheIdRoute()
    {
        var projectId = await CreateProjectAsync();
        var a = await CreateGoalAsync(projectId, "a");
        var b = await CreateGoalAsync(projectId, "b");

        var (status, goals) = await SendAsync(HttpMethod.Put, "/api/v1/Goals/order", new { projectId, goalIds = new[] { b, a } });
        var bad = await SendAsync(HttpMethod.Put, "/api/v1/Goals/order", new { projectId, goalIds = new[] { b } });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal([b, a], goals.EnumerateArray().Select(g => g.GetProperty("id").GetInt32()));
        Assert.Equal(HttpStatusCode.BadRequest, bad.Status);
    }

    [Fact]
    public async Task GoalRuleBodies_ListTheTasksInDetails()
    {
        var projectId = await CreateProjectAsync();
        var now = await CreateGoalAsync(projectId, "now", "now");
        var next = await CreateGoalAsync(projectId, "next");
        var running = await CreateTaskAsync(projectId, "inProgress");
        await AssignAsync(now, running);

        var swap = await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{next}/swap-now");
        var close = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{now}", new { title = "now", status = "done" });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, swap.Status);
        Assert.Equal("GOAL_NOW_HAS_INPROGRESS_TASKS", swap.Body.GetProperty("code").GetString());
        Assert.Equal(now, swap.Body.GetProperty("details").GetProperty("goalId").GetInt32());
        var named = Assert.Single(swap.Body.GetProperty("details").GetProperty("tasks").EnumerateArray());
        Assert.Equal(running, named.GetProperty("id").GetInt32());
        Assert.Equal("Task", named.GetProperty("title").GetString());

        Assert.Equal(HttpStatusCode.UnprocessableEntity, close.Status);
        Assert.Equal("GOAL_HAS_OPEN_TASKS", close.Body.GetProperty("code").GetString());
        Assert.Equal(1, close.Body.GetProperty("details").GetProperty("openCount").GetInt32());
        Assert.Equal(running, close.Body.GetProperty("details").GetProperty("tasks")[0].GetProperty("id").GetInt32());
    }

    [Fact]
    public async Task EveryTaskResponseSource_CarriesTheGoal()
    {
        var projectId = await CreateProjectAsync();
        var goal = await CreateGoalAsync(projectId, "Ship");
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var (_, created) = await SendAsync(
            HttpMethod.Post, "/api/v1/TaskItems", new { title = "t", status = "todo", projectId, journalDate = today });
        var taskId = created.GetProperty("id").GetInt32();
        await AssignAsync(goal, taskId);
        var entryId = (await GetJsonAsync("/api/v1/JournalEntries"))[0].GetProperty("id").GetInt32();

        JsonElement[] rows =
        [
            await GetTaskAsync(taskId),
            (await GetJsonAsync("/api/v1/TaskItems"))[0],
            (await GetJsonAsync($"/api/v1/Projects/{projectId}/tasks"))[0],
            (await GetJsonAsync($"/api/v1/JournalEntries/{entryId}/todos"))[0],
        ];

        Assert.All(rows, row =>
        {
            Assert.Equal(goal, GoalIdOf(row));
            Assert.Equal("Ship", row.GetProperty("goalTitle").GetString());
        });
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    public async Task CreateAndUpdateResponses_CarryTheGoalTakenFromAParent(string method)
    {
        var projectId = await CreateProjectAsync();
        var first = await CreateGoalAsync(projectId, "First");
        var second = await CreateGoalAsync(projectId, "Second");
        var parentA = await CreateTaskAsync(projectId);
        var parentB = await CreateTaskAsync(projectId);
        var bare = await CreateTaskAsync(projectId);
        await AssignAsync(first, parentA);
        await AssignAsync(second, parentB);

        var (_, child) = await SendAsync(
            HttpMethod.Post, "/api/v1/TaskItems", new { title = "c", status = "todo", projectId, parentTaskItemId = parentA });
        var url = $"/api/v1/TaskItems/{child.GetProperty("id").GetInt32()}";
        async Task<JsonElement> Reparent(int? parentTaskItemId) =>
            (await SendAsync(new HttpMethod(method), url, new { title = "c", parentTaskItemId })).Body;

        var moved = await Reparent(parentB);
        var detached = await Reparent(null);
        var underBare = await Reparent(bare);

        Assert.Equal("First", child.GetProperty("goalTitle").GetString());
        Assert.Equal(second, GoalIdOf(moved));
        Assert.Equal("Second", moved.GetProperty("goalTitle").GetString());
        Assert.Equal(second, GoalIdOf(detached));
        Assert.Null(GoalIdOf(underBare));
        Assert.Equal(JsonValueKind.Null, underBare.GetProperty("goalTitle").ValueKind);
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    public async Task ATaskUpdateWithoutAGoalField_KeepsTheGoal(string method)
    {
        var projectId = await CreateProjectAsync();
        var goal = await CreateGoalAsync(projectId, "g");
        var task = await CreateTaskAsync(projectId);
        await AssignAsync(goal, task);

        var (status, body) = await SendAsync(
            new HttpMethod(method), $"/api/v1/TaskItems/{task}", new { title = "renamed", status = "inProgress" });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(goal, GoalIdOf(body));
        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(task)));
    }
}
