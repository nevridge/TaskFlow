using System.Net;
using System.Text.Json;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// The single-Now rule on the task write paths (<c>TASK_GOAL_NOT_NOW</c>), end to end so that "nothing saved" means
/// nothing in the database.
/// </summary>
public sealed class TaskGoalRuleTests : GoalsApiTestBase
{
    private async Task<(int ProjectId, int Now, int Next)> SetupAsync()
    {
        var projectId = await CreateProjectAsync();
        var now = await CreateGoalAsync(projectId, "Current", "now");
        var next = await CreateGoalAsync(projectId, "Later");
        return (projectId, now, next);
    }

    private async Task<int> CreateInGoalAsync(int projectId, int goalId, string status = "todo")
    {
        var task = await CreateTaskAsync(projectId, status);
        await AssignAsync(goalId, task);
        return task;
    }

    private Task<(HttpStatusCode Status, JsonElement Body)> UpdateAsync(string method, int id, object body) =>
        SendAsync(new HttpMethod(method), $"/api/v1/TaskItems/{id}", body);

    private static string? StatusOf(JsonElement task) => task.GetProperty("status").GetString();

    /// <summary>
    /// A task blocked while InProgress whose goal (<c>TaskGoal</c>) then stopped being the Now goal; <c>NowGoal</c>
    /// took its place.
    /// </summary>
    private async Task<(int Task, int ProjectId, int NowGoal, int TaskGoal, string StartedAt)> BlockedFromInProgressAsync()
    {
        var (projectId, first, second) = await SetupAsync();
        var task = await CreateInGoalAsync(projectId, first, "inProgress");
        await UpdateAsync("PATCH", task, new { status = "blocked", blockedReason = "stuck" });
        var (swapped, _) = await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{second}/swap-now");
        Assert.Equal(HttpStatusCode.OK, swapped);
        var startedAt = (await GetTaskAsync(task)).GetProperty("startedAt").GetString()!;
        return (task, projectId, second, first, startedAt);
    }

