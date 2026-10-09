using System.Net;
using FluentAssertions;
using ModelContextProtocol;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Tests;

public class JournalToolsTests
{
    private static JournalTools Tools(StubHandler handler) => new(Fixtures.Client(handler), Fixtures.Time());

    [Fact]
    public async Task GetJournal_ShowsPlannedTasksLogsAndNotes_ForAnExistingEntry()
    {
        var logs = new object[]
        {
            new { id = 1, content = "Kicked off the spec", journalEntryId = 3, createdAt = "2026-10-09T16:30:00Z", taskItemId = 5, linkedTaskTitle = "Spec", linkedTaskDeleted = false },
        };
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09", "Busy day", logs) })
            .Get("JournalEntries/3/todos", new[] { Fixtures.Task(5, "Spec", priority: "High") })
            .Get("JournalEntries/3/notes", new[] { new { id = 1, content = "Remember the demo", createdAt = "2026-10-09T15:00:00Z" } });

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Journal 2026-10-09 (entry #3) - today")
            .And.Contain("Summary: Busy day")
            .And.Contain("Planned tasks (1):").And.Contain("#5 [High/Todo] Spec")
            .And.Contain("09:30 Kicked off the spec [task #5]")
            .And.Contain("Remember the demo");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Post);
    }

    [Fact]
    public async Task GetJournal_CreatesTheEntry_WhenMissing()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(8, "2026-10-09"), HttpStatusCode.Created)
            .Get("JournalEntries/8/todos", Array.Empty<object>())
            .Get("JournalEntries/8/notes", Array.Empty<object>());

        var text = await Tools(handler).GetJournal();

        var body = handler.BodyOf(HttpMethod.Post, "JournalEntries");
        body.GetProperty("date").GetString().Should().Be("2026-10-09");
        body.GetProperty("title").GetString().Should().Be("Journal 10-09-2026");
        text.Should().Contain("Planned tasks: none").And.Contain("Summary: (none)");
    }

    [Fact]
    public async Task GetJournal_UsesTheExistingEntry_WhenCreationRacesWithAnotherClient()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Get("JournalEntries", new[] { Fixtures.Journal(9, "2026-10-09") })
            .Post("JournalEntries", new { message = "exists" }, HttpStatusCode.Conflict)
            .Get("JournalEntries/9/todos", Array.Empty<object>())
            .Get("JournalEntries/9/notes", Array.Empty<object>());

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("entry #9");
    }

    [Fact]
    public async Task GetJournal_AcceptsOtherDates_AndRejectsGarbage()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(2, "2026-10-08") })
            .Get("JournalEntries/2/todos", Array.Empty<object>())
            .Get("JournalEntries/2/notes", Array.Empty<object>());
        var tools = Tools(handler);

        (await tools.GetJournal("yesterday")).Should().Contain("Journal 2026-10-08 (entry #2)").And.NotContain("- today");
        await FluentActions.Awaiting(() => tools.GetJournal("last tuesday")).Should().ThrowAsync<McpException>();
    }

    [Fact]
    public async Task SetJournalTodos_AddsWithTimezoneOffset_AndReportsEachOutcome()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("TaskItems", new[] { Fixtures.Task(1, "Planned"), Fixtures.Task(2, "Already"), Fixtures.Task(3, "Old day") })
            .Post("JournalEntries/3/todos", status: HttpStatusCode.NoContent)
            .Post("JournalEntries/3/todos", new { message = "This task is already linked to the journal entry." }, HttpStatusCode.Conflict)
            .Post("JournalEntries/3/todos", new { code = "TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED", message = "This task cannot be assigned to a past day." }, HttpStatusCode.UnprocessableEntity);

        var text = await Tools(handler).SetJournalTodos(add: [1, 2, 3]);

        text.Should().Contain("+ #1 Planned planned for 2026-10-09")
            .And.Contain("= #2 Already was already planned")
            .And.Contain("x #3 Old day: This task cannot be assigned to a past day.");
        handler.Sent(HttpMethod.Post, "JournalEntries/3/todos").Should().HaveCount(3);
        handler.BodyOf(HttpMethod.Post, "JournalEntries/3/todos").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
    }

    [Fact]
    public async Task SetJournalTodos_Removes()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("TaskItems", new[] { Fixtures.Task(4, "Drop me") })
            .Delete("JournalEntries/3/todos/4");

        var text = await Tools(handler).SetJournalTodos(remove: [4]);

        text.Should().Contain("- #4 Drop me removed from 2026-10-09");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Post);
    }

    [Fact]
    public async Task SetJournalTodos_Throws_WhenEverythingFails()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("TaskItems", Array.Empty<object>());

        var act = () => Tools(handler).SetJournalTodos(add: [999]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("x #999");
    }

    [Fact]
    public async Task SetJournalTodos_RequiresAnArgument_AndAnExistingEntryForRemovals()
    {
        var handler = new StubHandler().Get("JournalEntries", Array.Empty<object>());
        var tools = Tools(handler);

        await FluentActions.Awaiting(() => tools.SetJournalTodos()).Should().ThrowAsync<McpException>().WithMessage("*add*remove*");
        await FluentActions.Awaiting(() => tools.SetJournalTodos(remove: [1])).Should().ThrowAsync<McpException>().WithMessage("*no journal entry*");
    }

    [Fact]
    public async Task AddLogEntry_PostsTrimmedContentAndTaskLink()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Post("JournalEntries/3/logs", new { id = 1, content = "Did it", journalEntryId = 3, createdAt = "2026-10-09T17:00:00Z", taskItemId = 5, linkedTaskTitle = "Spec", linkedTaskDeleted = false }, HttpStatusCode.Created);

        var text = await Tools(handler).AddLogEntry("  Did it  ", taskId: 5);

        var body = handler.BodyOf(HttpMethod.Post, "JournalEntries/3/logs");
        body.GetProperty("content").GetString().Should().Be("Did it");
        body.GetProperty("taskItemId").GetInt32().Should().Be(5);
        text.Should().Contain("linked to task #5 Spec");
    }

    [Fact]
    public async Task AddLogEntry_RejectsBlankContent() =>
        await FluentActions.Awaiting(() => Tools(new StubHandler()).AddLogEntry(" ")).Should().ThrowAsync<McpException>();

    [Fact]
    public async Task UpdateJournal_ReplacesSummary_KeepingTheTitle_AndAppendsNotes()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Put("JournalEntries/3", Fixtures.Journal(3, "2026-10-09", "New summary"))
            .Post("JournalEntries/3/notes", new { id = 1, content = "n", createdAt = "2026-10-09T17:00:00Z" }, HttpStatusCode.Created);

        var text = await Tools(handler).UpdateJournal(summary: "New summary", note: "A note");

        var put = handler.BodyOf(HttpMethod.Put, "JournalEntries/3");
        put.GetProperty("title").GetString().Should().Be("Journal 2026-10-09");
        put.GetProperty("summary").GetString().Should().Be("New summary");
        handler.BodyOf(HttpMethod.Post, "JournalEntries/3/notes").GetProperty("content").GetString().Should().Be("A note");
        text.Should().Be("Journal 2026-10-09: summary replaced, note added.");
    }

    [Fact]
    public async Task UpdateJournal_NeedsSomethingToDo() =>
        await FluentActions.Awaiting(() => Tools(new StubHandler()).UpdateJournal()).Should().ThrowAsync<McpException>();
}

