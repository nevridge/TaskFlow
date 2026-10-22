using System.Net;
using FluentAssertions;
using ModelContextProtocol;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Tests;

public class ListTasksTests
{
    private static (TaskTools Tools, StubHandler Handler) Setup(params object[] tasks)
    {
        var handler = new StubHandler().Get("TaskItems", tasks);
        return (new TaskTools(Fixtures.Client(handler), Fixtures.Time()), handler);
    }

    private static readonly object[] Sample =
    [
        Fixtures.Task(1, "Low open", priority: "Low"),
        Fixtures.Task(2, "High overdue", priority: "High", due: "2026-10-01", projectId: 7, projectName: "Alpha"),
        Fixtures.Task(3, "Medium due soon", priority: "Medium", due: "2026-10-12", projectId: 7, projectName: "Alpha"),
        Fixtures.Task(4, "Done", status: "Completed", isComplete: true, due: "2026-09-01"),
        Fixtures.Task(5, "Stale", moveCount: 4, projectId: 8, projectName: "Beta"),
        Fixtures.Task(6, "Planned today", plannedOn: "2026-10-09"),
        Fixtures.Task(7, "Long tagged", daysTagged: 9),
    ];

    [Fact]
    public async Task DefaultView_ShowsOpenTasks_MostUrgentFirst()
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks();

