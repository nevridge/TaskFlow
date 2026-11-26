using System.Net;
using System.Text.Json;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Verifier probes for #611: PUT stays blind to project and goal (AC 20), and a parent moved to another project
/// clears its subtasks' goals in the same save (edge case).
/// </summary>
public sealed class TaskItemsProjectGoalProbeTests : GoalsApiTestBase
{
    private static int? IdOrNull(JsonElement task, string name) =>
        task.GetProperty(name) is { ValueKind: JsonValueKind.Number } id ? id.GetInt32() : null;

    [Fact]
    public async Task Put_WithProjectIdAndGoalId_NeverChangesProjectOrGoal()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var alphaGoal = await CreateGoalAsync(alpha, "ag");
        var betaGoal = await CreateGoalAsync(beta, "bg");
        var task = await CreateTaskAsync(alpha);
        await AssignAsync(alphaGoal, task);

        var (status, _) = await SendAsync(
            HttpMethod.Put, $"/api/v1/TaskItems/{task}",
            new { title = "t", status = "todo", projectId = beta, goalId = betaGoal });

        Assert.Equal(HttpStatusCode.OK, status);
        var stored = await GetTaskAsync(task);
        Assert.Equal(alpha, IdOrNull(stored, "projectId"));
        Assert.Equal(alphaGoal, IdOrNull(stored, "goalId"));
    }

    [Fact]
    public async Task Patch_ParentMovedToOtherProject_ClearsSubtaskGoalsInTheSameSave()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var alphaGoal = await CreateGoalAsync(alpha, "ag");
        var parent = await CreateTaskAsync(alpha);
        await AssignAsync(alphaGoal, parent);
        var child = await CreateTaskAsync(alpha, parentTaskItemId: parent);
        Assert.Equal(alphaGoal, IdOrNull(await GetTaskAsync(child), "goalId"));

        var (status, body) = await SendAsync(HttpMethod.Patch, $"/api/v1/TaskItems/{parent}", new { projectId = beta });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Null(IdOrNull(body, "goalId"));
        Assert.Null(IdOrNull(await GetTaskAsync(child), "goalId"));
    }
}
