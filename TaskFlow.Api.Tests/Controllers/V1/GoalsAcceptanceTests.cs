using System.Net;
using System.Text.Json;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>Acceptance criteria of #491 that the focused goal tests do not reach, over the real HTTP pipeline.</summary>
public sealed class GoalsAcceptanceTests : GoalsApiTestBase
{
    private Task<(HttpStatusCode Status, JsonElement Body)> PatchTaskAsync(int id, object body) =>
        SendAsync(HttpMethod.Patch, $"/api/v1/TaskItems/{id}", body);

    private async Task<int[]> GoalIdsAsync(int projectId) =>
        [.. (await GetJsonAsync($"/api/v1/Goals?projectId={projectId}")).EnumerateArray().Select(g => g.GetProperty("id").GetInt32())];

    [Fact]
    public async Task Create_AllowsADuplicateTitle_AndPlacesTheGoalAfterTheReorderedNextGoals()
    {
        var projectId = await CreateProjectAsync();
        var a = await CreateGoalAsync(projectId, "Same");
        var b = await CreateGoalAsync(projectId, "Same");
        await SendAsync(HttpMethod.Put, "/api/v1/Goals/order", new { projectId, goalIds = new[] { b, a } });

        var c = await CreateGoalAsync(projectId, "Same");

        Assert.Equal([b, a, c], await GoalIdsAsync(projectId));
    }

    [Fact]
    public async Task Put_ReplacesEveryEditableField_AndCannotMoveTheGoalToAnotherProject()
    {
        var projectId = await CreateProjectAsync();
        var other = await CreateProjectAsync("Beta");
        var id = await CreateGoalAsync(projectId, "Old");

        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{id}",
            new { title = " New ", description = "Why", doneWhen = "Shipped", status = "next", projectId = other });
        var edited = await GetJsonAsync($"/api/v1/Goals/{id}");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{id}", new { title = "New", status = "next" });
        var cleared = await GetJsonAsync($"/api/v1/Goals/{id}");