        text.Should().StartWith("6 task(s) match (view=open). Showing 1-6.");
        text.Should().NotContain("Done");
        text.IndexOf("#2 ", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("#3 ", StringComparison.Ordinal));
        text.IndexOf("#3 ", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("#1 ", StringComparison.Ordinal));
        text.Should().Contain("#2 [High/Todo] High overdue | due 2026-10-01 (OVERDUE 8d) | project: Alpha");
    }

    [Theory]
    [InlineData("overdue", "#2")]
    [InlineData("stale", "#5")]
    [InlineData("today", "#6")]
    [InlineData("completed", "#4")]
    public async Task Views_FilterAsDocumented(string view, string expectedFirst)
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks(view: view);

        text.Should().Contain(expectedFirst + " ");
    }

    [Fact]
    public async Task StaleView_IncludesLongTaggedTasks_AndOnlyOpenOnes()
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks(view: "stale");

        text.Should().Contain("#5 ").And.Contain("#7 ").And.NotContain("#4 ");
    }

    [Fact]
    public async Task DueSoon_IncludesOverdue_AndTasksWithinTheWindow()
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks(view: "due_soon", dueWithinDays: 7);

        text.Should().Contain("#2 ").And.Contain("#3 ").And.NotContain("#1 ");
        text.IndexOf("#2 ", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("#3 ", StringComparison.Ordinal), "ordered by due date");
    }

    [Fact]
    public async Task Unassigned_ShowsOpenTasksWithoutAProject()
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks(view: "unassigned");

        text.Should().Contain("#1 ").And.Contain("#6 ").And.NotContain("#2 ").And.NotContain("#4 ");
    }

    [Fact]
    public async Task ProjectFilter_ResolvesNames()
    {
        var handler = new StubHandler()
            .Get("TaskItems", Sample)
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha"), Fixtures.Project(8, "Beta") });
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var text = await tools.ListTasks(project: "alpha");

        text.Should().StartWith("2 task(s) match (view=open, project=Alpha).");
        text.Should().Contain("#2 ").And.Contain("#3 ").And.NotContain("#5 ");
    }

    [Fact]
    public async Task StatusAndPriorityFilters_Apply()
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks(view: "all", status: "completed", priority: "low");

        text.Should().Contain("#4 ").And.StartWith("1 task(s) match (view=all, status=completed, priority=low).");
    }

    [Fact]
    public async Task Paging_ReportsTheNextOffset()
    {
        var (tools, _) = Setup(Sample);

        var first = await tools.ListTasks(limit: 2);
        var second = await tools.ListTasks(limit: 2, offset: 2);

        first.Should().Contain("Showing 1-2.").And.EndWith("Next page: offset=2");
        second.Should().Contain("Showing 3-4.").And.EndWith("Next page: offset=4");
    }

    [Fact]
    public async Task LastPage_HasNoNextPageHint()
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks(limit: 4, offset: 4);

        text.Should().Contain("Showing 5-6.").And.NotContain("Next page");
    }

    [Fact]
    public async Task OffsetPastTheEnd_IsExplained()
    {
        var (tools, _) = Setup(Sample);

        (await tools.ListTasks(offset: 50)).Should().Contain("offset 50 is past the end");
    }

    [Fact]
    public async Task NoMatches_SaysSo()
    {
        var (tools, _) = Setup();

        (await tools.ListTasks()).Should().Be("No tasks match (view=open).");
    }

    [Fact]
    public async Task DetailedFormat_AddsDescriptionAndPlanning()
    {
        var (tools, _) = Setup(Fixtures.Task(1, "T", description: "Write the spec", plannedOn: "2026-10-09", daysTagged: 2));

        var text = await tools.ListTasks(responseFormat: "detailed");

        text.Should().Contain("planned 2026-10-09").And.Contain("tagged 2d").And.Contain("Write the spec");
    }

    [Fact]
    public async Task InvalidView_ListsTheAllowedValues()
    {
        var (tools, _) = Setup();

        var act = () => tools.ListTasks(view: "bogus");

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("open, all, completed, overdue, due_soon, stale, unassigned, today, blocked");
    }

    private static readonly object[] WithBlocked =
    [
        Fixtures.Task(1, "Plain"),
        Fixtures.Task(2, "Waiting", status: "Blocked", priority: "High", due: "2026-10-01", blockedReason: "Waiting on vendor", blockedAt: "2026-10-05T10:00:00Z", moveCount: 4),
        Fixtures.Task(3, "No reason", status: "Blocked", blockedAt: "2026-10-09T10:00:00Z", plannedOn: "2026-10-09", projectId: null),
        Fixtures.Task(4, "Done", status: "Completed", isComplete: true),
    ];

    [Fact]
    public async Task StatusBlocked_ReturnsOnlyBlockedTasks()
    {
        var (tools, _) = Setup(WithBlocked);

        var text = await tools.ListTasks(view: "all", status: "BLOCKED");

        text.Should().StartWith("2 task(s) match (view=all, status=blocked).").And.Contain("#2 ").And.Contain("#3 ").And.NotContain("#1 ");
    }

    [Fact]
    public async Task BlockedView_ReturnsOnlyBlockedTasks_WithReasonAndDuration()
    {
        var (tools, _) = Setup(WithBlocked);

        var text = await tools.ListTasks(view: "blocked");

        text.Should().Contain("#2 [High/Blocked] Waiting | blocked: Waiting on vendor (4d) | due 2026-10-01 (OVERDUE 8d)");
        text.Should().Contain("#3 [Low/Blocked] No reason | blocked (<1d)").And.NotContain("blocked: |").And.NotContain("#1 ");
    }

    [Theory]
    [InlineData("open", "#2 #3")]
    [InlineData("overdue", "#2")]
    [InlineData("stale", "#2")]
    [InlineData("unassigned", "#2 #3")]
    [InlineData("today", "#3")]
    [InlineData("due_soon", "#2")]
    public async Task BlockedTasks_StillAppearInOtherOpenViews_Flagged(string view, string expectedIds)
    {
        var (tools, _) = Setup(WithBlocked);

        var text = await tools.ListTasks(view: view);

        foreach (var id in expectedIds.Split(' '))
        {
            text.Should().Contain(id + " [");
        }

        text.Should().Contain("blocked");
    }

    [Fact]
    public async Task DetailedBlockedTask_ShowsBlockedSince()
    {
        var (tools, _) = Setup(WithBlocked);

        var text = await tools.ListTasks(view: "blocked", responseFormat: "detailed");

        text.Should().Contain("blocked since 2026-10-05 10:00 UTC");
    }

    [Fact]
    public async Task ReasonWithNewlines_StaysOnOneLine()
    {
        var (tools, _) = Setup(Fixtures.Task(1, "T", status: "Blocked", blockedReason: "line one\nline two\t\u0007x", blockedAt: "2026-10-08T17:00:00Z"));

        var text = await tools.ListTasks(view: "blocked");

        text.Should().Contain("blocked: line one line two x (1d)");
        text.Split('\n').Should().HaveCount(2);
    }
}

