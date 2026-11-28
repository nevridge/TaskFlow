using System.Net;
using TaskFlow.Mcp.Api;
using TaskFlow.Mcp.Integration.Tests.Infrastructure;

namespace TaskFlow.Mcp.Integration.Tests;

public sealed class TaskFlowClientFlowTests : IntegrationTestBase
{
    [Fact]
    public async Task Create_ReturnsAndPersistsEveryEnteredValue()
    {
        var due = TestClock.Today().AddDays(7);

        var created = await CreateTaskAsync("Write report", dueDate: due, description: "Quarterly numbers");

        Assert.True(created.Id > 0);
        Assert.Equal("Write report", created.Title);
        Assert.Equal("Quarterly numbers", created.Description);
        Assert.Equal(due, created.DueDate);
        Assert.Equal("Todo", created.Status);
        Assert.Equal("Medium", created.Priority);

        var reread = await Client.GetTaskAsync(created.Id, Ct);
        Assert.Equal(created.Id, reread.Id);
        Assert.Equal("Write report", reread.Title);
        Assert.Equal(due, reread.DueDate);
        Assert.Equal("Todo", reread.Status);
        Assert.Equal("Medium", reread.Priority);
    }

    [Fact]
    public async Task Update_ReplacesTitleDescriptionAndDueDate()
    {
        var created = await CreateTaskAsync("Old title", description: "Old description");
        var newDue = TestClock.Today().AddDays(14);

        var updated = await UpdateTaskAsync(created, title: "New title", description: "New description", dueDate: newDue);

        Assert.Equal("New title", updated.Title);
        Assert.Equal("New description", updated.Description);
        Assert.Equal(newDue, updated.DueDate);

        var reread = await Client.GetTaskAsync(created.Id, Ct);
        Assert.Equal("New title", reread.Title);
        Assert.Equal("New description", reread.Description);
        Assert.Equal(newDue, reread.DueDate);
    }

    [Fact]
    public async Task Plan_OnUsersToday_AttachesTaskToJournalEntry()
    {
        var task = await CreateTaskAsync("Plan me");

        var today = TestClock.Today();
        var planned = await UpdateTaskAsync(task, journalDate: today);

        Assert.Equal(today, planned.CurrentJournalDate);
        Assert.NotNull(planned.CurrentJournalEntryId);

        var entry = Assert.Single(await Client.GetJournalEntriesAsync(Ct));
        Assert.Equal(planned.CurrentJournalEntryId, entry.Id);
        Assert.Equal(today, entry.Date);
        Assert.Contains(task.Id, entry.TodoTaskItemIds);
    }

    [Fact]
    public async Task Plan_ViaJournalTodo_OnFutureEntry()
    {
        var task = await CreateTaskAsync("Plan later");
        var future = TestClock.Today().AddDays(3);

        var entry = await Client.CreateJournalEntryAsync(future, "Future day", TestClock.OffsetMinutes, Ct);
        await Client.AddJournalTodoAsync(entry.Id, task.Id, TestClock.OffsetMinutes, Ct);

        var todos = await Client.GetJournalTodosAsync(entry.Id, Ct);
        Assert.Equal(task.Id, Assert.Single(todos).Id);
        var reread = await Client.GetTaskAsync(task.Id, Ct);
        Assert.Equal(future, reread.CurrentJournalDate);
        Assert.Equal(entry.Id, reread.CurrentJournalEntryId);
    }

    [Fact]
    public async Task Complete_SetsStatusCompleted()
    {
        var task = await CreateTaskAsync("Finish me");

        var completed = await UpdateTaskAsync(task, status: "completed");

        Assert.Equal("Completed", completed.Status);
        Assert.True(completed.IsDone);
    }

    [Fact]
    public async Task Block_RecordsReasonTimestampAndPreviousStatus()
    {
        var task = await CreateTaskAsync("Block me");

        var blocked = await UpdateTaskAsync(task, status: "blocked", blockedReason: "Waiting on vendor");

        Assert.Equal("Blocked", blocked.Status);
        Assert.True(blocked.IsBlocked);
        Assert.Equal("Waiting on vendor", blocked.BlockedReason);
        Assert.NotNull(blocked.BlockedAt);
        Assert.Equal("Todo", blocked.PreviousStatus);
    }

    [Fact]
    public async Task Unblock_ClearsBlockFieldsAndRestoresTodo()
    {
        var task = await CreateTaskAsync("Unblock me");
        var blocked = await UpdateTaskAsync(task, status: "blocked", blockedReason: "Waiting");

        var unblocked = await UpdateTaskAsync(blocked, status: "todo");

        Assert.Equal("Todo", unblocked.Status);
        Assert.Null(unblocked.BlockedReason);
        Assert.Null(unblocked.BlockedAt);
        Assert.Null(unblocked.PreviousStatus);
    }