        Assert.Equal("New", edited.GetProperty("title").GetString());
        Assert.Equal("Why", edited.GetProperty("description").GetString());
        Assert.Equal("Shipped", edited.GetProperty("doneWhen").GetString());
        Assert.Equal(projectId, edited.GetProperty("projectId").GetInt32());
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("description").ValueKind);
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("doneWhen").ValueKind);
    }

    [Fact]
    public async Task ParkedWithoutAReason_Returns400WithAMessage()
    {
        var projectId = await CreateProjectAsync();
        var id = await CreateGoalAsync(projectId, "g");

        var (status, body) = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{id}", new { title = "g", status = "parked" });

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.True(
            body.ValueKind == JsonValueKind.Object && body.TryGetProperty("message", out _),
            "Expected { message }, got: " + body.GetRawText());
    }

    /// <summary>The reason check comes before the in-progress rule, so this is a 400 and not a 422.</summary>
    [Fact]
    public async Task ParkingTheBusyNowGoal_WithABlankReason_Returns400WithAMessage_AndSavesNothing()
    {
        var projectId = await CreateProjectAsync();
        var now = await CreateGoalAsync(projectId, "Current", "now");
        await AssignAsync(now, await CreateTaskAsync(projectId, "inProgress"));

        var (status, body) = await SendAsync(
            HttpMethod.Put, $"/api/v1/Goals/{now}", new { title = "renamed", status = "parked", parkedReason = "  " });

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.NotEmpty(body.GetProperty("message").GetString()!);
        var stored = await GetJsonAsync($"/api/v1/Goals/{now}");
        Assert.Equal("Now", stored.GetProperty("status").GetString());
        Assert.Equal("Current", stored.GetProperty("title").GetString());
    }

    [Theory]
    [InlineData("next")]
    [InlineData("parked")]
    public async Task Put_ToNow_WithNoNowGoal_IsAPlainStatusChange(string from)
    {
        var projectId = await CreateProjectAsync();
        var id = await CreateGoalAsync(projectId, "g");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{id}", new { title = "g", status = from, parkedReason = "later" });

        var (status, goal) = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{id}", new { title = "g", status = "now" });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("Now", goal.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, goal.GetProperty("parkedReason").ValueKind);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task WithANowGoal_TasksInIt_AndTasksWithoutAGoal_CanBeStartedAndCompleted(bool inNowGoal)
    {
        var projectId = await CreateProjectAsync();
        var now = await CreateGoalAsync(projectId, "Current", "now");
        var task = await CreateTaskAsync(projectId);
        if (inNowGoal)
        {
            await AssignAsync(now, task);
        }

        var started = await PatchTaskAsync(task, new { status = "inProgress" });
        var completed = await PatchTaskAsync(task, new { status = "completed" });

        Assert.Equal(HttpStatusCode.OK, started.Status);
        Assert.Equal(HttpStatusCode.OK, completed.Status);
    }

    [Fact]
    public async Task OpenCountIncludesSubtasks_AndCompletingTheLastTaskDoesNotCloseTheGoal()
    {
        var projectId = await CreateProjectAsync();
        var goal = await CreateGoalAsync(projectId, "g");
        var parent = await CreateTaskAsync(projectId);
        var child = await CreateTaskAsync(projectId, parentTaskItemId: parent);
        await AssignAsync(goal, parent);

        var before = await GetJsonAsync($"/api/v1/Goals/{goal}");
        await PatchTaskAsync(child, new { status = "completed" });
        await PatchTaskAsync(parent, new { status = "completed" });
        var after = await GetJsonAsync($"/api/v1/Goals/{goal}");

        Assert.Equal(2, before.GetProperty("openTaskCount").GetInt32());
        Assert.Equal(0, after.GetProperty("openTaskCount").GetInt32());
        Assert.Equal(2, after.GetProperty("doneTaskCount").GetInt32());
        Assert.Equal("Next", after.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, after.GetProperty("closedAt").ValueKind);
    }

    [Fact]
    public async Task GoalAssignment_RefusesAProjectlessTaskAndStartedWork_ThenRemovalKeepsTheProject()
    {
        var projectId = await CreateProjectAsync();
        var now = await CreateGoalAsync(projectId, "Current", "now");
        var next = await CreateGoalAsync(projectId, "Later");
        var (_, loose) = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new { title = "loose", status = "todo" });
        var running = await CreateTaskAsync(projectId, "inProgress");

        var projectless = await SendAsync(
            HttpMethod.Post, $"/api/v1/Goals/{next}/tasks", new { taskItemId = loose.GetProperty("id").GetInt32() });
        var notNow = await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{next}/tasks", new { taskItemId = running });
        var untouched = GoalIdOf(await GetTaskAsync(running));
        await AssignAsync(now, running);
        var removed = await SendAsync(HttpMethod.Delete, $"/api/v1/Goals/{now}/tasks/{running}");
        var after = await GetTaskAsync(running);

        Assert.Equal(HttpStatusCode.BadRequest, projectless.Status);
        Assert.NotEmpty(projectless.Body.GetProperty("message").GetString()!);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, notNow.Status);
        Assert.Equal("TASK_GOAL_NOT_NOW", notNow.Body.GetProperty("code").GetString());
        Assert.Equal(running, notNow.Body.GetProperty("details").GetProperty("taskItemId").GetInt32());
        Assert.Equal(now, notNow.Body.GetProperty("details").GetProperty("nowGoalId").GetInt32());
        Assert.Null(untouched);
        Assert.Equal(HttpStatusCode.NoContent, removed.Status);
        Assert.Null(GoalIdOf(after));
        Assert.Equal(projectId, after.GetProperty("projectId").GetInt32());
    }

    [Fact]
    public async Task ASubtaskInAnotherProject_GetsNoGoal_WhenCreatedOrMovedUnderTheParent()
    {
        var projectId = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var goal = await CreateGoalAsync(projectId, "g");
        var parent = await CreateTaskAsync(projectId);
        await AssignAsync(goal, parent);

        var created = await CreateTaskAsync(beta, parentTaskItemId: parent);
        var moved = await CreateTaskAsync(beta);
        var (status, body) = await PatchTaskAsync(moved, new { parentTaskItemId = parent });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Null(GoalIdOf(await GetTaskAsync(created)));
        Assert.Null(GoalIdOf(body));
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    public async Task AGoalIdInATaskUpdateBody_IsNotApplied(string method)
    {
        var projectId = await CreateProjectAsync();
        var first = await CreateGoalAsync(projectId, "First");
        var second = await CreateGoalAsync(projectId, "Second");
        var task = await CreateTaskAsync(projectId);
        await AssignAsync(first, task);

        var (status, _) = await SendAsync(
            new HttpMethod(method), $"/api/v1/TaskItems/{task}", new { title = "t", status = "todo", goalId = second });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(first, GoalIdOf(await GetTaskAsync(task)));
    }

    [Fact]
    public async Task ASecondNowGoal_Returns409_PointingToSwap()
    {
        var projectId = await CreateProjectAsync();
        await CreateGoalAsync(projectId, "current", "now");
        var other = await CreateGoalAsync(projectId, "other");

        var create = await SendAsync(HttpMethod.Post, "/api/v1/Goals", new { projectId, title = "g", status = "now" });
        var edit = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{other}", new { title = "other", status = "now" });

        foreach (var (status, body) in new[] { create, edit })
        {
            Assert.Equal(HttpStatusCode.Conflict, status);
            Assert.Contains("swap", body.GetProperty("message").GetString()!, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task SimpleRefusals_Return400_WithAMessage()
    {
        var projectId = await CreateProjectAsync();
        var open = await CreateGoalAsync(projectId, "open");
        var done = await CreateGoalAsync(projectId, "done");
        var dropped = await CreateGoalAsync(projectId, "dropped");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{done}", new { title = "done", status = "done" });
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{dropped}", new { title = "dropped", status = "dropped" });
        var parent = await CreateTaskAsync(projectId);
        var child = await CreateTaskAsync(projectId, parentTaskItemId: parent);

        (HttpMethod Method, string Url, object? Body)[] requests =
        [
            (HttpMethod.Put, "/api/v1/Goals/order", new { projectId, goalIds = new[] { open, open } }),
            (HttpMethod.Post, $"/api/v1/Goals/{done}/swap-now", null),
            (HttpMethod.Post, $"/api/v1/Goals/{done}/tasks", new { taskItemId = parent }),
            (HttpMethod.Post, $"/api/v1/Goals/{dropped}/tasks", new { taskItemId = parent }),
            (HttpMethod.Post, $"/api/v1/Goals/{open}/tasks", new { taskItemId = child }),
            (HttpMethod.Delete, $"/api/v1/Goals/{open}/tasks/{child}", null),
        ];

        foreach (var (method, url, body) in requests)
        {
            var (status, json) = await SendAsync(method, url, body);

            Assert.True(status == HttpStatusCode.BadRequest, $"{method} {url} returned {status}");
            Assert.False(string.IsNullOrWhiteSpace(json.GetProperty("message").GetString()));
        }

        Assert.Null(GoalIdOf(await GetTaskAsync(parent)));
    }

    [Fact]
    public async Task AnArchivedProjectsGoals_AreStillListed()
    {
        var projectId = await CreateProjectAsync();
        var goal = await CreateGoalAsync(projectId, "g", "now");

        var (status, project) = await SendAsync(
            HttpMethod.Put, $"/api/v1/Projects/{projectId}", new { name = "Alpha", isArchived = true });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.True(project.GetProperty("isArchived").GetBoolean());
        Assert.Equal([goal], await GoalIdsAsync(projectId));
    }
}