public class FormattingBlockedTests
{
    private static TaskFlow.Mcp.Api.TaskItemDto Blocked(DateTime? at, string? reason = "r") =>
        new(1, "T", null, false, null, "Blocked", "Low", null, null, null, null, null, null, 0, null, 0, 0, reason, at);

    private static readonly DateTimeOffset Now = new(2026, 10, 9, 17, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("2026-10-09T16:00:01Z", "(<1d)")]
    [InlineData("2026-10-08T17:00:01Z", "(<1d)")]
    [InlineData("2026-10-08T17:00:00Z", "(1d)")]
    [InlineData("2026-10-05T14:00:00Z", "(4d)")]
    [InlineData("2026-10-20T00:00:00Z", "(<1d)")]
    public void Task_RendersWholeDaysBlocked_ClampedAtZero(string blockedAt, string expected)
    {
        var at = DateTime.Parse(blockedAt, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal);

        Formatting.Task(Blocked(at), Fixtures.Today, nowUtc: Now).Should().Contain(expected);
    }

    [Fact]
    public void Task_WithoutNowUtc_OrBlockedAt_OmitsDuration()
    {
        Formatting.Task(Blocked(new DateTime(2026, 10, 5, 0, 0, 0, DateTimeKind.Utc)), Fixtures.Today).Should().EndWith("| blocked: r");
        Formatting.Task(Blocked(null), Fixtures.Today, nowUtc: Now).Should().EndWith("| blocked: r");
    }

    [Fact]
    public void Task_WhitespaceReason_RendersPlainBlocked() =>
        Formatting.Task(Blocked(null, "   "), Fixtures.Today, nowUtc: Now).Should().EndWith("| blocked");

    [Fact]
    public void Project_ShowsBlockedCount_OnlyWhenAboveZero()
    {
        Formatting.Project(new(1, "A", null, false, DateTime.UtcNow, null, 5, 3, 2)).Should().Contain("5 open (2 blocked) / 3 done");
        Formatting.Project(new(1, "A", null, false, DateTime.UtcNow, null, 5, 3)).Should().Contain("5 open / 3 done");
    }
}

public class GetTaskTests
{
    [Fact]
    public async Task IncludesNotesAndNewestHistoryFirst()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Fixtures.Task(5, "Spec", priority: "High"))
            .Get("TaskItems/5/notes", new[] { new { id = 1, content = "Call Sam", createdAt = "2026-10-08T20:00:00Z" } })
            .Get("TaskItems/5/history", new[]
            {
                Fixtures.Event(5, "TaskCreated", "2026-10-01T18:00:00Z", "Task was created."),
                Fixtures.Event(5, "Completed", "2026-10-08T18:00:00Z", "Marked complete."),
            });
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var text = await tools.GetTask(5);

        text.Should().Contain("#5 [High/Todo] Spec").And.Contain("Notes (1):").And.Contain("[2026-10-08] Call Sam");
        text.IndexOf("Completed", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("TaskCreated", StringComparison.Ordinal));
    }

    [Fact]
    public async Task BlockedTask_ShowsReasonDurationBlockedSince_AndBlockEvents()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Fixtures.Task(5, "Spec", status: "Blocked", blockedReason: "Waiting on vendor", blockedAt: "2026-10-05T10:00:00Z"))
            .Get("TaskItems/5/notes", Array.Empty<object>())
            .Get("TaskItems/5/history", new[]
            {
                Fixtures.Event(5, "Blocked", "2026-10-05T10:00:00Z", "Blocked: Waiting on vendor"),
                Fixtures.Event(5, "BlockedReasonChanged", "2026-10-06T10:00:00Z", "Reason changed."),
                Fixtures.Event(5, "Unblocked", "2026-10-07T10:00:00Z", "Unblocked."),
            });
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var text = await tools.GetTask(5);

        text.Should().Contain("blocked: Waiting on vendor (4d)").And.Contain("blocked since 2026-10-05 10:00 UTC");
        text.Should().Contain("Blocked: Blocked: Waiting on vendor").And.Contain("BlockedReasonChanged:").And.Contain("Unblocked:");
    }
}

