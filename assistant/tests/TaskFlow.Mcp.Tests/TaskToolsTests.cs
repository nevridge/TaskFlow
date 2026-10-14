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

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("open, all, completed, overdue, due_soon, stale, unassigned, today");
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