public class ProjectToolsTests
{
    private static ProjectTools Tools(StubHandler handler) => new(Fixtures.Client(handler), Fixtures.Time());

    [Fact]
    public async Task ListProjects_HidesArchivedByDefault()
    {
        var handler = new StubHandler().Get("Projects", new[]
        {
            Fixtures.Project(1, "Alpha", open: 3, done: 1, description: "Main product"),
            Fixtures.Project(2, "Old", archived: true),
        });
        var tools = Tools(handler);

        var visible = await tools.ListProjects();
        var all = await tools.ListProjects(includeArchived: true);

        visible.Should().Contain("#1 Alpha - 3 open / 1 done | Main product").And.NotContain("Old");
        all.Should().Contain("#2 Old (archived)");
    }

    [Fact]
    public async Task ListProjects_WhenEmpty_PointsToSaveProject() =>
        (await Tools(new StubHandler().Get("Projects", Array.Empty<object>())).ListProjects()).Should().Contain("save_project");

    [Fact]
    public async Task SaveProject_Creates_WhenNoProjectIsGiven()
    {
        var handler = new StubHandler().Post("Projects", Fixtures.Project(4, "New"), HttpStatusCode.Created);

        var text = await Tools(handler).SaveProject(name: " New ", description: "d");

        handler.BodyOf(HttpMethod.Post, "Projects").GetProperty("name").GetString().Should().Be("New");
        text.Should().StartWith("Created project: #4 New");
    }

    [Fact]
    public async Task SaveProject_RequiresANameToCreate() =>
        await FluentActions.Awaiting(() => Tools(new StubHandler()).SaveProject()).Should().ThrowAsync<McpException>().WithMessage("*name*");