    [Theory]
    [InlineData("PUT", "inProgress")]
    [InlineData("PUT", "completed")]
    [InlineData("PATCH", "inProgress")]
    [InlineData("PATCH", "completed")]
    public async Task StartingOrCompleting_ATaskOutsideTheNowGoal_IsRefused_AndSavesNothing(string method, string status)
    {
        var (projectId, now, next) = await SetupAsync();
        var task = await CreateInGoalAsync(projectId, next);

        var (code, body) = await UpdateAsync(method, task, new { title = "renamed", status });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, code);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        var details = body.GetProperty("details");
        Assert.Equal(task, details.GetProperty("taskItemId").GetInt32());
        Assert.Equal(next, details.GetProperty("goalId").GetInt32());
        Assert.Equal(now, details.GetProperty("nowGoalId").GetInt32());
        Assert.Equal("Current", details.GetProperty("nowGoalTitle").GetString());
        var stored = await GetTaskAsync(task);
        Assert.Equal("Todo", StatusOf(stored));
        Assert.Equal("Task", stored.GetProperty("title").GetString());
    }

    [Theory]
    [InlineData("inProgress")]
    [InlineData("completed")]
    public async Task CreatingAStartedSubtask_UnderAParentOutsideTheNowGoal_SavesNothing(string status)
    {
        var (projectId, _, next) = await SetupAsync();
        var parent = await CreateInGoalAsync(projectId, next);
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");

        var (code, body) = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new
        {
            title = "child",
            status,
            projectId,
            parentTaskItemId = parent,
            journalDate = status == "completed" ? null : today,
        });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, code);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("details").GetProperty("taskItemId").ValueKind);
        Assert.Single((await GetJsonAsync("/api/v1/TaskItems")).EnumerateArray());
        Assert.Empty((await GetJsonAsync("/api/v1/JournalEntries")).EnumerateArray());
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    public async Task MovingAnInProgressTask_UnderAParentOutsideTheNowGoal_IsRefused(string method)
    {
        var (projectId, now, next) = await SetupAsync();
        var parent = await CreateInGoalAsync(projectId, next);
        var task = await CreateInGoalAsync(projectId, now, "inProgress");

        var (code, body) = await UpdateAsync(method, task, new { title = "Task", parentTaskItemId = parent });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, code);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        var stored = await GetTaskAsync(task);
        Assert.Equal(now, GoalIdOf(stored));
        Assert.Equal(JsonValueKind.Null, stored.GetProperty("parentTaskItemId").ValueKind);
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    public async Task Unblock_ThatWouldRestoreInProgress_LandsOnTodo_AndSavesTheRest(string method)
    {
        var (task, _, _, _, startedAt) = await BlockedFromInProgressAsync();

        var (code, body) = await UpdateAsync(method, task, new { title = "renamed", status = "todo" });

        Assert.Equal(HttpStatusCode.OK, code);
        var stored = await GetTaskAsync(task);
        Assert.All(new[] { body, stored }, t =>
        {
            Assert.Equal("Todo", StatusOf(t));
            Assert.Equal("renamed", t.GetProperty("title").GetString());
            Assert.Equal(JsonValueKind.Null, t.GetProperty("blockedReason").ValueKind);
            Assert.Equal(JsonValueKind.Null, t.GetProperty("blockedAt").ValueKind);
            Assert.Equal(JsonValueKind.Null, t.GetProperty("previousStatus").ValueKind);
            Assert.Equal(startedAt, t.GetProperty("startedAt").GetString());
        });
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    public async Task ExplicitInProgress_OnABlockedTask_IsRefused_AndItStaysBlocked(string method)
    {
        var (task, _, _, _, _) = await BlockedFromInProgressAsync();

        var (code, body) = await UpdateAsync(method, task, new { title = "Task", status = "inProgress" });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, code);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        var stored = await GetTaskAsync(task);
        Assert.Equal("Blocked", StatusOf(stored));
        Assert.Equal("stuck", stored.GetProperty("blockedReason").GetString());
    }

    [Theory]
    [InlineData("now goal")]
    [InlineData("done goal")]
    [InlineData("dropped goal")]
    [InlineData("no goal")]
    [InlineData("no Now goal")]
    public async Task Unblock_RestoresInProgress_WhenTheRuleAllowsIt(string situation)
    {
        var projectId = await CreateProjectAsync();
        var goal = await CreateGoalAsync(projectId, "g");
        var task = await CreateInGoalAsync(projectId, goal);

        if (situation is "done goal" or "dropped goal")
        {
            // A goal cannot close with an open task, so it closes first and the task is reopened afterwards.
            await UpdateAsync("PATCH", task, new { status = "completed" });
            var target = situation == "done goal" ? "done" : "dropped";
            var (closed, _) = await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{goal}", new { title = "g", status = target });
            Assert.Equal(HttpStatusCode.OK, closed);
            await CreateGoalAsync(projectId, "other", "now");
            await UpdateAsync("PATCH", task, new { status = "todo" });
        }

        await UpdateAsync("PATCH", task, new { status = "inProgress" });
        await UpdateAsync("PATCH", task, new { status = "blocked" });
        Assert.Equal("InProgress", (await GetTaskAsync(task)).GetProperty("previousStatus").GetString());

        if (situation == "now goal")
        {
            await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{goal}/swap-now");
        }
        else if (situation == "no goal")
        {
            await CreateGoalAsync(projectId, "other", "now");
            await SendAsync(HttpMethod.Delete, $"/api/v1/Goals/{goal}/tasks/{task}");
        }

        var (code, body) = await UpdateAsync("PATCH", task, new { status = "todo" });

        Assert.Equal(HttpStatusCode.OK, code);
        Assert.Equal("InProgress", StatusOf(body));
    }

    [Fact]
    public async Task Unblock_ThatWasBlockedFromTodo_ReturnsTodo()
    {
        var (projectId, _, next) = await SetupAsync();
        var task = await CreateInGoalAsync(projectId, next);
        await UpdateAsync("PATCH", task, new { status = "blocked" });

        var (code, body) = await UpdateAsync("PATCH", task, new { status = "todo" });

        Assert.Equal(HttpStatusCode.OK, code);
        Assert.Equal("Todo", StatusOf(body));
    }

    [Theory]
    [InlineData(true, "InProgress")]
    [InlineData(false, "Todo")]
    public async Task UnblockWithAReparent_IsJudgedOnTheResultingGoal(bool parentInNowGoal, string expected)
    {
        // The task starts in the goal of the opposite kind, so only the new parent's goal gives the expected status.
        var (projectId, now, next) = await SetupAsync();
        var task = await CreateInGoalAsync(projectId, now, "inProgress");
        await UpdateAsync("PATCH", task, new { status = "blocked" });
        if (parentInNowGoal)
        {
            await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{next}/swap-now");
        }

        // Either way "next" is now the parent's goal: the Now goal after the swap, a Next goal without it.
        var parentGoal = next;
        var parent = await CreateInGoalAsync(projectId, parentGoal);

        var (code, body) = await UpdateAsync("PATCH", task, new { status = "todo", parentTaskItemId = parent });

        Assert.Equal(HttpStatusCode.OK, code);
        Assert.Equal(expected, StatusOf(body));
        Assert.Equal(parentGoal, GoalIdOf(body));
    }

    [Fact]
    public async Task ChangesThatNeitherStartNorComplete_AreNeverRefused()
    {
        var (projectId, _, next) = await SetupAsync();
        var task = await CreateInGoalAsync(projectId, next, "draft");
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");

        object[] changes =
        [
            new { status = "todo" },
            new { journalDate = today },
            new { status = "blocked", blockedReason = "a" },
            new { title = "edited while blocked", blockedReason = "b" },
            new { status = "todo" },
            new { status = "draft" },
        ];

        foreach (var change in changes)
        {
            Assert.Equal(HttpStatusCode.OK, (await UpdateAsync("PATCH", task, change)).Status);
        }
    }

    [Theory]
    [InlineData("inProgress")]
    [InlineData("completed")]
    public async Task ResendingTheStoredStatus_KeepsFieldEditsWorking(string status)
    {
        var projectId = await CreateProjectAsync();
        var next = await CreateGoalAsync(projectId, "Later");
        var task = await CreateInGoalAsync(projectId, next);
        await UpdateAsync("PATCH", task, new { status });
        await CreateGoalAsync(projectId, "Current", "now");

        var (code, body) = await UpdateAsync("PUT", task, new { title = "renamed", status });

        Assert.Equal(HttpStatusCode.OK, code);
        Assert.Equal("renamed", body.GetProperty("title").GetString());
    }

    [Fact]
    public async Task ReopeningATaskInADoneGoal_Succeeds_AndRaisesTheOpenCount()
    {
        var (projectId, _, next) = await SetupAsync();
        var task = await CreateInGoalAsync(projectId, next, "completed");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{next}", new { title = "Later", status = "done" });

        var (code, _) = await UpdateAsync("PATCH", task, new { status = "todo" });

        Assert.Equal(HttpStatusCode.OK, code);
        var goal = await GetJsonAsync($"/api/v1/Goals/{next}");
        Assert.Equal("Done", goal.GetProperty("status").GetString());
        Assert.Equal(1, goal.GetProperty("openTaskCount").GetInt32());
    }

    [Fact]
    public async Task AutoComplete_LeavesAParentOutsideTheNowGoalOpen_AndStillSavesTheChild()
    {
        var (projectId, _, next) = await SetupAsync();
        var parent = await CreateInGoalAsync(projectId, next);
        // A subtask in another project has no goal, so the rule does not stop it being completed.
        var child = await CreateTaskAsync(await CreateProjectAsync("Beta"), parentTaskItemId: parent);

        var (code, _) = await UpdateAsync("PATCH", child, new { status = "completed", autoCompleteParentWhenChildrenDone = true });

        Assert.Equal(HttpStatusCode.OK, code);
        Assert.Equal("Completed", StatusOf(await GetTaskAsync(child)));
        Assert.Equal("Todo", StatusOf(await GetTaskAsync(parent)));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ProjectMove_ClearsTheGoal_AndComingBackToTheParentsProjectRestoresIt(bool unassign)
    {
        var (projectId, _, next) = await SetupAsync();
        var parent = await CreateInGoalAsync(projectId, next);
        var child = await CreateTaskAsync(projectId, parentTaskItemId: parent);
        var beta = await CreateProjectAsync("Beta");

        Task<(HttpStatusCode Status, JsonElement Body)> Move(int taskItemId, int target) =>
            SendAsync(HttpMethod.Post, $"/api/v1/Projects/{target}/tasks", new { taskItemId });

        if (unassign)
        {
            await SendAsync(HttpMethod.Delete, $"/api/v1/Projects/{projectId}/tasks/{child}");
        }
        else
        {
            await Move(child, beta);
        }

        Assert.Null(GoalIdOf(await GetTaskAsync(child)));

        await Move(child, projectId);
        Assert.Equal(next, GoalIdOf(await GetTaskAsync(child)));

        await Move(parent, beta);
        Assert.Null(GoalIdOf(await GetTaskAsync(parent)));
        Assert.Null(GoalIdOf(await GetTaskAsync(child)));
    }

    [Theory]
    [InlineData("inProgress", HttpStatusCode.UnprocessableEntity)]
    [InlineData("todo", HttpStatusCode.NoContent)]
    public async Task ProjectMove_IntoAParentsNonCurrentGoal_IsRefused_OnlyForASubtaskInProgress(
        string status, HttpStatusCode expected)
    {
        var (projectId, now, next) = await SetupAsync();
        var parent = await CreateInGoalAsync(projectId, next);
        var child = await CreateTaskAsync(projectId, parentTaskItemId: parent);
        var beta = await CreateProjectAsync("Beta");
        await SendAsync(HttpMethod.Post, $"/api/v1/Projects/{beta}/tasks", new { taskItemId = child });
        await UpdateAsync("PATCH", child, new { status });

        var (moved, body) = await SendAsync(HttpMethod.Post, $"/api/v1/Projects/{projectId}/tasks", new { taskItemId = child });

        Assert.Equal(expected, moved);
        var task = await GetTaskAsync(child);
        if (expected == HttpStatusCode.NoContent)
        {
            Assert.Equal(next, GoalIdOf(task));
            return;
        }

        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        Assert.Equal(now, body.GetProperty("details").GetProperty("nowGoalId").GetInt32());
        Assert.Equal(beta, task.GetProperty("projectId").GetInt32());
        Assert.Null(GoalIdOf(task));
    }
}