public class CreateTasksTests
{
    private static (TaskTools Tools, StubHandler Handler) Setup(StubHandler? handler = null)
    {
        handler ??= new StubHandler();
        return (new TaskTools(Fixtures.Client(handler), Fixtures.Time()), handler);
    }

    [Fact]
    public async Task SendsDefaults_TimezoneOffset_AndUtcDueDate()
    {
        var (tools, handler) = Setup(new StubHandler().Post("TaskItems", Fixtures.Task(10, "Write spec", status: "Todo"), HttpStatusCode.Created));

        var text = await tools.CreateTasks([new NewTask { Title = "  Write spec  ", DueDate = "2026-10-20" }]);

        var body = handler.BodyOf(HttpMethod.Post, "TaskItems");
        body.GetProperty("title").GetString().Should().Be("Write spec");
        body.GetProperty("status").GetString().Should().Be("todo");
        body.GetProperty("priority").GetString().Should().Be("low");
        body.GetProperty("dueDate").GetString().Should().Be("2026-10-20T00:00:00Z");
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        text.Should().StartWith("Created 1 of 1 task(s).").And.Contain("+ #10 ");
    }

    [Fact]
    public async Task ResolvesProjectNames_AndPlansOnJournalDay()
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("TaskItems", Fixtures.Task(11, "T", projectId: 7, projectName: "Alpha"), HttpStatusCode.Created);
        var (tools, _) = Setup(handler);

        await tools.CreateTasks([new NewTask { Title = "T", Project = "alpha", Priority = "HIGH", JournalDate = "today", ParentTaskId = 3 }]);