    [Fact]
    public async Task SaveProject_UpdatesOnlyPassedFields()
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(1, "Alpha", description: "Keep") })
            .Put("Projects/1", Fixtures.Project(1, "Alpha", archived: true, description: "Keep"));

        var text = await Tools(handler).SaveProject(project: "alpha", archived: true);

        var body = handler.BodyOf(HttpMethod.Put, "Projects/1");
        body.GetProperty("name").GetString().Should().Be("Alpha");
        body.GetProperty("description").GetString().Should().Be("Keep");
        body.GetProperty("isArchived").GetBoolean().Should().BeTrue();
        text.Should().StartWith("Updated project:");
    }

    [Fact]
    public async Task SaveProject_DuplicateName_SurfacesTheApiMessage()
    {
        var handler = new StubHandler().Post("Projects", new { message = "A project with this name already exists." }, HttpStatusCode.Conflict);

        var act = () => Tools(handler).SaveProject(name: "Alpha");

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("already exists");
    }

    [Fact]
    public async Task ProjectStatus_SummarizesHealth()
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(1, "Alpha") })
            .Get("TaskItems", new[]
            {
                Fixtures.Task(1, "Late", priority: "High", due: "2026-10-01", projectId: 1, projectName: "Alpha"),
                Fixtures.Task(2, "Soon", priority: "Medium", due: "2026-10-12", projectId: 1, projectName: "Alpha"),
                Fixtures.Task(3, "Stuck", moveCount: 5, projectId: 1, projectName: "Alpha"),
                Fixtures.Task(4, "Done", status: "Completed", isComplete: true, projectId: 1, projectName: "Alpha"),
                Fixtures.Task(5, "Elsewhere", projectId: 2, projectName: "Beta"),
            });

        var text = await Tools(handler).ProjectStatus("Alpha");

        text.Should().Contain("Project Alpha (#1): 3 open / 1 done")
            .And.Contain("Open by priority: High 1, Medium 1, Low 1")
            .And.Contain("Overdue (1):").And.Contain("#1 ")
            .And.Contain("Due in the next 7 days (1):").And.Contain("#2 ")
            .And.Contain("Stalled (moved 3+ times or tagged 7+ days) (1):").And.Contain("#3 ")
            .And.NotContain("Elsewhere");
    }

    [Fact]
    public async Task ProjectStatus_WithNoOpenTasks_SaysSo()
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(1, "Alpha") })
            .Get("TaskItems", Array.Empty<object>());

        (await Tools(handler).ProjectStatus("Alpha")).Should().EndWith("No open tasks.");
    }
}

public class WeeklyReviewTests
{
    [Fact]
    public async Task CountsCompletedAndAdded_ByLocalDateWithinTheRange()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[]
            {
                Fixtures.Task(1, "Finished this week", status: "Completed", isComplete: true, projectId: 7, projectName: "Alpha"),
                Fixtures.Task(2, "Finished last month", status: "Completed", isComplete: true),
                Fixtures.Task(3, "Overdue open", due: "2026-10-01", priority: "High"),
            })
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha", open: 0, done: 1) })
            .Get("JournalEntries", new[]
            {
                Fixtures.Journal(1, "2026-10-08", "Shipped the thing", [new { id = 1, content = "x", journalEntryId = 1, createdAt = "2026-10-08T18:00:00Z", linkedTaskDeleted = false }]),
                Fixtures.Journal(2, "2026-09-01", "Out of range"),
            })
            .Get("TaskItems/1/history", new[] { Fixtures.Event(1, "TaskCreated", "2026-10-05T18:00:00Z"), Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z") })
            .Get("TaskItems/2/history", new[] { Fixtures.Event(2, "TaskCreated", "2026-09-01T18:00:00Z"), Fixtures.Event(2, "Completed", "2026-09-02T18:00:00Z") })
            .Get("TaskItems/3/history", new[] { Fixtures.Event(3, "TaskCreated", "2026-10-04T18:00:00Z") });
        var tools = new ReviewTools(Fixtures.Client(handler), Fixtures.Time());

        var text = await tools.WeeklyReview();

        text.Should().StartWith("Review 2026-10-03 to 2026-10-09");
        text.Should().Contain("Completed (1):").And.Contain("Alpha (1): #1 Finished this week").And.NotContain("Finished last month");
        text.Should().Contain("Added (2):").And.Contain("No project (1): #3 Overdue open");
        text.Should().Contain("Open now: 1 (overdue 1, stalled 0)").And.Contain("Overdue:");
        text.Should().Contain("Alpha: 0 open / 1 done");
        text.Should().Contain("Journal: 1 day(s) with entries, 1 log entry").And.Contain("2026-10-08: Shipped the thing").And.NotContain("Out of range");
    }

    [Fact]
    public async Task CompletionNearMidnight_IsAttributedToTheLocalDay()
    {
        // 2026-10-10T03:00Z is still Oct 9 at UTC-7, so it belongs in a review ending Oct 9.
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(1, "Late finisher", status: "Completed", isComplete: true) })
            .Get("Projects", Array.Empty<object>())
            .Get("JournalEntries", Array.Empty<object>())
            .Get("TaskItems/1/history", new[] { Fixtures.Event(1, "Completed", "2026-10-10T03:00:00Z") });
        var tools = new ReviewTools(Fixtures.Client(handler), Fixtures.Time());

        (await tools.WeeklyReview(from: "2026-10-09", to: "2026-10-09")).Should().Contain("Completed (1):");
    }

    [Fact]
    public async Task InvertedRange_IsRejected()
    {
        var tools = new ReviewTools(Fixtures.Client(new StubHandler()), Fixtures.Time());

        await FluentActions.Awaiting(() => tools.WeeklyReview(from: "2026-10-09", to: "2026-10-01"))
            .Should().ThrowAsync<McpException>().WithMessage("*after 'to'*");
    }
}