    [Fact]
    public async Task Unblock_FromInProgress_RestoresInProgress()
    {
        var task = await CreateTaskAsync("Resume me", status: "inprogress");
        var blocked = await UpdateTaskAsync(task, status: "blocked", blockedReason: "Waiting");
        Assert.Equal("InProgress", blocked.PreviousStatus);

        var unblocked = await UpdateTaskAsync(blocked, status: "todo");

        Assert.Equal("InProgress", unblocked.Status);
    }

    [Fact]
    public async Task JournalRead_ReturnsEntryTodosLogsAndNotes()
    {
        var s = await Scenario.RunAsync(Harness, Ct);

        Assert.Equal(s.Today, s.Entry.Date);
        Assert.False(string.IsNullOrWhiteSpace(s.Entry.Title));
        Assert.Contains(s.Child.Id, s.Entry.TodoTaskItemIds);
        var logged = Assert.Single(s.Entry.LogEntries);
        Assert.Equal("Scenario log entry", logged.Content);
        Assert.Equal(s.Entry.Id, logged.JournalEntryId);

        var row = Assert.Single(s.Todos);
        Assert.Equal(s.Child.Id, row.Id);
        Assert.Equal(s.Parent.Id, row.ParentTaskItemId);
        Assert.Equal("Scenario parent", row.ParentTitle);
        Assert.Equal(0, row.OpenChildCount);

        Assert.Equal("Scenario note", s.Note.Content);
        Assert.Equal("Scenario note", Assert.Single(s.Notes).Content);
    }

    [Fact]
    public async Task Update_NonExistentTask_Returns404()
    {
        var request = new UpdateTaskRequest("Ghost", null, "todo", "medium", null, null, false, TestClock.OffsetMinutes);

        var ex = await Assert.ThrowsAsync<TaskFlowApiException>(() => Client.UpdateTaskAsync(999_999, request, Ct));

        Assert.Equal(HttpStatusCode.NotFound, ex.Status);
    }