        var body = handler.BodyOf(HttpMethod.Post, "TaskItems");
        body.GetProperty("projectId").GetInt32().Should().Be(7);
        body.GetProperty("priority").GetString().Should().Be("high");
        body.GetProperty("journalDate").GetString().Should().Be("2026-10-09");
        body.GetProperty("parentTaskItemId").GetInt32().Should().Be(3);
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        handler.Sent(HttpMethod.Post, "JournalEntries").Should().BeEmpty();
    }

    [Fact]
    public async Task PartialFailures_AreReportedPerTask_WithoutStoppingTheBatch()
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("TaskItems", Fixtures.Task(12, "Good"), HttpStatusCode.Created);
        var (tools, _) = Setup(handler);

        var text = await tools.CreateTasks(
        [
            new NewTask { Title = "Good" },
            new NewTask { Title = "Wrong project", Project = "nope" },
            new NewTask { Title = "", Priority = "low" },
            new NewTask { Title = "Bad date", DueDate = "friday" },
        ]);

        text.Should().StartWith("Created 1 of 4 task(s).");
        text.Should().Contain("+ #12 ").And.Contain("x \"Wrong project\": No project matches 'nope'")
            .And.Contain("Title is required.").And.Contain("Invalid dueDate 'friday'");
        handler.Sent(HttpMethod.Post, "TaskItems").Should().HaveCount(1);
    }

    [Fact]
    public async Task ApiRejections_AreReportedWithTheirMessage()
    {
        var handler = new StubHandler().Post("TaskItems", new { code = "TASK_CREATION_PAST_DAY_NOT_ALLOWED", message = "You cannot create new tasks on a past journal day." }, HttpStatusCode.UnprocessableEntity);
        var (tools, _) = Setup(handler);

        var act = () => tools.CreateTasks([new NewTask { Title = "T", JournalDate = "yesterday" }]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().Contain("Created 0 of 1").And.Contain("past journal day").And.Contain("TASK_CREATION_PAST_DAY_NOT_ALLOWED");
    }

    [Fact]
    public async Task BlockedItem_IsRejectedWithoutApiCall_OthersUnaffected()
    {
        var (tools, handler) = Setup(new StubHandler().Post("TaskItems", Fixtures.Task(10, "Good"), HttpStatusCode.Created));

        var text = await tools.CreateTasks([new NewTask { Title = "Good" }, new NewTask { Title = "Wait", Status = "Blocked" }]);

        text.Should().StartWith("Created 1 of 2 task(s).").And.Contain("+ #10 ")
            .And.Contain("x \"Wait\": Cannot create a task as blocked. Create it first, then call update_task with status=blocked and a blockedReason.");
        handler.Sent(HttpMethod.Post, "TaskItems").Should().HaveCount(1);
    }

    [Fact]
    public async Task OnlyBlockedItems_ThrowsWithGuidance_AndMakesNoCall()
    {
        var (tools, handler) = Setup();

        var act = () => tools.CreateTasks([new NewTask { Title = "Wait", Status = "blocked" }]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("Created 0 of 1").And.Contain("update_task with status=blocked");
        handler.Requests.Should().BeEmpty();
    }

    [Fact]
    public async Task EmptyAndOversizedBatches_AreRejected()
    {
        var (tools, _) = Setup();

        await FluentActions.Awaiting(() => tools.CreateTasks([])).Should().ThrowAsync<McpException>().WithMessage("*at least one*");
        await FluentActions.Awaiting(() => tools.CreateTasks(Enumerable.Range(0, 26).Select(i => new NewTask { Title = $"t{i}" }).ToList()))
            .Should().ThrowAsync<McpException>().WithMessage("*at most 25*");
    }
}

public class UpdateTaskTests
{
    private static object Existing(string status = "Todo", bool isComplete = false, int? projectId = null, string? projectName = null) =>
        Fixtures.Task(5, "Original", status: status, priority: "High", due: "2026-10-12", isComplete: isComplete, projectId: projectId, projectName: projectName, description: "Keep me");

    private static (TaskTools Tools, StubHandler Handler) Setup(object existing, object? updated = null, Action<StubHandler>? configure = null)
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", existing)
            .Put("TaskItems/5", updated ?? existing);
        configure?.Invoke(handler);
        return (new TaskTools(Fixtures.Client(handler), Fixtures.Time()), handler);
    }

    [Fact]
    public async Task OnlyPassedFieldsChange_EverythingElseIsPreserved()
    {
        var (tools, handler) = Setup(Existing());

        var text = await tools.UpdateTask(5, priority: "low");

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("title").GetString().Should().Be("Original");
        body.GetProperty("description").GetString().Should().Be("Keep me");
        body.GetProperty("priority").GetString().Should().Be("low");
        body.GetProperty("status").GetString().Should().Be("todo");
        body.GetProperty("isComplete").GetBoolean().Should().BeFalse();
        body.GetProperty("dueDate").GetString().Should().StartWith("2026-10-12");
        body.GetProperty("autoCompleteParentWhenChildrenDone").GetBoolean().Should().BeFalse();
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        text.Should().StartWith("Updated #5. Changed priority.");
    }

    [Fact]
    public async Task CompleteTrue_SetsCompletedStatusAndFlag()
    {
        var (tools, handler) = Setup(Existing());

        var text = await tools.UpdateTask(5, complete: true);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("completed");
        body.GetProperty("isComplete").GetBoolean().Should().BeTrue();
        text.Should().Contain("Changed status.");
    }

    [Fact]
    public async Task CompleteFalse_ReopensToTodo()
    {
        var (tools, handler) = Setup(Existing(status: "Completed", isComplete: true));

        await tools.UpdateTask(5, complete: false);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("todo");
        body.GetProperty("isComplete").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task SettingStatusToCompleted_AlsoSetsTheFlag_AndOtherStatusesReopen()
    {
        var (tools, handler) = Setup(Existing());
        await tools.UpdateTask(5, status: "completed");
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("isComplete").GetBoolean().Should().BeTrue();

        var (tools2, handler2) = Setup(Existing(status: "Completed", isComplete: true));
        await tools2.UpdateTask(5, status: "draft");
        var body = handler2.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("draft");
        body.GetProperty("isComplete").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task DueDate_CanBeSet_AndCleared()
    {
        var (tools, handler) = Setup(Existing());
        await tools.UpdateTask(5, dueDate: "tomorrow");
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").GetString().Should().Be("2026-10-10T00:00:00Z");

        var (tools2, handler2) = Setup(Existing());
        await tools2.UpdateTask(5, dueDate: "none");
        handler2.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
    }

    [Fact]
    public async Task EmptyDescription_ClearsIt_AndParentZeroRemovesTheParent()
    {
        var (tools, handler) = Setup(Existing());

        await tools.UpdateTask(5, description: "", parentTaskId: 0);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("description").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        body.GetProperty("parentTaskItemId").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
    }

    [Fact]
    public async Task ProjectName_AssignsThroughTheProjectsEndpoint()
    {
        var (tools, handler) = Setup(Existing(), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", status: HttpStatusCode.NoContent));

        var text = await tools.UpdateTask(5, project: "Alpha");

        handler.BodyOf(HttpMethod.Post, "Projects/7/tasks").GetProperty("taskItemId").GetInt32().Should().Be(5);
        text.Should().Contain("project -> Alpha");
    }

    [Fact]
    public async Task ProjectNone_UnassignsFromTheCurrentProject()
    {
        var (tools, handler) = Setup(Existing(projectId: 7, projectName: "Alpha"), configure: h => h.Delete("Projects/7/tasks/5"));

        var text = await tools.UpdateTask(5, project: "none");

        handler.Sent(HttpMethod.Delete, "Projects/7/tasks/5").Should().HaveCount(1);
        text.Should().Contain("project (removed)");
    }

    [Fact]
    public async Task ProjectNone_WhenNotInAProject_DoesNothing()
    {
        var (tools, handler) = Setup(Existing());

        await tools.UpdateTask(5, project: "none");

        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Delete);
    }

    [Fact]
    public async Task AssigningTheCurrentProject_IsANoOp()
    {
        var (tools, handler) = Setup(Existing(projectId: 7, projectName: "Alpha"), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        var text = await tools.UpdateTask(5, project: "Alpha");

        handler.Requests.Should().NotContain(r => r.Path == "Projects/7/tasks");
        text.Should().Contain("No changes needed");
    }

    [Fact]
    public async Task ApiRefusals_SurfaceTheirMessage()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing())
            .Put("TaskItems/5", new { code = "TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", message = "Parent tasks cannot be completed while child tasks are still open." }, HttpStatusCode.UnprocessableEntity);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, complete: true);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("child tasks are still open");
    }

    [Fact]
    public async Task InvalidValues_AreRejectedBeforeAnyWrite()
    {
        var (tools, handler) = Setup(Existing());

        await FluentActions.Awaiting(() => tools.UpdateTask(5, priority: "urgent")).Should().ThrowAsync<McpException>();
        await FluentActions.Awaiting(() => tools.UpdateTask(5, dueDate: "someday")).Should().ThrowAsync<McpException>();

        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    private static object BlockedTask(string? reason = "Waiting on vendor") =>
        Fixtures.Task(5, "Original", status: "Blocked", priority: "High", due: "2026-10-12", blockedReason: reason, blockedAt: "2026-10-05T10:00:00Z", previousStatus: "Todo");

    [Fact]
    public async Task StatusBlocked_WithReason_SendsTrimmedReason_AndSummarisesBlock()
    {
        var (tools, handler) = Setup(Existing(), BlockedTask());

        var text = await tools.UpdateTask(5, status: "blocked", blockedReason: "  Waiting on vendor  ");

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("blocked");
        body.GetProperty("blockedReason").GetString().Should().Be("Waiting on vendor");
        body.GetProperty("isComplete").GetBoolean().Should().BeFalse();
        text.Should().Contain("Changed blocked (reason: \"Waiting on vendor\").").And.NotContain("status")
            .And.Contain("[High/Blocked]").And.Contain("blocked: Waiting on vendor (4d)").And.Contain("blocked since 2026-10-05 10:00 UTC");
    }

    [Fact]
    public async Task StatusBlocked_WithoutReason_SendsNullReason()
    {
        var (tools, handler) = Setup(Existing(), BlockedTask(null));

        var text = await tools.UpdateTask(5, status: "blocked");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("blockedReason").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        text.Should().Contain("Changed blocked.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task EmptyReason_OnBlockedTask_ClearsReason_AndStaysBlocked(string reason)
    {
        var (tools, handler) = Setup(BlockedTask(), BlockedTask(null));

        var text = await tools.UpdateTask(5, blockedReason: reason);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("blocked");
        body.GetProperty("blockedReason").ValueKind.Should().Be(System.Text.Json.JsonValueKind.String);
        body.GetProperty("blockedReason").GetString().Should().BeEmpty();
        text.Should().Contain("blocked reason (cleared)");
    }

    [Fact]
    public async Task NewReason_OnBlockedTask_IsSummarisedAsBlockedReason()
    {
        var (tools, handler) = Setup(BlockedTask(), BlockedTask("Now waiting on legal"));

        var text = await tools.UpdateTask(5, blockedReason: "Now waiting on legal");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("blockedReason").GetString().Should().Be("Now waiting on legal");
        text.Should().Contain("Changed blocked reason.");
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TitleOrPriorityOnly_OnBlockedTask_ResendsBlockedWithNullReason(bool byTitle)
    {
        var (tools, handler) = Setup(BlockedTask());

        var text = byTitle ? await tools.UpdateTask(5, title: "New title") : await tools.UpdateTask(5, priority: "low");

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("blocked");
        body.GetProperty("blockedReason").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        body.GetProperty("isComplete").GetBoolean().Should().BeFalse();
        text.Should().Contain("[High/Blocked]").And.Contain("blocked: Waiting on vendor").And.NotContain("Changed status").And.NotContain("blocked reason");
    }

    [Fact]
    public async Task StatusTodo_UnblocksTask()
    {
        var (tools, handler) = Setup(BlockedTask(), Fixtures.Task(5, "Original", priority: "High"));

        var text = await tools.UpdateTask(5, status: "todo");

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("todo");
        body.GetProperty("blockedReason").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        text.Should().Contain("Changed unblocked.").And.Contain("[High/Todo]").And.NotContain("blocked:");
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CompletingABlockedTask_CompletesIt(bool useComplete)
    {
        var (tools, handler) = Setup(BlockedTask(), Fixtures.Task(5, "Original", status: "Completed", isComplete: true));

        var text = useComplete ? await tools.UpdateTask(5, complete: true) : await tools.UpdateTask(5, status: "completed");

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("completed");
        body.GetProperty("isComplete").GetBoolean().Should().BeTrue();
        text.Should().Contain("Changed status.").And.NotContain("blocked");
    }

    [Fact]
    public async Task ReasonOver200Chars_IsRejected_WithoutAnyPut()
    {
        var (tools, handler) = Setup(Existing());

        var act = () => tools.UpdateTask(5, status: "blocked", blockedReason: new string('x', 201));

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Be("blockedReason is 201 characters; the limit is 200.");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task ReasonOfExactly200Chars_AfterTrim_IsAccepted()
    {
        var (tools, handler) = Setup(Existing(), BlockedTask());

        await tools.UpdateTask(5, status: "blocked", blockedReason: " " + new string('x', 200) + " ");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("blockedReason").GetString().Should().HaveLength(200);
    }

    [Theory]
    [InlineData("todo")]
    [InlineData("draft")]
    [InlineData("completed")]
    public async Task ReasonWithNonBlockedStatus_IsRejected_WithoutAnyCallToPut(string status)
    {
        var (tools, handler) = Setup(Existing());

        var act = () => tools.UpdateTask(5, status: status, blockedReason: "Waiting");

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("blockedReason needs status=blocked").And.Contain(status);
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task ReasonOnPlainTodoTask_WithoutStatus_IsRejected()
    {
        var (tools, handler) = Setup(Existing());

        await FluentActions.Awaiting(() => tools.UpdateTask(5, blockedReason: "Waiting")).Should().ThrowAsync<McpException>().WithMessage("*status=blocked*");

        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task EmptyReason_WhenFinalStatusIsNotBlocked_SendsNullWithoutError()
    {
        var (tools, handler) = Setup(Existing());

        await tools.UpdateTask(5, blockedReason: "");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("blockedReason").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
    }

    [Theory]
    [InlineData("TASK_BLOCK_DRAFT_NOT_ALLOWED", "make the task todo first", "Make the task Todo first")]
    [InlineData("TASK_BLOCK_COMPLETED_NOT_ALLOWED", "reopen", "Reopen the task first")]
    [InlineData("TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS", "needs status", "omit blockedReason")]
    public async Task Api422BlockCodes_SurfaceMessageAndOneGuidanceLine(string code, string apiMessage, string guidance)
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing())
            .Put("TaskItems/5", new { code, message = apiMessage }, HttpStatusCode.UnprocessableEntity);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, status: "blocked");

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().StartWith($"{apiMessage} [{code}]\n").And.Contain(guidance).And.NotContain("{").And.NotContain("   at ");
        message.Split('\n').Should().HaveCount(2);
    }

    [Fact]
    public async Task Api422WithErrorsMapAndRootCode_StillGetsGuidance()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing())
            .Put("TaskItems/5", """{"title":"Validation","errors":{"status":["Drafts cannot be blocked."]},"code":"TASK_BLOCK_DRAFT_NOT_ALLOWED"}""", HttpStatusCode.UnprocessableEntity);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, status: "blocked");

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("[TASK_BLOCK_DRAFT_NOT_ALLOWED]").And.Contain("Make the task Todo first");
    }

    [Fact]
    public async Task BlockedParent_AlwaysSendsAutoCompleteFalse_AndSummaryDoesNotMentionIt()
    {
        var (tools, handler) = Setup(Existing(), BlockedTask());

        var text = await tools.UpdateTask(5, status: "blocked", blockedReason: "Waiting");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("autoCompleteParentWhenChildrenDone").GetBoolean().Should().BeFalse();
        text.Should().NotContainEquivalentOf("autocomplete");
    }

    [Fact]
    public async Task StaleCopy_ApiError_IsSurfacedPlainly()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", BlockedTask())
            .Put("TaskItems/5", new { message = "The task is already completed." }, HttpStatusCode.BadRequest);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, title: "x");

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Be("The task is already completed.");
    }
}

