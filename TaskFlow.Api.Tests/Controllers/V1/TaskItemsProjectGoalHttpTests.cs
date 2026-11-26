using System.Net;
using System.Text.Json;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// PATCH and POST of a task's project and goal in one request (#611), over the real HTTP pipeline and a real SQLite
/// file. Each test asserts what is stored, because the point of the feature is that a refusal leaves everything alone.
/// </summary>
public sealed class TaskItemsProjectGoalHttpTests : GoalsApiTestBase
{
    private Task<(HttpStatusCode Status, JsonElement Body)> PatchAsync(int id, object body) =>
        SendAsync(HttpMethod.Patch, $"/api/v1/TaskItems/{id}", body);

    private async Task<int> CreateLooseTaskAsync(string title = "Task", string status = "todo")
    {
        var (code, json) = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new { title, status });
        Assert.Equal(HttpStatusCode.Created, code);
        return json.GetProperty("id").GetInt32();
    }

    private async Task<List<string>> EventSummariesAsync(int taskId, string eventType)
    {
        var history = await GetJsonAsync($"/api/v1/TaskItems/{taskId}/history");
        return [.. history.EnumerateArray()
            .Where(e => e.GetProperty("eventType").GetString() == eventType)
            .Select(e => e.GetProperty("changeSummary").GetString()!)];
    }

    private static int? ProjectIdOf(JsonElement task) =>
        task.GetProperty("projectId") is { ValueKind: JsonValueKind.Number } id ? id.GetInt32() : null;

    [Fact]
    public async Task Patch_ProjectWithFields_SavesBothAndWritesProjectAndFieldEvents()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var task = await CreateTaskAsync(alpha);

        var (status, body) = await PatchAsync(task, new { title = "Renamed", projectId = beta });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("Renamed", body.GetProperty("title").GetString());
        Assert.Equal(beta, ProjectIdOf(body));
        Assert.Equal("Beta", body.GetProperty("projectName").GetString());
        Assert.Equal(["Project changed from 'Alpha' to 'Beta'."], await EventSummariesAsync(task, "ProjectChanged"));
        Assert.Single(await EventSummariesAsync(task, "TitleChanged"));
    }

    [Fact]
    public async Task Patch_AbsentProjectAndGoal_LeaveBothUnchanged()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");
        var task = await CreateTaskAsync(project);
        await AssignAsync(goal, task);

        var (status, body) = await PatchAsync(task, new { title = "Renamed" });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(project, ProjectIdOf(body));
        Assert.Equal(goal, GoalIdOf(body));
        Assert.Empty(await EventSummariesAsync(task, "ProjectChanged"));
    }

    [Fact]
    public async Task Patch_ProjectNull_ClearsProjectGoalAndSubtaskGoals()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");
        var parent = await CreateTaskAsync(project);
        var child = await CreateTaskAsync(project, parentTaskItemId: parent);
        await AssignAsync(goal, parent);
        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(child)));

        var (status, body) = await PatchAsync(parent, new { projectId = (int?)null });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Null(ProjectIdOf(body));
        Assert.Null(GoalIdOf(body));
        Assert.Null(GoalIdOf(await GetTaskAsync(child)));
        Assert.Equal(["Removed from project 'Alpha'."], await EventSummariesAsync(parent, "ProjectChanged"));
    }

    [Fact]
    public async Task Patch_MoveToOtherProject_SubtaskTakesParentsGoalInTheNewProject()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var betaGoal = await CreateGoalAsync(beta, "bg");
        var parent = await CreateTaskAsync(beta);
        await AssignAsync(betaGoal, parent);
        var child = await CreateTaskAsync(alpha, parentTaskItemId: parent);

        var (status, body) = await PatchAsync(child, new { projectId = beta });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(betaGoal, GoalIdOf(body));
    }

    [Fact]
    public async Task Patch_GoalId_MovesParentWithItsSubtasks_AndNullRemovesThem()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");
        var parent = await CreateTaskAsync(project);
        var child = await CreateTaskAsync(project, parentTaskItemId: parent);

        var (status, _) = await PatchAsync(parent, new { goalId = goal });
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(parent)));
        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(child)));

        (status, _) = await PatchAsync(parent, new { goalId = (int?)null });
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Null(GoalIdOf(await GetTaskAsync(parent)));
        Assert.Null(GoalIdOf(await GetTaskAsync(child)));
    }

    [Fact]
    public async Task Patch_ProjectAndGoal_TheGoalIsJudgedAgainstTheNewProject()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var betaGoal = await CreateGoalAsync(beta, "bg");
        var task = await CreateTaskAsync(alpha);

        var (status, body) = await PatchAsync(task, new { projectId = beta, goalId = betaGoal });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(beta, ProjectIdOf(body));
        Assert.Equal(betaGoal, GoalIdOf(body));
    }

    [Fact]
    public async Task Patch_SameProjectAndGoal_IsANoOp_NoEvent_NoConflict_AndOtherFieldsApply()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");
        var task = await CreateTaskAsync(project);
        await AssignAsync(goal, task);

        var (status, body) = await PatchAsync(task, new { title = "Renamed", projectId = project, goalId = goal });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("Renamed", body.GetProperty("title").GetString());
        Assert.Equal(goal, GoalIdOf(body));
        Assert.Empty(await EventSummariesAsync(task, "ProjectChanged"));
    }

    [Fact]
    public async Task Patch_UnknownProject_Is422WithTheCreateBody_AndSavesNothing()
    {
        var project = await CreateProjectAsync();
        var task = await CreateTaskAsync(project);

        var (status, body) = await PatchAsync(task, new { title = "Renamed", projectId = 9999 });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
        Assert.Equal("TASK_PROJECT_NOT_FOUND", body.GetProperty("code").GetString());
        Assert.Equal("The selected project was not found.", body.GetProperty("message").GetString());
        var stored = await GetTaskAsync(task);
        Assert.Equal("Task", stored.GetProperty("title").GetString());
        Assert.Equal(project, ProjectIdOf(stored));
    }

    [Fact]
    public async Task Patch_UnknownGoal_Is404()
    {
        var task = await CreateTaskAsync(await CreateProjectAsync());

        var (status, body) = await PatchAsync(task, new { goalId = 9999 });

        Assert.Equal(HttpStatusCode.NotFound, status);
        Assert.Equal("Goal not found.", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Patch_SubtaskGoal_IsRefused_EvenForTheInheritedGoal_AndForNullWhileItHasOne()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");
        var parent = await CreateTaskAsync(project);
        await AssignAsync(goal, parent);
        var child = await CreateTaskAsync(project, parentTaskItemId: parent);
        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(child)));

        var inherited = await PatchAsync(child, new { goalId = goal });
        var removal = await PatchAsync(child, new { goalId = (int?)null });

        Assert.Equal(HttpStatusCode.BadRequest, inherited.Status);
        Assert.Equal("A subtask's goal follows its parent and cannot be set directly.", inherited.Body.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, removal.Status);
        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(child)));
    }

    [Fact]
    public async Task Patch_SubtaskNullGoal_WithNoGoal_IsANoOp()
    {
        var project = await CreateProjectAsync();
        var parent = await CreateTaskAsync(project);
        var child = await CreateTaskAsync(project, parentTaskItemId: parent);

        var (status, _) = await PatchAsync(child, new { goalId = (int?)null });

        Assert.Equal(HttpStatusCode.OK, status);
    }

    [Fact]
    public async Task Patch_GoalOfAnotherProject_OrWithNoProject_IsWrongProject()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var betaGoal = await CreateGoalAsync(beta, "bg");
        var alphaGoal = await CreateGoalAsync(alpha, "ag");
        var task = await CreateTaskAsync(alpha);

        var other = await PatchAsync(task, new { goalId = betaGoal });
        var noProject = await PatchAsync(task, new { projectId = (int?)null, goalId = alphaGoal });

        Assert.Equal(HttpStatusCode.BadRequest, other.Status);
        Assert.Equal("The task must be in the goal's project.", other.Body.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, noProject.Status);
        Assert.Equal(alpha, ProjectIdOf(await GetTaskAsync(task)));
        Assert.Empty(await EventSummariesAsync(task, "ProjectChanged"));
    }

    [Fact]
    public async Task Patch_ClosedGoal_IsRefused()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{goal}", new { title = "g", status = "dropped" });
        var task = await CreateTaskAsync(project);

        var (status, body) = await PatchAsync(task, new { goalId = goal });

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Equal("Tasks cannot be added to a Done or Dropped goal.", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Patch_InProgressTaskIntoNextGoal_IsGoalNotNow_ForAGoalChangeAlone()
    {
        var project = await CreateProjectAsync();
        await CreateGoalAsync(project, "now", "now");
        var next = await CreateGoalAsync(project, "next");
        var task = await CreateTaskAsync(project, "inProgress");

        var (status, body) = await PatchAsync(task, new { goalId = next });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        Assert.Null(GoalIdOf(await GetTaskAsync(task)));
    }

    [Fact]
    public async Task Patch_InProgressSubtaskMovedIntoProjectWhoseInheritedGoalIsNotNow_IsGoalNotNow_AndSavesNothing()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        await CreateGoalAsync(beta, "now", "now");
        var next = await CreateGoalAsync(beta, "next");
        var parent = await CreateTaskAsync(beta);
        await AssignAsync(next, parent);
        var child = await CreateTaskAsync(alpha, "inProgress", parent);

        var (status, body) = await PatchAsync(child, new { title = "Renamed", projectId = beta });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        var stored = await GetTaskAsync(child);
        Assert.Equal(alpha, ProjectIdOf(stored));
        Assert.Equal("Task", stored.GetProperty("title").GetString());
        Assert.Empty(await EventSummariesAsync(child, "ProjectChanged"));
    }

    [Fact]
    public async Task Patch_ParentWithInProgressSubtaskIntoNextGoal_IsGoalNotNow()
    {
        var project = await CreateProjectAsync();
        await CreateGoalAsync(project, "now", "now");
        var next = await CreateGoalAsync(project, "next");
        var parent = await CreateTaskAsync(project);
        await CreateTaskAsync(project, "inProgress", parent);

        var (status, body) = await PatchAsync(parent, new { goalId = next });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
        Assert.Null(GoalIdOf(await GetTaskAsync(parent)));
    }

    [Fact]
    public async Task Patch_StartAndMoveIntoTheNowGoal_InOneRequest_Passes()
    {
        var project = await CreateProjectAsync();
        var now = await CreateGoalAsync(project, "now", "now");
        var task = await CreateTaskAsync(project);

        var (status, body) = await PatchAsync(task, new { status = "inProgress", goalId = now });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("InProgress", body.GetProperty("status").GetString());
        Assert.Equal(now, GoalIdOf(body));
    }

    [Fact]
    public async Task Patch_RefusedGoalAlongsideProjectAndJournalDate_LeavesFieldsProjectPlanningAndEventsUntouched()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var task = await CreateTaskAsync(alpha);
        var wrongGoal = await CreateGoalAsync(alpha, "ag");
        var day = DateTime.UtcNow.Date.AddDays(1).ToString("yyyy-MM-dd");

        var (status, _) = await PatchAsync(
            task, new { title = "Renamed", projectId = beta, goalId = wrongGoal, journalDate = day });

        Assert.Equal(HttpStatusCode.BadRequest, status);
        var stored = await GetTaskAsync(task);
        Assert.Equal("Task", stored.GetProperty("title").GetString());
        Assert.Equal(alpha, ProjectIdOf(stored));
        Assert.Equal(JsonValueKind.Null, stored.GetProperty("currentJournalDate").ValueKind);
        Assert.Empty(await EventSummariesAsync(task, "ProjectChanged"));
        Assert.Empty(await EventSummariesAsync(task, "TitleChanged"));
    }

    [Fact]
    public async Task Patch_ProjectGoalAndJournalDate_CommitTogether()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var betaGoal = await CreateGoalAsync(beta, "bg");
        var task = await CreateTaskAsync(alpha);
        var day = DateTime.UtcNow.Date.AddDays(1).ToString("yyyy-MM-dd");

        var (status, body) = await PatchAsync(task, new { projectId = beta, goalId = betaGoal, journalDate = day });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(beta, ProjectIdOf(body));
        Assert.Equal(betaGoal, GoalIdOf(body));
        Assert.Equal(day, body.GetProperty("currentJournalDate").GetString());
        Assert.Single(await EventSummariesAsync(task, "ProjectChanged"));
    }

    [Fact]
    public async Task Patch_Refusals_UseTheSameBodiesAsTheAssignEndpoints()
    {
        var project = await CreateProjectAsync();
        await CreateGoalAsync(project, "now", "now");
        var next = await CreateGoalAsync(project, "next");
        var viaPatch = await CreateTaskAsync(project, "inProgress");
        var viaAssign = await CreateTaskAsync(project, "inProgress");

        var patch = await PatchAsync(viaPatch, new { goalId = next });
        var assign = await SendAsync(HttpMethod.Post, $"/api/v1/Goals/{next}/tasks", new { taskItemId = viaAssign });

        Assert.Equal(assign.Body.GetProperty("code").GetString(), patch.Body.GetProperty("code").GetString());
        Assert.Equal(assign.Body.GetProperty("message").GetString(), patch.Body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Create_WithProjectAndGoal_StoresBoth()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");

        var (status, body) = await SendAsync(
            HttpMethod.Post, "/api/v1/TaskItems", new { title = "New", status = "todo", projectId = project, goalId = goal });

        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal(goal, GoalIdOf(body));
        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(body.GetProperty("id").GetInt32())));
    }

    [Fact]
    public async Task Create_SubtaskWithoutGoalId_StillInheritsTheParentsGoal()
    {
        var project = await CreateProjectAsync();
        var goal = await CreateGoalAsync(project, "g");
        var parent = await CreateTaskAsync(project);
        await AssignAsync(goal, parent);

        var child = await CreateTaskAsync(project, parentTaskItemId: parent);

        Assert.Equal(goal, GoalIdOf(await GetTaskAsync(child)));
    }

    [Fact]
    public async Task Create_RefusedGoal_CreatesNoTask()
    {
        var alpha = await CreateProjectAsync();
        var beta = await CreateProjectAsync("Beta");
        var parent = await CreateTaskAsync(alpha);
        var betaGoal = await CreateGoalAsync(beta, "bg");
        var closed = await CreateGoalAsync(alpha, "closed");
        await SendAsync(HttpMethod.Put, $"/api/v1/Goals/{closed}", new { title = "closed", status = "done" });
        var before = (await GetJsonAsync("/api/v1/TaskItems")).GetArrayLength();

        var wrongProject = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new { title = "x", projectId = alpha, goalId = betaGoal });
        var noProject = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new { title = "x", goalId = betaGoal });
        var unknown = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new { title = "x", projectId = alpha, goalId = 9999 });
        var isClosed = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new { title = "x", projectId = alpha, goalId = closed });
        var subtask = await SendAsync(HttpMethod.Post, "/api/v1/TaskItems", new { title = "x", projectId = alpha, parentTaskItemId = parent, goalId = closed });

        Assert.Equal(HttpStatusCode.BadRequest, wrongProject.Status);
        Assert.Equal(HttpStatusCode.BadRequest, noProject.Status);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal(HttpStatusCode.BadRequest, isClosed.Status);
        Assert.Equal(HttpStatusCode.BadRequest, subtask.Status);
        Assert.Equal("A subtask's goal follows its parent and cannot be set directly.", subtask.Body.GetProperty("message").GetString());
        Assert.Equal(before, (await GetJsonAsync("/api/v1/TaskItems")).GetArrayLength());
    }

    [Fact]
    public async Task Create_InProgressIntoNextGoalWhileANowGoalExists_IsGoalNotNow()
    {
        var project = await CreateProjectAsync();
        await CreateGoalAsync(project, "now", "now");
        var next = await CreateGoalAsync(project, "next");

        var (status, body) = await SendAsync(
            HttpMethod.Post, "/api/v1/TaskItems", new { title = "x", status = "inProgress", projectId = project, goalId = next });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
        Assert.Equal("TASK_GOAL_NOT_NOW", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Patch_ProjectOnATaskWithNoProject_WritesAnAssignedEvent()
    {
        var project = await CreateProjectAsync();
        var task = await CreateLooseTaskAsync();

        var (status, _) = await PatchAsync(task, new { projectId = project });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(["Assigned to project 'Alpha'."], await EventSummariesAsync(task, "ProjectChanged"));
    }
}