    [Fact]
    public async Task Plan_OnPastDay_IsRejectedWithMessage()
    {
        var task = await CreateTaskAsync("Too late");
        var yesterday = TestClock.Today().AddDays(-2);

        var ex = await Assert.ThrowsAsync<TaskFlowApiException>(() => UpdateTaskAsync(task, journalDate: yesterday));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, ex.Status);
        Assert.False(string.IsNullOrWhiteSpace(ex.Message));
    }

    [Fact]
    public async Task Goals_EveryClientRoute_AndRuleDetails_MatchTheRealApi()
    {
        // The unit tests stub both routes and the 422 details shapes; only the real API proves they match.
        var project = await Client.CreateProjectAsync("Goal project", null, null, Ct);
        var now = await Client.CreateGoalAsync(new CreateGoalRequest(project.Id, "Current", null, null, "now"), Ct);
        var a = await Client.CreateGoalAsync(new CreateGoalRequest(project.Id, "A", null, null, "next"), Ct);
        var b = await Client.CreateGoalAsync(new CreateGoalRequest(project.Id, "B", null, null, "next"), Ct);
        var task = await Client.CreateTaskAsync(
            new CreateTaskRequest("Running", null, "inprogress", "low", null, null, null, project.Id, TestClock.OffsetMinutes), Ct);
        await Client.AssignTaskToGoalAsync(now.Id, task.Id, Ct);

        var swap = await Assert.ThrowsAsync<TaskFlowApiException>(() => Client.SwapNowGoalAsync(a.Id, Ct));
        var close = await Assert.ThrowsAsync<TaskFlowApiException>(
            () => Client.UpdateGoalAsync(now.Id, new UpdateGoalRequest("Current", null, null, "done", null), Ct));
        var notNow = await Assert.ThrowsAsync<TaskFlowApiException>(() => Client.AssignTaskToGoalAsync(a.Id, task.Id, Ct));

        Assert.Equal("GOAL_NOW_HAS_INPROGRESS_TASKS", swap.Code);
        var inProgress = swap.Details!.Value.GetProperty("tasks")[0];
        Assert.Equal(task.Id, inProgress.GetProperty("id").GetInt32());
        Assert.Equal("Running", inProgress.GetProperty("title").GetString());
        Assert.Equal("GOAL_HAS_OPEN_TASKS", close.Code);
        Assert.Equal(task.Id, close.Details!.Value.GetProperty("tasks")[0].GetProperty("id").GetInt32());
        Assert.Equal("TASK_GOAL_NOT_NOW", notNow.Code);
        Assert.Equal(now.Id, notNow.Details!.Value.GetProperty("nowGoalId").GetInt32());
        Assert.Equal("Current", notNow.Details!.Value.GetProperty("nowGoalTitle").GetString());

        await Client.ReorderGoalsAsync(project.Id, [b.Id, a.Id], Ct);
        Assert.Equal([now.Id, b.Id, a.Id], (await Client.GetGoalsAsync(project.Id, Ct)).Select(g => g.Id));

        await Client.RemoveTaskFromGoalAsync(now.Id, task.Id, Ct);
        Assert.Null((await Client.GetTaskAsync(task.Id, Ct)).GoalId);

        await Client.DeleteGoalAsync(a.Id, Ct);
        Assert.Equal([now.Id, b.Id], (await Client.GetGoalsAsync(project.Id, Ct)).Select(g => g.Id));
    }

    [Fact]
    public async Task Patch_FieldsProjectAndGoal_SaveInOneRequest_AndARefusalSavesNothing()
    {
        // The unit tests stub the PATCH route; only the real API proves the body shape and the all-or-nothing rule.
        var project = await Client.CreateProjectAsync("Patch project", null, null, Ct);
        var other = await Client.CreateProjectAsync("Other project", null, null, Ct);
        var goal = await Client.CreateGoalAsync(new CreateGoalRequest(project.Id, "Ship it", null, null, "next"), Ct);
        var task = await CreateTaskAsync("Before", description: "Keep me");

        var patched = await Client.PatchTaskAsync(
            task.Id,
            new TaskPatch()
                .Set(TaskPatchFields.Title, "After")
                .Set(TaskPatchFields.ProjectId, project.Id)
                .Set(TaskPatchFields.GoalId, goal.Id)
                .Set(TaskPatchFields.TimezoneOffsetMinutes, TestClock.OffsetMinutes),
            Ct);

        Assert.Equal("After", patched.Title);
        Assert.Equal("Keep me", patched.Description);
        Assert.Equal(project.Id, patched.ProjectId);
        Assert.Equal(goal.Id, patched.GoalId);

        // The goal belongs to the first project, so moving the task while keeping that goal is refused whole.
        var refused = await Assert.ThrowsAsync<TaskFlowApiException>(() => Client.PatchTaskAsync(
            task.Id,
            new TaskPatch()
                .Set(TaskPatchFields.Title, "Not saved")
                .Set(TaskPatchFields.ProjectId, other.Id)
                .Set(TaskPatchFields.GoalId, goal.Id)
                .Set(TaskPatchFields.TimezoneOffsetMinutes, TestClock.OffsetMinutes),
            Ct));

        Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
        var reread = await Client.GetTaskAsync(task.Id, Ct);
        Assert.Equal("After", reread.Title);
        Assert.Equal(project.Id, reread.ProjectId);
        Assert.Equal(goal.Id, reread.GoalId);

        var cleared = await Client.PatchTaskAsync(
            task.Id,
            new TaskPatch().Clear(TaskPatchFields.ProjectId).Set(TaskPatchFields.TimezoneOffsetMinutes, TestClock.OffsetMinutes),
            Ct);

        Assert.Null(cleared.ProjectId);
        Assert.Null(cleared.GoalId);
        Assert.Equal("After", cleared.Title);
    }

    [Fact]
    public async Task AppendJournalSummary_AddsTheTextAfterABlankLine()
    {
        var entry = await Client.CreateJournalEntryAsync(TestClock.Today(), "Today", TestClock.OffsetMinutes, Ct);

        var first = await Client.AppendJournalSummaryAsync(entry.Id, "  First part  ", Ct);
        var second = await Client.AppendJournalSummaryAsync(entry.Id, "Second part", Ct);

        Assert.Equal("First part", first.Summary);
        Assert.Equal("First part\n\nSecond part", second.Summary);
        var reread = Assert.Single(await Client.GetJournalEntriesAsync(Ct));
        Assert.Equal("First part\n\nSecond part", reread.Summary);
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("completed")]
    public async Task Block_FromDraftOrCompleted_IsRejected(string startStatus)
    {
        var task = await CreateTaskAsync("Cannot block", status: startStatus);

        var ex = await Assert.ThrowsAsync<TaskFlowApiException>(
            () => UpdateTaskAsync(task, status: "blocked", blockedReason: "No"));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, ex.Status);
        Assert.False(string.IsNullOrWhiteSpace(ex.Message));
    }
}