public class DeleteAndNoteTests
{
    [Fact]
    public async Task DeleteTask_ReportsTheTitle()
    {
        var handler = new StubHandler().Get("TaskItems/5", Fixtures.Task(5, "Old task")).Delete("TaskItems/5");
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        (await tools.DeleteTask(5)).Should().Be("Deleted #5 \"Old task\".");
    }

    [Fact]
    public async Task DeleteTask_WithSubtasks_SurfacesTheApiMessage()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Fixtures.Task(5, "Parent"))
            .Delete("TaskItems/5", HttpStatusCode.UnprocessableEntity, new { code = "TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN", message = "This task has subtasks." });
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.DeleteTask(5);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("has subtasks");
    }

    [Fact]
    public async Task AddNote_PostsTrimmedContent_AndRejectsBlank()
    {
        var handler = new StubHandler().Post("TaskItems/5/notes", new { id = 1, content = "x", createdAt = "2026-10-09T00:00:00Z" }, HttpStatusCode.Created);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        (await tools.AddTaskNote(5, "  hello  ")).Should().Be("Added note to task #5.");
        handler.BodyOf(HttpMethod.Post, "TaskItems/5/notes").GetProperty("content").GetString().Should().Be("hello");
        await FluentActions.Awaiting(() => tools.AddTaskNote(5, "  ")).Should().ThrowAsync<McpException>();
    }
}
