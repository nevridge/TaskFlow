using System.Net;
using System.Text.Json;
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
        Fixtures.Task(4, "Done", status: "Completed", due: "2026-09-01"),
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
    public async Task Overdue_ExcludesUndatedTasks()
    {
        var (tools, _) = Setup(Sample);

        var text = await tools.ListTasks(view: "overdue");

        text.Should().Contain("#2 ").And.NotContain("#1 ").And.NotContain("#5 ");
    }

    [Fact]
    public async Task Open_SortsUndatedTasksLast_WithinTheSamePriority()
    {
        var (tools, _) = Setup(
            Fixtures.Task(1, "Undated", priority: "Medium"),
            Fixtures.Task(2, "Dated", priority: "Medium", due: "2026-12-01"));

        var text = await tools.ListTasks();

        text.IndexOf("#2 ", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("#1 ", StringComparison.Ordinal));
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

    private static object DoneTask(int id, string title = "Done", int? projectId = null, string? projectName = null, string? plannedOn = null) =>
        Fixtures.Task(id, title, status: "Completed", projectId: projectId, projectName: projectName, plannedOn: plannedOn);

    private static StubHandler WithHistory(StubHandler handler, int id, params object[] events) =>
        handler.Get($"TaskItems/{id}/history", events);

    private static (TaskTools Tools, StubHandler Handler) SetupHistory(TimeProvider? time, Action<StubHandler> routes, params object[] tasks)
    {
        var handler = new StubHandler().Get("TaskItems", tasks);
        routes(handler);
        return (new TaskTools(Fixtures.Client(handler), time ?? Fixtures.Time()), handler);
    }

    private static int HistoryRequests(StubHandler handler) =>
        handler.Requests.Count(r => r.Path.EndsWith("/history", StringComparison.Ordinal));

    [Fact]
    public async Task ListTasks_CompletedRange_IsInclusiveAtBothBoundaries()
    {
        // Local zone is UTC-7: 2026-10-05T07:00Z is 00:00 local on the 5th; 2026-10-07T06:59Z is 23:59 local on the 6th.
        var (tools, _) = SetupHistory(null, h =>
        {
            WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-05T07:00:00Z"));
            WithHistory(h, 2, Fixtures.Event(2, "Completed", "2026-10-07T06:59:00Z"));
            WithHistory(h, 3, Fixtures.Event(3, "Completed", "2026-10-05T06:59:00Z"));
            WithHistory(h, 4, Fixtures.Event(4, "Completed", "2026-10-07T07:00:00Z"));
        }, DoneTask(1), DoneTask(2), DoneTask(3), DoneTask(4));

        var text = await tools.ListTasks(view: "completed", completedFrom: "2026-10-05", completedTo: "2026-10-06");

        text.Should().StartWith("2 task(s) match (view=completed, completedFrom=2026-10-05, completedTo=2026-10-06).")
            .And.Contain("#1 ").And.Contain("#2 ").And.NotContain("#3 ").And.NotContain("#4 ");
    }

    [Fact]
    public async Task ListTasks_CompletedFromOnly_HasNoUpperBound()
    {
        var (tools, _) = SetupHistory(null, h =>
        {
            WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z"));
            WithHistory(h, 2, Fixtures.Event(2, "Completed", "2026-09-01T18:00:00Z"));
        }, DoneTask(1), DoneTask(2));

        var text = await tools.ListTasks(view: "all", completedFrom: "yesterday");

        text.Should().Contain("#1 ").And.NotContain("#2 ").And.Contain("completedFrom=2026-10-08");
    }

    [Fact]
    public async Task ListTasks_CompletedToOnly_HasNoLowerBound()
    {
        var (tools, _) = SetupHistory(null, h =>
        {
            WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z"));
            WithHistory(h, 2, Fixtures.Event(2, "Completed", "2026-09-01T18:00:00Z"));
        }, DoneTask(1), DoneTask(2));

        var text = await tools.ListTasks(view: "all", completedTo: "2026-09-30");

        text.Should().Contain("#2 ").And.NotContain("#1 ").And.Contain("completedTo=2026-09-30");
    }

    [Fact]
    public async Task ListTasks_CompletedTwice_AnyEventInRangeMatches()
    {
        var (tools, _) = SetupHistory(null, h => WithHistory(h, 1,
            Fixtures.Event(1, "Completed", "2026-09-01T18:00:00Z"),
            Fixtures.Event(1, "Reopened", "2026-09-02T18:00:00Z"),
            Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z")), DoneTask(1));

        var text = await tools.ListTasks(view: "completed", completedFrom: "2026-10-08", completedTo: "2026-10-08");

        text.Should().StartWith("1 task(s) match").And.Contain("#1 ");
    }

    [Fact]
    public async Task ListTasks_DoneTaskWithoutCompletedEvent_IsExcluded()
    {
        var (tools, _) = SetupHistory(null, h => WithHistory(h, 1, Fixtures.Event(1, "TaskCreated", "2026-10-08T18:00:00Z")), DoneTask(1));

        var text = await tools.ListTasks(view: "completed", completedFrom: "2026-10-01");

        text.Should().StartWith("No tasks match (view=completed, completedFrom=2026-10-01).");
    }

    [Fact]
    public async Task ListTasks_CompletedFilter_CombinesWithProjectAndView()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { DoneTask(1, projectId: 7, projectName: "Alpha"), DoneTask(2, projectId: 8, projectName: "Beta"), Fixtures.Task(3, "Open", projectId: 7, projectName: "Alpha") })
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha"), Fixtures.Project(8, "Beta") });
        WithHistory(handler, 1, Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z"));
        WithHistory(handler, 2, Fixtures.Event(2, "Completed", "2026-10-08T18:00:00Z"));
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var text = await tools.ListTasks(view: "completed", project: "Alpha", completedFrom: "2026-10-08");

        text.Should().StartWith("1 task(s) match (view=completed, project=Alpha, completedFrom=2026-10-08).").And.Contain("#1 ").And.NotContain("#2 ");
        handler.Requests.Should().NotContain(r => r.Path == "TaskItems/2/history");
    }

    [Fact]
    public async Task ListTasks_CompletedRangeWithViewCompleted_MatchesWeeklyReviewSet()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { DoneTask(1, "One"), DoneTask(2, "Two"), DoneTask(3, "Three") })
            .Get("Projects", Array.Empty<object>())
            .Get("JournalEntries", Array.Empty<object>());
        WithHistory(handler, 1, Fixtures.Event(1, "Completed", "2026-10-07T18:00:00Z"));
        WithHistory(handler, 2, Fixtures.Event(2, "Completed", "2026-09-07T18:00:00Z"));
        WithHistory(handler, 3, Fixtures.Event(3, "Completed", "2026-10-09T10:00:00Z"));
        var client = Fixtures.Client(handler);

        var list = await new TaskTools(client, Fixtures.Time()).ListTasks(view: "completed", completedFrom: "2026-10-05", completedTo: "2026-10-09");
        var review = await new ReviewTools(client, Fixtures.Time()).WeeklyReview(from: "2026-10-05", to: "2026-10-09");

        list.Should().Contain("#1 ").And.Contain("#3 ").And.NotContain("#2 ");
        review.Should().Contain("#1 One").And.Contain("#3 Three").And.NotContain("#2 Two");
    }

    [Fact]
    public async Task ListTasks_NoCompletedFilter_MakesNoHistoryRequests()
    {
        var (tools, handler) = Setup(DoneTask(1), Fixtures.Task(2));

        await tools.ListTasks(view: "all");

        HistoryRequests(handler).Should().Be(0);
    }

    [Fact]
    public async Task ListTasks_CompletedFilter_RequestsHistoryOnlyForDoneTasks()
    {
        var (tools, handler) = SetupHistory(null, h => WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z")), DoneTask(1), Fixtures.Task(2));

        await tools.ListTasks(view: "all", completedFrom: "2026-10-01");

        handler.Requests.Where(r => r.Path.EndsWith("/history", StringComparison.Ordinal)).Select(r => r.Path).Should().Equal("TaskItems/1/history");
    }

    [Fact]
    public async Task ListTasks_ReopenedTaskWithCompletedEvent_IsExcludedAndNotFetched()
    {
        var (tools, handler) = SetupHistory(null, h => WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z")), Fixtures.Task(1, "Reopened"));

        var text = await tools.ListTasks(view: "all", completedFrom: "2026-10-01");

        text.Should().StartWith("No tasks match (view=all, completedFrom=2026-10-01).");
        HistoryRequests(handler).Should().Be(0);
    }

    [Theory]
    [InlineData("2026-10-09", "2026-10-09", true)]
    [InlineData("today", "2026-10-09", true)]
    [InlineData("tomorrow", "2026-10-10", true)]
    [InlineData("yesterday", "2026-10-08", true)]
    [InlineData("2026-10-09", "2026-10-10", false)]
    public async Task ListTasks_PlannedDate_MatchesOnlyEqualJournalDate(string param, string plannedOn, bool expected)
    {
        var (tools, _) = Setup(Fixtures.Task(1, "Planned", plannedOn: plannedOn), Fixtures.Task(2, "Unplanned"));

        var text = await tools.ListTasks(plannedDate: param);

        if (expected)
        {
            text.Should().Contain("#1 ").And.NotContain("#2 ");
        }
        else
        {
            text.Should().StartWith("No tasks match");
        }
    }

    [Fact]
    public async Task ListTasks_PlannedDate_DoneTasksNeedViewAll()
    {
        var (tools, _) = Setup(DoneTask(1, plannedOn: "2026-10-09"), Fixtures.Task(2, plannedOn: "2026-10-09"));

        var open = await tools.ListTasks(plannedDate: "2026-10-09");
        var all = await tools.ListTasks(view: "all", plannedDate: "2026-10-09");

        open.Should().Contain("#2 ").And.NotContain("#1 ");
        all.Should().Contain("#1 ").And.Contain("#2 ").And.Contain("plannedDate=2026-10-09");
    }

    private static object[] ManyDone(int count) => [.. Enumerable.Range(1, count).Select(i => DoneTask(i))];

    private static void RouteHistories(StubHandler h, int from, int to, string completedUtc = "2026-10-08T18:00:00Z")
    {
        for (var i = from; i <= to; i++)
        {
            WithHistory(h, i, Fixtures.Event(i, "Completed", completedUtc));
        }
    }

    private const string CapNoteStart = "Note: results may be incomplete; completed history was checked for only the 300 highest-id of 301 candidate tasks.";

    [Fact]
    public async Task ListTasks_MoreThan300DoneCandidates_ChecksHighestIdsAndAddsNote()
    {
        var (tools, handler) = SetupHistory(null, h => RouteHistories(h, 2, 301), ManyDone(301));

        var text = await tools.ListTasks(view: "completed", completedFrom: "2026-10-01", limit: 100);

        text.Should().Contain("300 task(s) match").And.Contain(CapNoteStart).And.Contain("weekly_review for a summary.");
        handler.Requests.Should().NotContain(r => r.Path == "TaskItems/1/history");
        HistoryRequests(handler).Should().Be(300);
    }

    [Theory]
    [InlineData(300)]
    [InlineData(5)]
    public async Task ListTasks_300OrFewerDoneCandidates_HasNoNote(int count)
    {
        var (tools, _) = SetupHistory(null, h => RouteHistories(h, 1, count), ManyDone(count));

        var text = await tools.ListTasks(view: "completed", completedFrom: "2026-10-01");

        text.Should().NotContain("Note: results may be incomplete");
    }

    [Fact]
    public async Task ListTasks_CapExceeded_NoteAlsoOnEmptyResult()
    {
        var (tools, _) = SetupHistory(null, h => RouteHistories(h, 2, 301, "2026-01-01T18:00:00Z"), ManyDone(301));

        var text = await tools.ListTasks(view: "completed", completedFrom: "2026-10-01");

        text.Should().StartWith("No tasks match (view=completed, completedFrom=2026-10-01).").And.Contain(CapNoteStart);
    }

    [Fact]
    public async Task ListTasks_CapExceeded_NoteAlsoWhenOffsetIsPastTheEnd()
    {
        var (tools, _) = SetupHistory(null, h => RouteHistories(h, 2, 301), ManyDone(301));

        var text = await tools.ListTasks(view: "completed", completedFrom: "2026-10-01", offset: 1000);

        text.Should().Contain("but offset 1000 is past the end.").And.Contain(CapNoteStart);
    }

    [Fact]
    public async Task ListTasks_CompletedLateUtcFallingOnNextLocalDay_UsesLocalZone()
    {
        // Zone UTC+2: 23:30Z on the 9th is 01:30 local on the 10th.
        var time = Fixtures.Time(new DateTimeOffset(2026, 10, 10, 12, 0, 0, TimeSpan.Zero), 120);
        var (tools, _) = SetupHistory(time, h => WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-09T23:30:00Z")), DoneTask(1));

        var onTenth = await tools.ListTasks(view: "completed", completedFrom: "2026-10-10", completedTo: "2026-10-10");
        var onNinth = await tools.ListTasks(view: "completed", completedFrom: "2026-10-09", completedTo: "2026-10-09");

        onTenth.Should().Contain("#1 ");
        onNinth.Should().StartWith("No tasks match");
    }

    [Fact]
    public async Task ListTasks_CompletedEarlyUtcFallingOnPreviousLocalDay_UsesLocalZone()
    {
        // Zone UTC-7: 02:00Z on the 10th is 19:00 local on the 9th.
        var (tools, _) = SetupHistory(null, h => WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-10T02:00:00Z")), DoneTask(1));

        var onNinth = await tools.ListTasks(view: "completed", completedFrom: "2026-10-09", completedTo: "2026-10-09");
        var onTenth = await tools.ListTasks(view: "completed", completedFrom: "2026-10-10", completedTo: "2026-10-10");

        onNinth.Should().Contain("#1 ");
        onTenth.Should().StartWith("No tasks match");
    }

    [Fact]
    public async Task ListTasks_OpenViewWithCompletedFilterAndNoResults_ShowsTipAndLabel()
    {
        var (tools, _) = Setup(DoneTask(1));

        var text = await tools.ListTasks(completedFrom: "2026-03-01");

        text.Should().Be("No tasks match (view=open, completedFrom=2026-03-01). Tip: view=open excludes completed tasks; use view=completed or view=all with completedFrom/completedTo.");
    }

    [Fact]
    public async Task ListTasks_CompletedFromAfterCompletedTo_FailsWithoutApiCalls()
    {
        var (tools, handler) = Setup(DoneTask(1));

        var act = () => tools.ListTasks(view: "all", completedFrom: "2026-03-05", completedTo: "2026-03-01");

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("'completedFrom' (2026-03-05) is after 'completedTo' (2026-03-01).");
        handler.Requests.Should().BeEmpty();
    }

    [Theory]
    [InlineData("completedFrom")]
    [InlineData("completedTo")]
    [InlineData("plannedDate")]
    public async Task ListTasks_InvalidDate_NamesTheParameterAndMakesNoApiCall(string parameter)
    {
        var (tools, handler) = Setup(DoneTask(1));

        var act = () => tools.ListTasks(
            view: "all",
            completedFrom: parameter == "completedFrom" ? "next week" : null,
            completedTo: parameter == "completedTo" ? "next week" : null,
            plannedDate: parameter == "plannedDate" ? "next week" : null);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain(parameter);
        handler.Requests.Should().BeEmpty();
    }

    [Fact]
    public async Task ListTasks_HistoryNotFoundForOneTask_FailsTheWholeCall()
    {
        var (tools, _) = SetupHistory(null, h => WithHistory(h, 1, Fixtures.Event(1, "Completed", "2026-10-08T18:00:00Z")), DoneTask(1), DoneTask(2));

        var act = () => tools.ListTasks(view: "all", completedFrom: "2026-10-01");

        await act.Should().ThrowAsync<McpException>();
    }

    private static readonly object[] WithBlocked =
    [
        Fixtures.Task(1, "Plain"),
        Fixtures.Task(2, "Waiting", status: "Blocked", priority: "High", due: "2026-10-01", blockedReason: "Waiting on vendor", blockedAt: "2026-10-05T10:00:00Z", moveCount: 4),
        Fixtures.Task(3, "No reason", status: "Blocked", blockedAt: "2026-10-09T10:00:00Z", plannedOn: "2026-10-09", projectId: null),
        Fixtures.Task(4, "Done", status: "Completed"),
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

    [Theory]
    [InlineData("overdue")]
    [InlineData("due_soon")]
    [InlineData("unassigned")]
    [InlineData("today")]
    public async Task BlockedTask_NotMatchingViewRules_IsExcluded(string view)
    {
        var (tools, _) = Setup(
            Fixtures.Task(1, "Match", due: "2026-10-01", projectId: null, plannedOn: "2026-10-09"),
            Fixtures.Task(5, "Assigned no due", status: "Blocked", projectId: 7, blockedReason: "Waiting", blockedAt: "2026-10-05T10:00:00Z"));

        var text = await tools.ListTasks(view: view);

        text.Should().NotContain("#5 ");
    }

    [Fact]
    public async Task DetailedBlockedTask_ShowsBlockedSince()
    {
        var (tools, _) = Setup(WithBlocked);

        var text = await tools.ListTasks(view: "blocked", responseFormat: "detailed");

        text.Should().Contain("blocked since 2026-10-05 10:00 UTC");
    }

    private static readonly object[] WithInProgress =
    [
        Fixtures.Task(1, "Todo one"),
        Fixtures.Task(2, "Working", status: "InProgress", plannedOn: "2026-10-09", startedAt: "2026-10-08T09:15:00Z"),
        Fixtures.Task(3, "Was working", status: "Blocked", blockedReason: "Waiting", blockedAt: "2026-10-09T10:00:00Z", previousStatus: "InProgress"),
    ];

    [Theory]
    [InlineData("inprogress")]
    [InlineData("InProgress")]
    public async Task StatusInProgress_FiltersOnlyInProgress_HeaderLowercase_LineAsReturned(string status)
    {
        var (tools, _) = Setup(WithInProgress);

        var text = await tools.ListTasks(view: "all", status: status);

        text.Should().StartWith("1 task(s) match (view=all, status=inprogress).").And.Contain("#2 [Low/InProgress] Working").And.NotContain("#1 ").And.NotContain("#3 ");
    }

    [Fact]
    public async Task InProgressTask_AppearsInOpenAndToday_NotBlocked_AndBlockedFromInProgressAppearsInBlocked()
    {
        var (tools, _) = Setup(WithInProgress);

        var open = await tools.ListTasks();
        var today = await tools.ListTasks(view: "today");
        var blocked = await tools.ListTasks(view: "blocked");

        open.Should().Contain("#2 [");
        today.Should().Contain("#2 [");
        blocked.Should().Contain("#3 [Low/Blocked]").And.NotContain("#2 ");
    }

    [Fact]
    public async Task DetailedFormat_ShowsStartedWhenPresent_ConciseDoesNot()
    {
        var (tools, _) = Setup(WithInProgress);

        var detailed = await tools.ListTasks(view: "all", status: "inprogress", responseFormat: "detailed");
        var concise = await tools.ListTasks(view: "all", status: "inprogress");

        detailed.Should().Contain("Started: 2026-10-08 09:15 UTC");
        concise.Should().NotContain("Started");
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
        new(1, "T", null, null, "Blocked", "Low", null, null, null, null, null, null, 0, null, 0, 0, reason, at);

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
        handler.Get("TaskItems", Array.Empty<object>());
        return (new TaskTools(Fixtures.Client(handler), Fixtures.Time()), handler);
    }

    private static TaskTools Tools(StubHandler handler) => new(Fixtures.Client(handler), Fixtures.Time());

    [Fact]
    public async Task SendsDefaults_TimezoneOffset_AndDateOnlyDueDate()
    {
        var (tools, handler) = Setup(new StubHandler().Post("TaskItems", Fixtures.Task(10, "Write spec", status: "Todo"), HttpStatusCode.Created));

        var text = await tools.CreateTasks([new NewTask { Title = "  Write spec  ", DueDate = "2026-10-20" }]);

        var body = handler.BodyOf(HttpMethod.Post, "TaskItems");
        body.GetProperty("title").GetString().Should().Be("Write spec");
        body.GetProperty("status").GetString().Should().Be("todo");
        body.GetProperty("priority").GetString().Should().Be("low");
        body.GetProperty("dueDate").GetString().Should().Be("2026-10-20");
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        text.Should().StartWith("Created 1 of 1 task(s).").And.Contain("+ #10 ");
    }

    [Theory]
    [InlineData("inprogress")]
    [InlineData("InProgress")]
    [InlineData("INPROGRESS")]
    public async Task InProgressStatus_AnyCasing_IsSentLowercase(string status)
    {
        var (tools, handler) = Setup(new StubHandler().Post("TaskItems", Fixtures.Task(10, "T", status: "InProgress"), HttpStatusCode.Created));

        var text = await tools.CreateTasks([new NewTask { Title = "T", Status = status }]);

        handler.BodyOf(HttpMethod.Post, "TaskItems").GetProperty("status").GetString().Should().Be("inprogress");
        text.Should().Contain("[Low/InProgress]");
    }

    [Fact]
    public async Task ParentCompletedRefusal_ShowsGuidanceOnThatItem_AndOthersContinue()
    {
        var handler = new StubHandler()
            .Post("TaskItems", new { code = "TASK_PARENT_COMPLETED_NOT_ALLOWED", message = "Parent is completed." }, HttpStatusCode.UnprocessableEntity)
            .Post("TaskItems", Fixtures.Task(11, "Fine"), HttpStatusCode.Created);
        var (tools, _) = Setup(handler);

        var text = await tools.CreateTasks([new NewTask { Title = "Child", ParentTaskId = 3 }, new NewTask { Title = "Fine" }]);

        text.Should().StartWith("Created 1 of 2 task(s).").And.Contain("+ #11 ")
            .And.Contain("x \"Child\": Parent is completed. [TASK_PARENT_COMPLETED_NOT_ALLOWED]\nAn open task cannot sit under a Completed parent");
    }

    [Fact]
    public async Task InvalidStatus_IsReportedPerItem_WithAllowedValues_AndNoPost()
    {
        var (tools, handler) = Setup();

        var act = () => tools.CreateTasks([new NewTask { Title = "T", Status = "started" }]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("Allowed values: draft, todo, inprogress, blocked, completed.");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Post);
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
    public async Task CreateTasks_TakesOneClockSnapshot_ForSeveralTasks()
    {
        var handler = new StubHandler().Post("TaskItems", Fixtures.Task(10), HttpStatusCode.Created);
        var clock = new CountingTimeProvider();
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.CreateTasks([new NewTask { Title = "A" }, new NewTask { Title = "B" }, new NewTask { Title = "C" }]);

        // One LocalNow for the call plus one direct GetUtcNow per created task.
        clock.UtcReads.Should().Be(1 + 3);
        handler.Sent(HttpMethod.Post, "TaskItems").Should().HaveCount(3);
        handler.Sent(HttpMethod.Post, "TaskItems")
            .Select(r => System.Text.Json.JsonDocument.Parse(r.Body!).RootElement.GetProperty("timezoneOffsetMinutes").GetInt32())
            .Should().AllBeEquivalentTo(-420);
    }

    [Theory]
    [InlineData(330)]
    [InlineData(345)]
    [InlineData(-570)]
    public async Task CreateTasks_NonHourOffsets_AreSentUnchanged(int offset)
    {
        var handler = new StubHandler().Post("TaskItems", Fixtures.Task(10), HttpStatusCode.Created);
        var tools = new TaskTools(Fixtures.Client(handler), new CountingTimeProvider(offset));

        await tools.CreateTasks([new NewTask { Title = "A" }]);

        handler.BodyOf(HttpMethod.Post, "TaskItems").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(offset);
    }

    [Fact]
    public async Task CreateTasks_DueDateToday_UsesTheSameSnapshotAsTheOffset()
    {
        var handler = new StubHandler().Post("TaskItems", Fixtures.Task(10), HttpStatusCode.Created);
        var clock = new CountingTimeProvider(offsetMinutes: 330, utc: new DateTimeOffset(2026, 10, 9, 20, 0, 0, TimeSpan.Zero));
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.CreateTasks([new NewTask { Title = "A", DueDate = "today" }]);

        var body = handler.BodyOf(HttpMethod.Post, "TaskItems");
        body.GetProperty("dueDate").GetString().Should().Be("2026-10-10");
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(330);
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
    public async Task ExistingOpenTask_WithSameTitle_WarnsButStillCreates()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(12, "Buy milk") })
            .Post("TaskItems", Fixtures.Task(20, "Buy   Milk"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "  Buy \t  MILK " }]);

        text.Should().StartWith("Created 1 of 1 task(s), 1 possible duplicate(s).")
            .And.Contain("+ #20 ").And.Contain("! Possible duplicate of #12 \"Buy milk\" (open)")
            .And.NotContain("Duplicate check skipped");
        handler.Sent(HttpMethod.Post, "TaskItems").Should().HaveCount(1);
    }

    [Fact]
    public async Task ExistingDoneTask_WithSameTitle_WarnsWithDoneStatus()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(12, "Buy milk", status: "Completed") })
            .Post("TaskItems", Fixtures.Task(20, "Buy milk"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "Buy milk" }]);

        text.Should().Contain("! Possible duplicate of #12 \"Buy milk\" (done)");
    }

    [Fact]
    public async Task SameTitleTwiceInABatch_BothCreated_LaterOneNamesTheEarlier()
    {
        var handler = new StubHandler()
            .Get("TaskItems", Array.Empty<object>())
            .Post("TaskItems", Fixtures.Task(20, "Call Bob"), HttpStatusCode.Created)
            .Post("TaskItems", Fixtures.Task(21, "call bob"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "Call Bob" }, new NewTask { Title = "call bob" }]);

        var lines = text.Split('\n');
        lines[1].Should().StartWith("+ #20 ").And.NotContain("!");
        lines[2].Should().StartWith("+ #21 ").And.Contain("! Possible duplicate of #20 \"Call Bob\" (open)");
        text.Should().StartWith("Created 2 of 2 task(s), 1 possible duplicate(s).");
    }

    [Fact]
    public async Task NoMatch_HasNoWarningsAndNoSkipLine_AndSimilarTitlesDoNotWarn()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(12, "Buy milks") })
            .Post("TaskItems", Fixtures.Task(20, "Buy milk"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "Buy milk" }]);

        text.Should().StartWith("Created 1 of 1 task(s).").And.NotContain("!").And.NotContain("Duplicate check skipped");
    }

    [Fact]
    public async Task CaseDifference_StillWarns()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(12, "buy MILK") })
            .Post("TaskItems", Fixtures.Task(20, "BUY milk"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "BUY milk" }]);

        text.Should().Contain("! Possible duplicate of #12 \"buy MILK\"");
    }

    [Theory]
    [InlineData("  Buy milk  ", "Buy milk")]
    [InlineData("Buy\tmilk", "Buy milk")]
    [InlineData("Buy\r\nmilk", "Buy milk")]
    [InlineData("Buy    big   milk", "Buy big milk")]
    [InlineData("Buy MILK", "Buy MILK")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    public void NormalizeTitle_CollapsesWhitespace_AndKeepsCase(string input, string expected) =>
        Formatting.NormalizeTitle(input).Should().Be(expected);

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadRequest)]
    public async Task FailingLookup_StillCreatesAllTasks_AndReportsTheSkippedCheck(HttpStatusCode status)
    {
        var handler = new StubHandler()
            .On(HttpMethod.Get, "TaskItems", null, status)
            .Post("TaskItems", Fixtures.Task(20, "A"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "A" }, new NewTask { Title = "B" }]);

        text.Should().StartWith("Created 2 of 2 task(s).").And.NotContain("Possible duplicate")
            .And.EndWith("Duplicate check skipped: could not read existing tasks.");
        handler.Sent(HttpMethod.Post, "TaskItems").Should().HaveCount(2);
    }

    [Fact]
    public async Task TimedOutLookup_StillCreatesTasks_AndReportsTheSkippedCheck()
    {
        var handler = new StubHandler()
            .Fail(HttpMethod.Get, "TaskItems", new TaskCanceledException("timeout"))
            .Post("TaskItems", Fixtures.Task(20, "A"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "A" }]);

        text.Should().StartWith("Created 1 of 1 task(s).").And.EndWith("Duplicate check skipped: could not read existing tasks.");
    }

    [Fact]
    public async Task FailingLookup_StillFlagsSameBatchDuplicates()
    {
        var handler = new StubHandler()
            .On(HttpMethod.Get, "TaskItems", null, HttpStatusCode.InternalServerError)
            .Post("TaskItems", Fixtures.Task(20, "Call Bob"), HttpStatusCode.Created)
            .Post("TaskItems", Fixtures.Task(21, "Call Bob"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "Call Bob" }, new NewTask { Title = "Call Bob" }]);

        text.Should().Contain("! Possible duplicate of #20").And.EndWith("Duplicate check skipped: could not read existing tasks.");
    }

    [Fact]
    public async Task FailingLookup_WithEveryCreateFailing_ThrowsWithTheSkipLine()
    {
        var handler = new StubHandler()
            .On(HttpMethod.Get, "TaskItems", null, HttpStatusCode.InternalServerError)
            .Post("TaskItems", new { code = "X", message = "Nope." }, HttpStatusCode.UnprocessableEntity);

        var act = () => Tools(handler).CreateTasks([new NewTask { Title = "A" }]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().Contain("Created 0 of 1").And.EndWith("Duplicate check skipped: could not read existing tasks.");
    }

    [Fact]
    public async Task PreCancelledToken_Propagates_AndCreatesNothing()
    {
        var handler = new StubHandler().Get("TaskItems", Array.Empty<object>()).Post("TaskItems", Fixtures.Task(20, "A"), HttpStatusCode.Created);
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        var act = () => Tools(handler).CreateTasks([new NewTask { Title = "A" }], cts.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
        handler.Sent(HttpMethod.Post, "TaskItems").Should().BeEmpty();
    }

    [Fact]
    public async Task FailedOrInvalidEarlierItems_DoNotTriggerSameBatchWarnings()
    {
        var handler = new StubHandler()
            .Get("TaskItems", Array.Empty<object>())
            .Post("TaskItems", Fixtures.Task(20, "Dup"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks(
        [
            new NewTask { Title = "Dup", Status = "blocked" },
            new NewTask { Title = "Dup", Project = "nope" },
            new NewTask { Title = "Dup" },
        ]);

        text.Should().StartWith("Created 1 of 3 task(s).").And.NotContain("Possible duplicate");
    }

    [Fact]
    public async Task ExistingAndEarlierItemMatch_GiveOneWarning_PreferringTheExistingTask()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(12, "Call Bob") })
            .Post("TaskItems", Fixtures.Task(20, "Call Bob"), HttpStatusCode.Created)
            .Post("TaskItems", Fixtures.Task(21, "Call Bob"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "Call Bob" }, new NewTask { Title = "Call Bob" }]);

        var line = text.Split('\n')[2];
        line.Should().Contain("! Possible duplicate of #12 ");
        line.Split("Possible duplicate").Should().HaveCount(2);
        text.Should().StartWith("Created 2 of 2 task(s), 2 possible duplicate(s).");
    }

    [Fact]
    public async Task SeveralExistingTasksWithTheSameTitle_LowestIdIsNamed()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(30, "Call Bob"), Fixtures.Task(12, "call bob") })
            .Post("TaskItems", Fixtures.Task(40, "Call Bob"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "Call Bob" }]);

        text.Should().Contain("! Possible duplicate of #12 ").And.NotContain("#30 \"");
    }

    [Fact]
    public async Task ControlCharactersInTheMatchedTitle_AreStrippedFromTheWarning()
    {
        var handler = new StubHandler()
            .Get("TaskItems", new[] { Fixtures.Task(12, "Call\u0007 Bob") })
            .Post("TaskItems", Fixtures.Task(20, "Call Bob"), HttpStatusCode.Created);

        var text = await Tools(handler).CreateTasks([new NewTask { Title = "Call\u0007 Bob" }]);

        text.Should().Contain("! Possible duplicate of #12 \"Call Bob\"").And.NotContain("\u0007");
    }

    [Fact]
    public async Task AllItemsBlockedOrUntitled_MakeNoRequestAtAll()
    {
        var handler = new StubHandler().Get("TaskItems", Array.Empty<object>());

        var act = () => Tools(handler).CreateTasks([new NewTask { Title = "A", Status = "blocked" }, new NewTask { Title = " " }]);

        await act.Should().ThrowAsync<McpException>();
        handler.Requests.Should().BeEmpty();
    }

    [Fact]
    public async Task OneValidItemAmongInvalid_ReadsExistingTasksExactlyOnce()
    {
        var handler = new StubHandler()
            .Get("TaskItems", Array.Empty<object>())
            .Post("TaskItems", Fixtures.Task(20, "B"), HttpStatusCode.Created);

        await Tools(handler).CreateTasks([new NewTask { Title = "A", Status = "blocked" }, new NewTask { Title = "B" }, new NewTask { Title = "C", Status = "blocked" }]);

        handler.Sent(HttpMethod.Get, "TaskItems").Should().HaveCount(1);
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
    private static object Existing(string status = "Todo", int? projectId = null, string? projectName = null) =>
        Fixtures.Task(5, "Original", status: status, priority: "High", due: "2026-10-12", projectId: projectId, projectName: projectName, description: "Keep me");

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
        handler.AssertNoIsComplete("TaskItems/5");
        body.GetProperty("dueDate").GetString().Should().Be("2026-10-12");
        body.GetProperty("autoCompleteParentWhenChildrenDone").GetBoolean().Should().BeFalse();
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        text.Should().StartWith("Updated #5. Changed priority.");
    }

    [Fact]
    public async Task UpdateTask_TitleOnly_ResendsExistingDueDateUnchanged()
    {
        var (tools, handler) = Setup(Existing());

        var text = await tools.UpdateTask(5, title: "Renamed");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").GetString().Should().Be("2026-10-12");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().NotContain("dueDate");
    }

    [Fact]
    public async Task UpdateTask_PriorityOnly_ResendsExistingDueDateUnchanged()
    {
        var (tools, handler) = Setup(Existing());

        await tools.UpdateTask(5, priority: "low");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").GetString().Should().Be("2026-10-12");
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task UpdateTask_TakesOneClockSnapshot()
    {
        var handler = new StubHandler().Get("TaskItems/5", Existing()).Put("TaskItems/5", Existing());
        var clock = new CountingTimeProvider();
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.UpdateTask(5, priority: "low");

        // One LocalNow for the call plus the direct GetUtcNow for the response's current time.
        clock.UtcReads.Should().Be(2);
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Theory]
    [InlineData(330)]
    [InlineData(345)]
    [InlineData(-570)]
    public async Task UpdateTask_NonHourOffsets_AreSentUnchanged(int offset)
    {
        var handler = new StubHandler().Get("TaskItems/5", Existing()).Put("TaskItems/5", Existing());
        var tools = new TaskTools(Fixtures.Client(handler), new CountingTimeProvider(offset));

        await tools.UpdateTask(5, priority: "low");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(offset);
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task UpdateTask_DueDateToday_UsesTheSameSnapshotAsTheOffset()
    {
        var handler = new StubHandler().Get("TaskItems/5", Existing()).Put("TaskItems/5", Existing());
        var clock = new CountingTimeProvider(offsetMinutes: 330, utc: new DateTimeOffset(2026, 10, 9, 20, 0, 0, TimeSpan.Zero));
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.UpdateTask(5, dueDate: "today");

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("dueDate").GetString().Should().Be("2026-10-10");
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(330);
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task CompleteTrue_SetsCompletedStatus()
    {
        var (tools, handler) = Setup(Existing());

        var text = await tools.UpdateTask(5, complete: true);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("completed");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed status.");
    }

    [Fact]
    public async Task CompleteFalse_ReopensToTodo()
    {
        var (tools, handler) = Setup(Existing(status: "Completed"));

        var text = await tools.UpdateTask(5, complete: false);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("todo");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed status.");
    }

    [Fact]
    public async Task CompleteTrue_OnCompletedTask_ReportsNoChanges()
    {
        var (tools, handler) = Setup(Existing(status: "Completed"));

        var text = await tools.UpdateTask(5, complete: true);

        text.Should().Contain("No changes needed");
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("completed");
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task CompleteFalse_OnTodoTask_ReportsNoChanges()
    {
        var (tools, handler) = Setup(Existing());

        var text = await tools.UpdateTask(5, complete: false);

        text.Should().Contain("No changes needed");
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("todo");
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Theory]
    [InlineData("InProgress", "inprogress")]
    [InlineData("Blocked", "blocked")]
    public async Task CompleteFalse_OnNonCompletedStatus_LeavesStatusAlone(string existingStatus, string expected)
    {
        var (tools, handler) = Setup(Existing(existingStatus));

        await tools.UpdateTask(5, complete: false);

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be(expected);
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task CompleteTrue_BeatsStatusInTheSameCall()
    {
        var (tools, handler) = Setup(Existing());

        await tools.UpdateTask(5, complete: true, status: "draft");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("completed");
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task CompleteFalse_WithStatusCompleted_ReopensToTodo()
    {
        var (tools, handler) = Setup(Existing());

        await tools.UpdateTask(5, status: "completed", complete: false);

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("todo");
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task CompleteTrue_OnBlockedTask_SendsCompletedWithoutLocalRejection()
    {
        var (tools, handler) = Setup(Existing(status: "Blocked"));

        var text = await tools.UpdateTask(5, complete: true);

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("completed");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed status.");
    }

    [Fact]
    public async Task SettingStatus_SendsThatStatus_AndNeverTheRetiredFlag()
    {
        var (tools, handler) = Setup(Existing());
        await tools.UpdateTask(5, status: "completed");
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("completed");
        handler.AssertNoIsComplete("TaskItems/5");

        var (tools2, handler2) = Setup(Existing(status: "Completed"));
        await tools2.UpdateTask(5, status: "draft");
        var body = handler2.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("draft");
        handler2.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task DueDate_CanBeSet_AndCleared()
    {
        var (tools, handler) = Setup(Existing());
        await tools.UpdateTask(5, dueDate: "tomorrow");
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").GetString().Should().Be("2026-10-10");
        handler.AssertNoIsComplete("TaskItems/5");

        var (tools2, handler2) = Setup(Existing());
        await tools2.UpdateTask(5, dueDate: "none");
        handler2.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        handler2.AssertNoIsComplete("TaskItems/5");

        var (tools3, handler3) = Setup(Existing());
        await tools3.UpdateTask(5, dueDate: "2026-11-03");
        handler3.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").GetString().Should().Be("2026-11-03");
        handler3.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task EmptyDescription_ClearsIt_AndParentZeroRemovesTheParent()
    {
        var (tools, handler) = Setup(Existing());

        await tools.UpdateTask(5, description: "", parentTaskId: 0);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("description").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        body.GetProperty("parentTaskItemId").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        handler.AssertNoIsComplete("TaskItems/5");
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
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed blocked (reason: \"Waiting on vendor\").").And.NotContain("status")
            .And.Contain("[High/Blocked]").And.Contain("blocked: Waiting on vendor (4d)").And.Contain("blocked since 2026-10-05 10:00 UTC");
    }

    [Fact]
    public async Task StatusBlocked_WithoutReason_SendsNullReason()
    {
        var (tools, handler) = Setup(Existing(), BlockedTask(null));

        var text = await tools.UpdateTask(5, status: "blocked");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("blockedReason").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        handler.AssertNoIsComplete("TaskItems/5");
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
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("blocked reason (cleared)");
    }

    [Fact]
    public async Task NewReason_OnBlockedTask_IsSummarisedAsBlockedReason()
    {
        var (tools, handler) = Setup(BlockedTask(), BlockedTask("Now waiting on legal"));

        var text = await tools.UpdateTask(5, blockedReason: "Now waiting on legal");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("blockedReason").GetString().Should().Be("Now waiting on legal");
        handler.AssertNoIsComplete("TaskItems/5");
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
        handler.AssertNoIsComplete("TaskItems/5");
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
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed unblocked (now Todo).").And.Contain("[High/Todo]").And.NotContain("blocked:");
    }

    [Fact]
    public async Task StatusTodo_OnTaskBlockedFromInProgress_ReportsNowInProgress_NeverTodo()
    {
        var (tools, handler) = Setup(BlockedTask(), Fixtures.Task(5, "Original", status: "InProgress", priority: "High", startedAt: "2026-10-06T08:30:00Z"));

        var text = await tools.UpdateTask(5, status: "todo");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("todo");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed unblocked (now InProgress).").And.Contain("[High/InProgress]").And.NotContain("Todo").And.NotContain("Changed status");
    }

    [Fact]
    public async Task Unblock_WithProjectChange_KeepsUnblockTextFromThePutResponse_AndOrder()
    {
        var refetched = Fixtures.Task(5, "Original", status: "Todo", priority: "High", projectId: 7, projectName: "Alpha");
        var (tools, _) = Setup(
            BlockedTask(),
            Fixtures.Task(5, "Original", status: "InProgress", priority: "High"),
            h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
                .Post("Projects/7/tasks", status: HttpStatusCode.NoContent)
                .Get("TaskItems/5", refetched));

        var text = await tools.UpdateTask(5, status: "todo", priority: "low", project: "Alpha");

        text.Should().Contain("Changed unblocked (now InProgress), priority, project -> Alpha.");
    }

    [Fact]
    public async Task StatusInProgress_OnTodoTask_SendsInProgress_AndShowsStarted()
    {
        var (tools, handler) = Setup(Existing(), Fixtures.Task(5, "Original", status: "InProgress", priority: "High", startedAt: "2026-10-09T16:45:00Z"));

        var text = await tools.UpdateTask(5, status: "inprogress");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("inprogress");
        handler.BodyOf(HttpMethod.Put, "TaskItems/5").EnumerateObject().Select(p => p.Name).Should().NotContain("startedAt");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed status.").And.Contain("[High/InProgress]").And.Contain("Started: 2026-10-09 16:45 UTC");
    }

    [Fact]
    public async Task StatusTodo_OnInProgressTask_SendsTodo()
    {
        var (tools, handler) = Setup(Existing("InProgress"), Existing());

        var text = await tools.UpdateTask(5, status: "todo");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("todo");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed status.");
    }

    [Fact]
    public async Task StatusInProgress_OnInProgressTask_IsNotRejectedLocally()
    {
        var (tools, handler) = Setup(Existing("InProgress"));

        var text = await tools.UpdateTask(5, status: "inprogress", priority: "low");

        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed priority.").And.NotContain("status");
    }

    [Fact]
    public async Task StatusInProgress_OnBlockedTask_IsForwardedToTheApi()
    {
        var (tools, handler) = Setup(BlockedTask(), Fixtures.Task(5, "Original", status: "InProgress"));

        await tools.UpdateTask(5, status: "inprogress");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("status").GetString().Should().Be("inprogress");
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task BlockingAnInProgressTask_WithReason_Succeeds()
    {
        var blocked = Fixtures.Task(5, "Original", status: "Blocked", blockedReason: "Waiting", blockedAt: "2026-10-09T10:00:00Z", previousStatus: "InProgress");
        var (tools, handler) = Setup(Existing("InProgress"), blocked);

        var text = await tools.UpdateTask(5, status: "blocked", blockedReason: "Waiting");

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("blockedReason").GetString().Should().Be("Waiting");
        handler.AssertNoIsComplete("TaskItems/5");
        text.Should().Contain("Changed blocked (reason: \"Waiting\").");
    }

    [Theory]
    [InlineData("Draft", "Task #5 is Draft, so it can't be started.", "status=todo")]
    [InlineData("Completed", "Task #5 is Completed, so it can't be started.", "complete=false")]
    public async Task StatusInProgress_OnDraftOrCompleted_IsRejectedLocally_WithRecoverySteps(string existingStatus, string expectedStart, string expectedFix)
    {
        var (tools, handler) = Setup(Existing(existingStatus));

        var act = () => tools.UpdateTask(5, status: "InProgress");

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().StartWith(expectedStart).And.Contain(expectedFix).And.Contain("status=inprogress").And.NotContain("422").And.NotContain("TASK_START_NOT_ALLOWED");
        handler.Sent(HttpMethod.Get, "TaskItems/5").Should().HaveCount(1);
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task StatusInProgress_WithCompleteFalse_OnCompletedTask_IsRejectedLocally()
    {
        var (tools, handler) = Setup(Existing("Completed"));

        var act = () => tools.UpdateTask(5, status: "inprogress", complete: false);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("is Completed");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task StatusInProgress_Api422StartNotAllowed_GetsFallbackGuidance()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing())
            .Put("TaskItems/5", new { code = "TASK_START_NOT_ALLOWED", message = "Only Todo tasks can be moved to In Progress." }, HttpStatusCode.UnprocessableEntity);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, status: "inprogress");

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().Contain("[TASK_START_NOT_ALLOWED]\n").And.Contain("status=inprogress");
    }

    [Fact]
    public async Task InvalidStatus_ListsAllStatuses_WithoutAnyPut()
    {
        var (tools, handler) = Setup(Existing());

        var act = () => tools.UpdateTask(5, status: "started");

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("Allowed values: draft, todo, inprogress, blocked, completed.");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public void ToolDescriptions_NoLongerSayOnlyTodoCanBeBlocked()
    {
        var texts = new[]
        {
            UpdateFieldText.Status,
            UpdateFieldText.BlockedReason,
            typeof(TaskTools).GetMethod(nameof(TaskTools.UpdateTask))!.GetCustomAttributes(typeof(System.ComponentModel.DescriptionAttribute), false)
                .Cast<System.ComponentModel.DescriptionAttribute>().Single().Description,
        };

        foreach (var text in texts)
        {
            text.Should().NotContain("Only Todo tasks can be blocked").And.NotContain("status=todo unblocks a Blocked task");
        }

        UpdateFieldText.Status.Should().Contain("inprogress").And.Contain("Only Todo or InProgress tasks can be blocked");
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CompletingABlockedTask_CompletesIt(bool useComplete)
    {
        var (tools, handler) = Setup(BlockedTask(), Fixtures.Task(5, "Original", status: "Completed"));

        var text = useComplete ? await tools.UpdateTask(5, complete: true) : await tools.UpdateTask(5, status: "completed");

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("status").GetString().Should().Be("completed");
        handler.AssertNoIsComplete("TaskItems/5");
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
        handler.AssertNoIsComplete("TaskItems/5");
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
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Theory]
    [InlineData("TASK_BLOCK_DRAFT_NOT_ALLOWED", "make the task todo first", "Make the task Todo first")]
    [InlineData("TASK_BLOCK_COMPLETED_NOT_ALLOWED", "reopen", "Reopen the task first")]
    [InlineData("TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS", "needs status", "omit blockedReason")]
    [InlineData("TASK_BLOCK_DRAFT_NOT_ALLOWED", "no drafts", "Only Todo or InProgress tasks can be blocked")]
    [InlineData("TASK_BLOCK_COMPLETED_NOT_ALLOWED", "no done", "Only Todo or InProgress tasks can be blocked")]
    [InlineData("TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS", "needs status", "on a Todo or InProgress task")]
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
        handler.AssertNoIsComplete("TaskItems/5");
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

    private static object Plan(string? plannedOn, string status = "Todo", int? projectId = null, int children = 0) =>
        Fixtures.Task(5, "Original", status: status, priority: "High", due: "2026-10-12", projectId: projectId, description: "Keep me", plannedOn: plannedOn, childTaskCount: children);

    private static StubHandler PutPastDay(StubHandler handler) =>
        handler.On(HttpMethod.Put, "TaskItems/5", new { code = "TASK_CREATION_PAST_DAY_NOT_ALLOWED", message = "Tasks cannot be planned on a past day." }, HttpStatusCode.UnprocessableEntity);

    [Theory]
    [InlineData("today", "2026-10-09")]
    [InlineData("Tomorrow", "2026-10-10")]
    [InlineData("2026-10-10", "2026-10-10")]
    [InlineData(" 2026-11-02 ", "2026-11-02")]
    public async Task JournalDate_PlansTheTaskOnThatDay_AndReportsIt(string input, string expected)
    {
        var (tools, handler) = Setup(Plan(null), Plan(expected));

        var text = await tools.UpdateTask(5, journalDate: input, ct: TestContext.Current.CancellationToken);

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("journalDate").GetString().Should().Be(expected);
        text.Should().StartWith($"Updated #5. Changed planned {expected}.").And.Contain($"planned {expected}");
        handler.Sent(HttpMethod.Get, "TaskItems/5").Should().HaveCount(1);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task JournalDate_Absent_SendsNull_AndReportsNoPlanning(string? input)
    {
        var (tools, handler) = Setup(Plan("2026-10-11"));

        var text = await tools.UpdateTask(5, priority: "low", journalDate: input, ct: TestContext.Current.CancellationToken);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.TryGetProperty("journalDate", out var property).Should().BeTrue();
        property.ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        text.Split('\n')[0].Should().Be("Updated #5. Changed priority.");
    }

    [Fact]
    public async Task JournalDate_SameDayAlreadyPlanned_Succeeds_WithoutAPlannedChange()
    {
        var (tools, handler) = Setup(Plan("2026-10-09"));

        var text = await tools.UpdateTask(5, journalDate: "today", ct: TestContext.Current.CancellationToken);

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("journalDate").GetString().Should().Be("2026-10-09");
        text.Split('\n')[0].Should().Be("Updated #5. No changes needed.");
    }

    [Fact]
    public async Task JournalDate_DayWithoutAJournalEntry_NeedsNoJournalRequests()
    {
        var (tools, handler) = Setup(Plan(null), Plan("2026-12-24"));

        await tools.UpdateTask(5, journalDate: "2026-12-24", ct: TestContext.Current.CancellationToken);

        handler.Requests.Should().OnlyContain(r => r.Path == "TaskItems/5");
        handler.Requests.Should().NotContain(r => r.Path.StartsWith("Journal"));
    }

    [Fact]
    public async Task JournalDate_OnAParentWithOpenSubtasks_ThrowsWithGuidance_AndMakesNoFurtherRequests()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Plan(null, children: 2))
            .Put("TaskItems/5", new { code = "TASK_PLAN_HAS_OPEN_SUBTASKS", message = "A task with open subtasks can't be planned on a day. Plan its subtasks instead." }, HttpStatusCode.UnprocessableEntity);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, journalDate: "tomorrow", ct: TestContext.Current.CancellationToken);

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().StartWith("A task with open subtasks can't be planned on a day. Plan its subtasks instead. [TASK_PLAN_HAS_OPEN_SUBTASKS]\n")
            .And.Contain("Plan its subtasks instead, using update_task or update_tasks with journalDate");
        message.Split('\n').Should().HaveCount(2);
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
        handler.Requests.Should().OnlyContain(r => r.Path == "TaskItems/5");
    }

    [Theory]
    [InlineData("TASK_PARENT_COMPLETED_NOT_ALLOWED", "Completed", "reopen", "Reopen the parent first")]
    [InlineData("TASK_PARENT_STATUS_DERIVED", "Todo", "start", "Change the status of its subtasks")]
    [InlineData("TASK_PLAN_COMPLETED_NOT_ALLOWED", "Completed", "plan", "A completed task cannot be planned onto a different day")]
    public async Task ParentAndPlanningCodes_SurfaceMessageCodeAndOneGuidanceLine(string code, string status, string scenario, string guidance)
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Plan(null, status: status))
            .Put("TaskItems/5", new { code, message = "Refused." }, HttpStatusCode.UnprocessableEntity);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = scenario switch
        {
            "reopen" => () => tools.UpdateTask(5, complete: false, ct: TestContext.Current.CancellationToken),
            "start" => () => tools.UpdateTask(5, status: "inprogress", ct: TestContext.Current.CancellationToken),
            _ => (Func<Task<string>>)(() => tools.UpdateTask(5, journalDate: "tomorrow", ct: TestContext.Current.CancellationToken)),
        };

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().StartWith($"Refused. [{code}]\n").And.Contain(guidance);
        message.Split('\n').Should().HaveCount(2);
    }

    [Fact]
    public async Task PriorityOnlyEdit_OnATaskWithChildren_SendsThePut_WithoutAnyPreCheck()
    {
        var (tools, handler) = Setup(Plan(null, children: 2));

        var text = await tools.UpdateTask(5, priority: "low", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
        text.Should().StartWith("Updated #5. Changed priority.");
    }

    [Fact]
    public async Task JournalDate_PutLacksTheDay_FollowUpGetConfirmsIt()
    {
        var (tools, handler) = Setup(Plan(null), Plan(null), h => h.Get("TaskItems/5", Plan("2026-10-10")));

        var text = await tools.UpdateTask(5, journalDate: "tomorrow", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Get, "TaskItems/5").Should().HaveCount(2);
        text.Should().Contain("Changed planned 2026-10-10").And.Contain("| planned 2026-10-10");
    }

    [Fact]
    public async Task JournalDate_PutReturnsADifferentDay_FollowUpGetDecidesWhatIsReported()
    {
        var (tools, handler) = Setup(Plan(null), Plan("2026-10-08"), h => h.Get("TaskItems/5", Plan("2026-10-10")));

        var text = await tools.UpdateTask(5, journalDate: "tomorrow", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Get, "TaskItems/5").Should().HaveCount(2);
        text.Should().Contain("planned 2026-10-10").And.NotContain("2026-10-08");
    }

    [Fact]
    public async Task JournalDate_FollowUpGetFails_StillReportsTheUpdate_AndSaysPlanningIsUnconfirmed()
    {
        var (tools, handler) = Setup(Plan(null), Plan(null), h => h.On(HttpMethod.Get, "TaskItems/5", new { message = "boom" }, HttpStatusCode.InternalServerError));

        var text = await tools.UpdateTask(5, journalDate: "tomorrow", priority: "low", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Get, "TaskItems/5").Should().HaveCount(2);
        text.Should().StartWith("Updated #5. Changed priority.").And.Contain("could not be confirmed");
        text.Split('\n')[0].Should().NotContain("planned 2026");
    }

    [Fact]
    public async Task JournalDate_WithAProjectStep_ReusesTheProjectReread_NeverThreeGets()
    {
        var (tools, handler) = Setup(Plan(null), Plan(null), h => h
            .Get("TaskItems/5", Plan("2026-10-10", projectId: 7))
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", status: HttpStatusCode.NoContent));

        var text = await tools.UpdateTask(5, journalDate: "tomorrow", project: "Alpha", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Get, "TaskItems/5").Should().HaveCount(2);
        text.Should().Contain("planned 2026-10-10").And.Contain("project -> Alpha");
    }

    [Fact]
    public async Task JournalDate_PastDayRejectedByTheApi_GivesGuidance_AndNoSecondPut()
    {
        var handler = PutPastDay(new StubHandler().Get("TaskItems/5", Plan(null)));
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, journalDate: "2026-10-01", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().Contain("past day").And.Contain("today or later");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
    }

    [Theory]
    [InlineData("yesterday")]
    [InlineData("none")]
    [InlineData("next friday")]
    [InlineData("2026-1-5")]
    public async Task JournalDate_InvalidValue_IsRejectedLocally_NamingTheAcceptedForms(string input)
    {
        var (tools, handler) = Setup(Plan(null));

        var act = () => tools.UpdateTask(5, journalDate: input, ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().Contain("journalDate").And.Contain("today, tomorrow, or yyyy-MM-dd").And.Contain("e.g. 2026-10-10").And.Contain("set_journal_todos");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Theory]
    [InlineData("Completed")]
    [InlineData("Blocked")]
    public async Task JournalDate_OnCompletedOrBlockedTask_SurfacesTheRawApiMessage(string status)
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Plan(null, status: status))
            .Put("TaskItems/5", new { message = "That task cannot be planned right now." }, HttpStatusCode.BadRequest);
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var act = () => tools.UpdateTask(5, journalDate: "today", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Be("That task cannot be planned right now.");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
    }

    [Fact]
    public async Task JournalDate_ProjectAssignmentFails_ReportsPartialSuccess_WithTheOriginalReason()
    {
        var (tools, _) = Setup(Plan(null), Plan("2026-10-10"), h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.BadRequest));

        var act = () => tools.UpdateTask(5, journalDate: "tomorrow", project: "Alpha", ct: TestContext.Current.CancellationToken);

        var ex = (await act.Should().ThrowAsync<McpException>()).Which;
        ex.Message.Should().Contain("Task #5 was updated and planned for 2026-10-10")
            .And.Contain("assigning it to project 'Alpha' failed")
            .And.Contain("Project is full.")
            .And.Contain("Retry only the project change.")
            .And.NotContain("Nothing was changed");
        ex.InnerException.Should().BeOfType<TaskFlow.Mcp.Api.TaskFlowApiException>();
        Occurrences(ex.Message, "was updated and planned").Should().Be(1);
    }

    [Fact]
    public async Task JournalDate_ProjectAssignmentFailsWithCodedRule_ReportsTheProjectErrorExactlyOnce()
    {
        var (tools, _) = Setup(Plan(null), Plan("2026-10-10"), h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { code = "X", message = "Project rule broken." }, HttpStatusCode.UnprocessableEntity));

        var act = () => tools.UpdateTask(5, journalDate: "tomorrow", project: "Alpha", ct: TestContext.Current.CancellationToken);

        var ex = (await act.Should().ThrowAsync<McpException>()).Which;
        ex.Message.Should().Contain("Task #5 was updated and planned for 2026-10-10")
            .And.Contain("Retry only the project change.");
        Occurrences(ex.Message, "Project rule broken.").Should().Be(1);
        Occurrences(ex.Message, "was updated and planned").Should().Be(1);
    }

    [Fact]
    public async Task JournalDate_UnknownProject_FailsWithThePlainError_AndSendsNoPut()
    {
        var (tools, handler) = Setup(Plan(null), Plan("2026-10-10"), h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        var act = () => tools.UpdateTask(5, journalDate: "tomorrow", project: "Nope", ct: TestContext.Current.CancellationToken);

        var ex = (await act.Should().ThrowAsync<McpException>()).Which;
        ex.Message.Should().StartWith("No project matches 'Nope'").And.NotContain("was updated");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Fact]
    public async Task UnknownProject_WithOtherChanges_FailsBeforeAnyWrite()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        var act = () => tools.UpdateTask(5, priority: "high", project: "Typo", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().StartWith("No project matches 'Typo'");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put || r.Method == HttpMethod.Post);
    }

    [Fact]
    public async Task AmbiguousProject_WithOtherChanges_FailsBeforeAnyWrite()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha One"), Fixtures.Project(8, "Alpha Two") }));

        var act = () => tools.UpdateTask(5, priority: "low", project: "Alpha", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("ambiguous");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Fact]
    public async Task StatusTransition_WithUnknownProject_FailsWithThePlainError_AndSendsNoPut()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        var act = () => tools.UpdateTask(5, status: "blocked", project: "Typo", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().StartWith("No project matches 'Typo'").And.NotContain("was updated");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Fact]
    public async Task ValidationError_WithUnknownProject_IsReported_WithoutAProjectLookup()
    {
        var (tools, handler) = Setup(Plan(null, status: "Draft"), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        var act = () => tools.UpdateTask(5, status: "inprogress", project: "Typo", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("can't be started").And.NotContain("No project matches");
        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Theory]
    [InlineData("blockedReasonTooLong")]
    [InlineData("blockedReasonWithoutBlocked")]
    [InlineData("invalidDueDate")]
    public async Task OtherValidationErrors_WithUnknownProject_AreReported_WithoutAProjectLookup(string scenario)
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        var act = () => scenario switch
        {
            "blockedReasonTooLong" => tools.UpdateTask(5, status: "blocked", blockedReason: new string('x', 201), project: "Typo", ct: TestContext.Current.CancellationToken),
            "blockedReasonWithoutBlocked" => tools.UpdateTask(5, blockedReason: "waiting", project: "Typo", ct: TestContext.Current.CancellationToken),
            _ => tools.UpdateTask(5, dueDate: "someday", project: "Typo", ct: TestContext.Current.CancellationToken),
        };

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().NotContain("No project matches");
        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Fact]
    public async Task ProjectFailure_AfterAnUnblock_NamesTheUnblockAsSaved()
    {
        var blocked = Fixtures.Task(5, "Original", status: "Blocked", priority: "High", due: "2026-10-12", description: "Keep me");
        var (tools, _) = Setup(blocked, Plan(null), h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.UnprocessableEntity));

        var act = () => tools.UpdateTask(5, status: "todo", project: "Alpha", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().Contain("Task #5's fields were saved (unblocked").And.Contain("Retry only the project change");
    }

    [Fact]
    public async Task InvalidJournalDate_WithUnknownProject_IsReported_WithoutAProjectLookup()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        var act = () => tools.UpdateTask(5, journalDate: "someday", project: "Typo", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("journalDate").And.NotContain("No project matches");
        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Fact]
    public async Task ValidProject_RunsGetValidateResolvePutAssign_InThatOrder()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", status: HttpStatusCode.NoContent));

        var text = await tools.UpdateTask(5, priority: "low", project: "Alpha", ct: TestContext.Current.CancellationToken);

        handler.Requests.Select(r => $"{r.Method} {r.Path}").Take(4).Should().Equal(
            "GET TaskItems/5", "GET Projects", "PUT TaskItems/5", "POST Projects/7/tasks");
        text.Should().StartWith("Updated #5. Changed priority, project -> Alpha.");
    }

    [Fact]
    public async Task ProjectFailure_AfterFieldsWereSaved_SaysSo_AndTellsToRetryOnlyTheProject()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.UnprocessableEntity));

        var act = () => tools.UpdateTask(5, priority: "low", project: "Alpha", ct: TestContext.Current.CancellationToken);

        var ex = (await act.Should().ThrowAsync<McpException>()).Which;
        ex.Message.Should().Contain("Task #5's fields were saved (priority)")
            .And.Contain("assigning it to project 'Alpha' failed")
            .And.Contain("Project is full.")
            .And.Contain("Retry only the project change: call update_task with id=5 and project='Alpha' only.");
        ex.InnerException.Should().BeOfType<TaskFlow.Mcp.Api.TaskFlowApiException>();
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
    }

    [Fact]
    public async Task ProjectFailure_WhenThePutCarriedNoRealChange_DoesNotClaimFieldsWereSaved()
    {
        var blocked = Fixtures.Task(5, "Original", status: "Blocked", priority: "High", due: "2026-10-12", description: "Keep me", blockedReason: "waiting");
        var (tools, handler) = Setup(blocked, configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.UnprocessableEntity));

        var act = () => tools.UpdateTask(5, status: "blocked", blockedReason: "waiting", project: "Alpha", ct: TestContext.Current.CancellationToken);

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().Contain("Task #5 was re-saved unchanged, but assigning it to project 'Alpha' failed: Project is full.")
            .And.NotContain("fields were saved");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
    }

    [Fact]
    public async Task ProjectFailure_AfterAStatusTransition_NamesTheSavedChange()
    {
        var (tools, _) = Setup(Plan(null), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.UnprocessableEntity));

        var act = () => tools.UpdateTask(5, status: "inprogress", project: "Alpha", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("fields were saved (status)");
    }

    [Fact]
    public async Task FailedUnassign_AfterFieldsWereSaved_GetsTheSavedFieldsMessage()
    {
        var (tools, handler) = Setup(Plan(null, projectId: 7), configure: h => h
            .Delete("Projects/7/tasks/5", HttpStatusCode.BadRequest, new { message = "Cannot remove." }));

        var act = () => tools.UpdateTask(5, priority: "low", project: "none", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("fields were saved (priority)")
            .And.Contain("removing it from its project failed")
            .And.Contain("project='none' only");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
    }

    [Fact]
    public async Task ProjectOnly_SendsNoPut_AndAssigns()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", status: HttpStatusCode.NoContent));

        var text = await tools.UpdateTask(5, project: "Alpha", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
        handler.Sent(HttpMethod.Post, "Projects/7/tasks").Should().HaveCount(1);
        text.Should().StartWith("Updated #5. Changed project -> Alpha.");
    }

    [Fact]
    public async Task ProjectOnly_AssignFails_DoesNotClaimFieldsWereSaved()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.UnprocessableEntity));

        var act = () => tools.UpdateTask(5, project: "Alpha", ct: TestContext.Current.CancellationToken);

        var ex = (await act.Should().ThrowAsync<McpException>()).Which;
        ex.Message.Should().Contain("Project is full.").And.NotContain("saved").And.NotContain("was updated");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Fact]
    public async Task ProjectWithUnblockOrBlockedReasonChange_StillSendsThePut()
    {
        var blocked = Fixtures.Task(5, "Original", status: "Blocked", priority: "High", due: "2026-10-12", description: "Keep me");
        var (tools, handler) = Setup(blocked, configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", status: HttpStatusCode.NoContent));

        await tools.UpdateTask(5, status: "todo", project: "Alpha", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
    }

    [Fact]
    public async Task SameProjectAsCurrent_SendsNoAssignRequest()
    {
        var (tools, handler) = Setup(Plan(null, projectId: 7), configure: h => h.Get("Projects", new[] { Fixtures.Project(7, "Alpha") }));

        await tools.UpdateTask(5, priority: "low", project: "Alpha", ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Post, "Projects/7/tasks").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().HaveCount(1);
    }

    [Theory]
    [InlineData("none")]
    [InlineData("None")]
    [InlineData("  none ")]
    public async Task ProjectNone_DoesNoLookup_AndUnassignsWhenTheTaskHasAProject(string value)
    {
        var (tools, handler) = Setup(Plan(null, projectId: 7), configure: h => h.Delete("Projects/7/tasks/5"));

        await tools.UpdateTask(5, priority: "low", project: value, ct: TestContext.Current.CancellationToken);

        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
        handler.Sent(HttpMethod.Delete, "Projects/7/tasks/5").Should().HaveCount(1);
    }

    [Fact]
    public async Task ProjectNone_WhenTheTaskHasNoProject_SendsNoDelete()
    {
        var (tools, handler) = Setup(Plan(null));

        await tools.UpdateTask(5, priority: "low", project: "none", ct: TestContext.Current.CancellationToken);

        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Delete);
        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
    }

    [Fact]
    public async Task AssignConflict_IsSwallowed()
    {
        var (tools, _) = Setup(Plan(null), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Already there." }, HttpStatusCode.Conflict));

        var text = await tools.UpdateTask(5, priority: "low", project: "Alpha", ct: TestContext.Current.CancellationToken);

        text.Should().StartWith("Updated #5.");
    }

    [Fact]
    public async Task UnreachableApiDuringTheProjectLookup_FailsBeforeAnyWrite()
    {
        var (tools, handler) = Setup(Plan(null), configure: h => h.Fail(HttpMethod.Get, "Projects", new HttpRequestException("refused")));

        var act = () => tools.UpdateTask(5, priority: "low", project: "Alpha", ct: TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("Cannot reach the TaskFlow API");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
    }

    [Fact]
    public async Task CancellationDuringTheProjectStep_PropagatesUnwrapped()
    {
        var (tools, _) = Setup(Plan(null), configure: h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Fail(HttpMethod.Post, "Projects/7/tasks", new OperationCanceledException()));

        var act = () => tools.UpdateTask(5, priority: "low", project: "Alpha", ct: TestContext.Current.CancellationToken);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task JournalDate_UnreachableApiDuringTheProjectStep_IsNotReportedAsPartialSuccess()
    {
        var (tools, _) = Setup(Plan(null), Plan("2026-10-10"), h => h
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Fail(HttpMethod.Post, "Projects/7/tasks", new HttpRequestException("refused")));

        var act = () => tools.UpdateTask(5, journalDate: "tomorrow", project: "Alpha", ct: TestContext.Current.CancellationToken);

        var ex = (await act.Should().ThrowAsync<McpException>()).Which;
        ex.Message.Should().Contain("Cannot reach the TaskFlow API").And.NotContain("was updated and planned");
        ex.InnerException.Should().BeOfType<HttpRequestException>();
    }

    [Fact]
    public async Task JournalDate_TakesOneClockSnapshot()
    {
        var handler = new StubHandler().Get("TaskItems/5", Plan(null)).Put("TaskItems/5", Plan("2026-10-09"));
        var clock = new CountingTimeProvider();
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.UpdateTask(5, journalDate: "today", ct: TestContext.Current.CancellationToken);

        // One LocalNow for the call plus the direct GetUtcNow for the response's current time.
        clock.UtcReads.Should().Be(2);
    }

    [Theory]
    [InlineData("today", "2026-10-10")]
    [InlineData("tomorrow", "2026-10-11")]
    public async Task JournalDate_NearLocalMidnight_UsesTheLocalDay_AndMatchingOffset(string input, string expected)
    {
        // 20:00Z at +05:30 is 01:30 on 2026-10-10 locally.
        var handler = new StubHandler().Get("TaskItems/5", Plan(null)).Put("TaskItems/5", Plan(expected));
        var clock = new CountingTimeProvider(offsetMinutes: 330, utc: new DateTimeOffset(2026, 10, 9, 20, 0, 0, TimeSpan.Zero));
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.UpdateTask(5, journalDate: input, ct: TestContext.Current.CancellationToken);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("journalDate").GetString().Should().Be(expected);
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(330);
    }

    private static int Occurrences(string text, string phrase) =>
        text.Split(phrase).Length - 1;
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

public class UpdateTasksTests
{
    private static object Existing(int id, string title = "Original", string status = "Todo", int? projectId = null) =>
        Fixtures.Task(id, title, status: status, priority: "High", due: "2026-10-12", projectId: projectId, description: "Keep me");

    private static StubHandler HandlerFor(params int[] ids)
    {
        var handler = new StubHandler();
        foreach (var id in ids)
        {
            handler.Get($"TaskItems/{id}", Existing(id, $"Task {id}")).Put($"TaskItems/{id}", Existing(id, $"Task {id}"));
        }

        return handler;
    }

    private static TaskTools Tools(StubHandler handler) => new(Fixtures.Client(handler), Fixtures.Time());

    [Fact]
    public async Task EightTasksEachWithAProject_AreAllUpdated()
    {
        var handler = HandlerFor(1, 2, 3, 4, 5, 6, 7, 8)
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", status: HttpStatusCode.NoContent);

        var text = await Tools(handler).UpdateTasks(Enumerable.Range(1, 8).Select(i => new TaskUpdate { Id = i, Project = "Alpha", Priority = "low" }).ToList());

        text.Should().StartWith("Updated 8 of 8 task(s).");
        handler.Sent(HttpMethod.Put, "TaskItems/3").Should().HaveCount(1);
        handler.BodyOf(HttpMethod.Put, "TaskItems/8").GetProperty("priority").GetString().Should().Be("low");
        handler.Sent(HttpMethod.Post, "Projects/7/tasks").Should().HaveCount(8);
        handler.BodyOf(HttpMethod.Post, "Projects/7/tasks").GetProperty("taskItemId").GetInt32().Should().Be(8);
        handler.AssertNoIsComplete("TaskItems/8");
    }

    [Theory]
    [InlineData(4)]
    [InlineData(25)]
    public async Task UpdateTasks_TakesOneClockSnapshot_ForTheWholeBatch(int count)
    {
        var ids = Enumerable.Range(1, count).ToArray();
        var handler = HandlerFor(ids);
        var clock = new CountingTimeProvider();
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.UpdateTasks(ids.Select(i => new TaskUpdate { Id = i, Priority = "low" }).ToList());

        // Only the single LocalNow for the whole batch reads the clock.
        clock.UtcReads.Should().Be(1);
        foreach (var id in ids)
        {
            handler.BodyOf(HttpMethod.Put, $"TaskItems/{id}").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
            handler.AssertNoIsComplete($"TaskItems/{id}");
        }
    }

    [Fact]
    public async Task UpdateTasks_TodayDueDatesWithFailingItemMidBatch_StillTakesOneClockSnapshot()
    {
        var handler = HandlerFor(1, 3);
        var clock = new CountingTimeProvider();
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.UpdateTasks([
            new TaskUpdate { Id = 1, DueDate = "today" },
            new TaskUpdate { Id = 2, DueDate = "today" },
            new TaskUpdate { Id = 3, DueDate = "today" },
        ]);

        clock.UtcReads.Should().Be(1);
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().HaveCount(1);
        handler.Sent(HttpMethod.Put, "TaskItems/3").Should().HaveCount(1);
        handler.BodyOf(HttpMethod.Put, "TaskItems/1").GetProperty("dueDate").GetString().Should().Be("2026-10-09");
        handler.BodyOf(HttpMethod.Put, "TaskItems/3").GetProperty("dueDate").GetString().Should().Be("2026-10-09");
        handler.AssertNoIsComplete("TaskItems/1");
        handler.AssertNoIsComplete("TaskItems/3");
    }

    [Theory]
    [InlineData("tomorrow", "2026-10-10")]
    [InlineData("2026-11-03", "2026-11-03")]
    public async Task UpdateTasks_DueDate_SendsDateOnlyValue(string dueDate, string expected)
    {
        var handler = HandlerFor(5);

        await Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, DueDate = dueDate }]);

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").GetString().Should().Be(expected);
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task UpdateTasks_DueDateNone_SendsNullDueDate()
    {
        var handler = HandlerFor(5);

        await Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, DueDate = "none" }]);

        handler.BodyOf(HttpMethod.Put, "TaskItems/5").GetProperty("dueDate").ValueKind.Should().Be(JsonValueKind.Null);
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task SingleItem_SendsTheSameRequestAsUpdateTask_AndReportsTheChanges()
    {
        var single = HandlerFor(5);
        await Tools(single).UpdateTask(5, priority: "low", dueDate: "none");
        var batch = HandlerFor(5);

        var text = await Tools(batch).UpdateTasks([new TaskUpdate { Id = 5, Priority = "low", DueDate = "none" }]);

        batch.Sent(HttpMethod.Put, "TaskItems/5").Last().Body.Should().Be(single.Sent(HttpMethod.Put, "TaskItems/5").Last().Body);
        text.Should().Be("Updated 1 of 1 task(s).\n+ #5 \"Task 5\": Changed priority, dueDate");
    }

    [Fact]
    public async Task UnsuppliedFields_KeepTheirCurrentValues()
    {
        var handler = HandlerFor(5);

        await Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, Complete = true }]);

        var body = handler.BodyOf(HttpMethod.Put, "TaskItems/5");
        body.GetProperty("title").GetString().Should().Be("Task 5");
        body.GetProperty("description").GetString().Should().Be("Keep me");
        body.GetProperty("priority").GetString().Should().Be("high");
        body.GetProperty("dueDate").GetString().Should().Be("2026-10-12");
        body.GetProperty("status").GetString().Should().Be("completed");
        handler.AssertNoIsComplete("TaskItems/5");
    }

    [Fact]
    public async Task UnknownIdAndInvalidProject_AreReportedPerItem_WithTheRealSuccessCount()
    {
        var handler = HandlerFor(1, 3)
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") });

        var text = await Tools(handler).UpdateTasks(
        [
            new TaskUpdate { Id = 1, Priority = "low" },
            new TaskUpdate { Id = 2, Priority = "low" },
            new TaskUpdate { Id = 3, Project = "nope" },
        ]);

        var lines = text.Split('\n');
        lines[0].Should().Be("Updated 1 of 3 task(s).");
        lines[1].Should().StartWith("+ #1 \"Task 1\": Changed priority");
        lines[2].Should().StartWith("x #2: Not found");
        lines[3].Should().StartWith("x #3: No project matches 'nope'");
        handler.Sent(HttpMethod.Put, "TaskItems/3").Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateTasks_ValidationErrorWithUnknownProject_ReportsTheValidationError_WithoutALookup()
    {
        var handler = HandlerFor(1, 2).Get("Projects", new[] { Fixtures.Project(7, "Alpha") });

        var text = await Tools(handler).UpdateTasks(
        [
            new TaskUpdate { Id = 1, JournalDate = "someday", Project = "Typo" },
            new TaskUpdate { Id = 2, Priority = "low" },
        ]);

        text.Should().Contain("x #1: journalDate").And.NotContain("No project matches");
        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateTasks_ValidationErrorsWithUnknownProject_ReportTheValidationError_WithoutALookup()
    {
        var handler = HandlerFor(1, 2, 3).Get("Projects", new[] { Fixtures.Project(7, "Alpha") });

        var text = await Tools(handler).UpdateTasks(
        [
            new TaskUpdate { Id = 1, BlockedReason = "waiting", Project = "Typo" },
            new TaskUpdate { Id = 2, DueDate = "someday", Project = "Typo" },
            new TaskUpdate { Id = 3, Priority = "low" },
        ]);

        var lines = text.Split('\n');
        lines[1].Should().StartWith("x #1: blockedReason needs status=blocked");
        lines[2].Should().StartWith("x #2: ").And.NotContain("No project matches");
        lines[3].Should().StartWith("+ #3 ");
        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/2").Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateTasks_StartingADraftWithUnknownProject_ReportsTheStatusError_WithoutALookup()
    {
        var handler = HandlerFor(2)
            .Get("TaskItems/4", Existing(4, "Task 4", status: "Draft"))
            .Put("TaskItems/4", Existing(4, "Task 4", status: "Draft"))
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") });

        var text = await Tools(handler).UpdateTasks(
        [
            new TaskUpdate { Id = 4, Status = "inprogress", Project = "Typo" },
            new TaskUpdate { Id = 2, Priority = "low" },
        ]);

        var lines = text.Split('\n');
        lines[1].Should().StartWith("x #4: ").And.Contain("can't be started").And.NotContain("No project matches");
        lines[2].Should().StartWith("+ #2 ");
        handler.Sent(HttpMethod.Get, "Projects").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/4").Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateTasks_ProjectFailureAfterFieldsWereSaved_ReportsTheSavedFields_AndOtherItemsStillRun()
    {
        var handler = HandlerFor(1, 2)
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.UnprocessableEntity);

        var text = await Tools(handler).UpdateTasks(
        [
            new TaskUpdate { Id = 1, Priority = "low", Project = "Alpha" },
            new TaskUpdate { Id = 2, Priority = "low" },
        ]);

        var lines = text.Split('\n');
        lines[0].Should().Be("Updated 1 of 2 task(s).");
        lines[1].Should().StartWith("x #1: Task #1's fields were saved (priority)")
            .And.Contain("assigning it to project 'Alpha' failed: Project is full.")
            .And.Contain("Retry only the project change: resend only that item with just id and project.");
        lines[2].Should().StartWith("+ #2 ");
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().HaveCount(1);
    }

    [Fact]
    public async Task UpdateTasks_ProjectLookupNetworkFailure_StopsTheBatch_WithNoPut()
    {
        var handler = HandlerFor(1, 2).Fail(HttpMethod.Get, "Projects", new HttpRequestException("refused"));

        var act = () => Tools(handler).UpdateTasks([new TaskUpdate { Id = 1, Priority = "low", Project = "Alpha" }, new TaskUpdate { Id = 2, Priority = "low" }]);

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().Contain("x #1: cannot reach the TaskFlow API").And.Contain("x #2: not attempted");
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/2").Should().BeEmpty();
    }

    [Fact]
    public async Task BlockGuidance_IsKeptOnAFailedItem()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing(5, status: "Draft"))
            .Put("TaskItems/5", new { code = "TASK_BLOCK_DRAFT_NOT_ALLOWED", message = "Draft tasks cannot be blocked." }, HttpStatusCode.UnprocessableEntity)
            .Get("TaskItems/6", Existing(6))
            .Put("TaskItems/6", Existing(6));

        var text = await Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, Status = "blocked" }, new TaskUpdate { Id = 6, Priority = "low" }]);

        text.Should().StartWith("Updated 1 of 2 task(s).").And.Contain("x #5: ").And.Contain("Only Todo or InProgress tasks can be blocked").And.NotContain("Only Todo tasks can be blocked");
    }

    [Theory]
    [InlineData("TASK_PLAN_HAS_OPEN_SUBTASKS", "Plan its subtasks instead, using update_task")]
    [InlineData("TASK_PLAN_COMPLETED_NOT_ALLOWED", "A completed task cannot be planned onto a different day")]
    public async Task JournalDateBatch_RefusedItemShowsGuidance_AndTheRestAreProcessed(string code, string guidance)
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing(5))
            .Put("TaskItems/5", new { code, message = "Refused." }, HttpStatusCode.UnprocessableEntity)
            .Get("TaskItems/6", Existing(6))
            .Put("TaskItems/6", Existing(6));

        var text = await Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, JournalDate = "tomorrow" }, new TaskUpdate { Id = 6, JournalDate = "tomorrow" }]);

        text.Should().StartWith("Updated 1 of 2 task(s).").And.Contain($"x #5: Refused. [{code}]").And.Contain(guidance).And.Contain("+ #6 ");
        handler.Sent(HttpMethod.Put, "TaskItems/6").Should().HaveCount(1);
    }

    [Theory]
    [InlineData("TASK_PARENT_COMPLETED_NOT_ALLOWED", "Reopen the parent first")]
    [InlineData("TASK_PARENT_STATUS_DERIVED", "Change the status of its subtasks")]
    public async Task ParentRuleBatch_RefusedItemShowsGuidance_AndTheRestContinue(string code, string guidance)
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing(5, status: "Completed"))
            .Put("TaskItems/5", new { code, message = "Refused." }, HttpStatusCode.UnprocessableEntity)
            .Get("TaskItems/6", Existing(6))
            .Put("TaskItems/6", Existing(6));

        var text = await Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, Complete = false }, new TaskUpdate { Id = 6, Priority = "low" }]);

        text.Should().StartWith("Updated 1 of 2 task(s).").And.Contain($"x #5: Refused. [{code}]").And.Contain(guidance).And.Contain("+ #6 ");
    }

    [Fact]
    public async Task MixedOutcomes_StartRejectedLocally_OthersStillUpdated()
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Existing(5, status: "Draft"))
            .Get("TaskItems/6", Existing(6))
            .Put("TaskItems/6", Fixtures.Task(6, "Original", status: "InProgress"));

        var text = await Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, Status = "inprogress" }, new TaskUpdate { Id = 6, Status = "INPROGRESS" }]);

        text.Should().StartWith("Updated 1 of 2 task(s).").And.Contain("x #5: Task #5 is Draft, so it can't be started.").And.Contain("+ #6 ");
        handler.Sent(HttpMethod.Put, "TaskItems/5").Should().BeEmpty();
        handler.BodyOf(HttpMethod.Put, "TaskItems/6").GetProperty("status").GetString().Should().Be("inprogress");
        handler.AssertNoIsComplete("TaskItems/6");
    }

    [Fact]
    public async Task AllStartsRejected_Throws_WithoutAnyPut()
    {
        var handler = new StubHandler().Get("TaskItems/5", Existing(5, status: "Draft"));

        var act = () => Tools(handler).UpdateTasks([new TaskUpdate { Id = 5, Status = "inprogress" }]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().StartWith("Updated 0 of 1 task(s).").And.Contain("x #5: ");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task AllItemsFailing_Throws_WithTheReport()
    {
        var handler = new StubHandler();

        var act = () => Tools(handler).UpdateTasks([new TaskUpdate { Id = 1 }, new TaskUpdate { Id = 2 }]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().StartWith("Updated 0 of 2 task(s).").And.Contain("x #1: ").And.Contain("x #2: ");
    }

    [Fact]
    public async Task EmptyBatch_IsRejected() =>
        await FluentActions.Awaiting(() => Tools(new StubHandler()).UpdateTasks([])).Should().ThrowAsync<McpException>().WithMessage("*at least one*");

    [Fact]
    public async Task OversizedBatch_IsRejected_BeforeAnyRequest()
    {
        var handler = new StubHandler();

        var act = () => Tools(handler).UpdateTasks(Enumerable.Range(1, 26).Select(i => new TaskUpdate { Id = i }).ToList());

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("26").And.Contain("at most 25");
        handler.Requests.Should().BeEmpty();
    }

    [Fact]
    public async Task DuplicateIds_AreRejected_BeforeAnyRequest()
    {
        var handler = HandlerFor(7, 8);

        var act = () => Tools(handler).UpdateTasks([new TaskUpdate { Id = 7, Priority = "low" }, new TaskUpdate { Id = 8 }, new TaskUpdate { Id = 7, Status = "draft" }]);

        (await act.Should().ThrowAsync<McpException>()).Which.Message.Should().Contain("Task id 7 appears twice");
        handler.Requests.Should().BeEmpty();
    }

    [Fact]
    public async Task Timeout_OnOneItem_ReportsItShortly_AndStopsTheRest()
    {
        var handler = HandlerFor(4)
            .Get("TaskItems/5", Existing(5))
            .Fail(HttpMethod.Put, "TaskItems/5", new TaskCanceledException("timeout"));

        var text = await Tools(handler).UpdateTasks(
        [
            new TaskUpdate { Id = 4, Priority = "low" },
            new TaskUpdate { Id = 5, Priority = "low" },
            new TaskUpdate { Id = 6, Priority = "low" },
            new TaskUpdate { Id = 7, Priority = "low" },
        ]);

        var lines = text.Split('\n');
        lines[0].Should().Be("Updated 1 of 4 task(s).");
        lines[2].Should().Be("x #5: request timed out");
        lines[3].Should().Be("x #6: not attempted");
        lines[4].Should().Be("x #7: not attempted");
        handler.Requests.Should().NotContain(r => r.Path == "TaskItems/6" || r.Path == "TaskItems/7");
    }

    [Fact]
    public async Task UnreachableApi_ThrowsWithShortReasons_AndNoLongDockerText()
    {
        var handler = new StubHandler { Throw = new HttpRequestException("refused") };

        var act = () => Tools(handler).UpdateTasks([new TaskUpdate { Id = 1 }, new TaskUpdate { Id = 2 }]);

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().Contain("x #1: cannot reach the TaskFlow API").And.Contain("x #2: not attempted").And.NotContain("docker");
    }

    [Fact]
    public async Task PreCancelledToken_Propagates_AndNoItemIsSent()
    {
        var handler = HandlerFor(1, 2);
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        var act = () => Tools(handler).UpdateTasks([new TaskUpdate { Id = 1, Priority = "low" }, new TaskUpdate { Id = 2, Priority = "low" }], cts.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
        handler.Sent(HttpMethod.Put, "TaskItems/2").Should().BeEmpty();
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().BeEmpty();
    }

    [Fact]
    public async Task ExactlyTheBatchLimit_IsAccepted()
    {
        var handler = HandlerFor(Enumerable.Range(1, 25).ToArray());

        var text = await Tools(handler).UpdateTasks(Enumerable.Range(1, 25).Select(i => new TaskUpdate { Id = i, Priority = "low" }).ToList());

        text.Should().StartWith("Updated 25 of 25 task(s).");
    }

    [Fact]
    public async Task BlockWithReasonAndParent_SendsTheSameRequestAsUpdateTask()
    {
        var single = HandlerFor(5);
        await Tools(single).UpdateTask(5, status: "blocked", blockedReason: "Waiting on legal", parentTaskId: 9, title: "Renamed", description: "");
        var batch = HandlerFor(5);

        await Tools(batch).UpdateTasks([new TaskUpdate { Id = 5, Status = "blocked", BlockedReason = "Waiting on legal", ParentTaskId = 9, Title = "Renamed", Description = "" }]);

        batch.Sent(HttpMethod.Put, "TaskItems/5").Last().Body.Should().Be(single.Sent(HttpMethod.Put, "TaskItems/5").Last().Body);
    }

    [Fact]
    public async Task ValidationFailureOnOneItem_DoesNotStopTheOthers()
    {
        var handler = HandlerFor(1, 2);

        var text = await Tools(handler).UpdateTasks([new TaskUpdate { Id = 1, Priority = "urgent" }, new TaskUpdate { Id = 2, Priority = "low" }]);

        text.Should().StartWith("Updated 1 of 2 task(s).").And.Contain("x #1: ").And.Contain("+ #2 ");
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().BeEmpty();
    }

    private static object Planned(int id, string? plannedOn) =>
        Fixtures.Task(id, $"Task {id}", priority: "High", due: "2026-10-12", description: "Keep me", plannedOn: plannedOn);

    [Fact]
    public async Task UpdateTasks_JournalDate_ReportsPlannedOnlyWhereTheDayChanged()
    {
        var handler = new StubHandler()
            .Get("TaskItems/1", Planned(1, null)).Put("TaskItems/1", Planned(1, "2026-10-10"))
            .Get("TaskItems/2", Planned(2, "2026-10-10")).Put("TaskItems/2", Planned(2, "2026-10-10"));

        var text = await Tools(handler).UpdateTasks(
            [new TaskUpdate { Id = 1, JournalDate = "tomorrow" }, new TaskUpdate { Id = 2, JournalDate = "2026-10-10" }],
            TestContext.Current.CancellationToken);

        var lines = text.Split('\n');
        lines[1].Should().Be("+ #1 \"Task 1\": Changed planned 2026-10-10");
        lines[2].Should().Be("+ #2 \"Task 2\": No changes needed");
        handler.BodyOf(HttpMethod.Put, "TaskItems/1").GetProperty("journalDate").GetString().Should().Be("2026-10-10");
    }

    [Fact]
    public async Task UpdateTasks_JournalDate_PastDayFailure_IsReportedOnThatItemOnly()
    {
        var handler = new StubHandler()
            .Get("TaskItems/1", Planned(1, null))
            .On(HttpMethod.Put, "TaskItems/1", new { code = "TASK_CREATION_PAST_DAY_NOT_ALLOWED", message = "Tasks cannot be planned on a past day." }, HttpStatusCode.UnprocessableEntity)
            .Get("TaskItems/2", Planned(2, null)).Put("TaskItems/2", Planned(2, "2026-10-09"));

        var text = await Tools(handler).UpdateTasks(
            [new TaskUpdate { Id = 1, JournalDate = "2026-10-01" }, new TaskUpdate { Id = 2, JournalDate = "today" }],
            TestContext.Current.CancellationToken);

        var lines = text.Split('\n');
        lines[0].Should().Be("Updated 1 of 2 task(s).");
        lines[1].Should().StartWith("x #1: ").And.Contain("today or later");
        lines[2].Should().Be("+ #2 \"Task 2\": Changed planned 2026-10-09");
        lines.Should().HaveCount(3);
    }

    [Fact]
    public async Task UpdateTasks_JournalDate_YesterdayIsRejectedLocally_ForThatItemOnly()
    {
        var handler = new StubHandler()
            .Get("TaskItems/1", Planned(1, null)).Put("TaskItems/1", Planned(1, null))
            .Get("TaskItems/2", Planned(2, null)).Put("TaskItems/2", Planned(2, "2026-10-09"));

        var text = await Tools(handler).UpdateTasks(
            [new TaskUpdate { Id = 1, JournalDate = "yesterday" }, new TaskUpdate { Id = 2, JournalDate = "today" }],
            TestContext.Current.CancellationToken);

        text.Should().Contain("x #1: journalDate 'yesterday' is not valid").And.Contain("+ #2 ");
        handler.Sent(HttpMethod.Put, "TaskItems/1").Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateTasks_JournalDate_TakesOneClockSnapshot_ForTheWholeBatch()
    {
        var handler = new StubHandler()
            .Get("TaskItems/1", Planned(1, null)).Put("TaskItems/1", Planned(1, "2026-10-09"))
            .Get("TaskItems/2", Planned(2, null)).Put("TaskItems/2", Planned(2, "2026-10-10"));
        var clock = new CountingTimeProvider();
        var tools = new TaskTools(Fixtures.Client(handler), clock);

        await tools.UpdateTasks(
            [new TaskUpdate { Id = 1, JournalDate = "today" }, new TaskUpdate { Id = 2, JournalDate = "tomorrow" }],
            TestContext.Current.CancellationToken);

        clock.UtcReads.Should().Be(1);
    }

    [Fact]
    public async Task UpdateTasks_JournalDate_ProjectFailureAfterPlanning_UsesThePartialSuccessText()
    {
        var handler = new StubHandler()
            .Get("TaskItems/1", Planned(1, null)).Put("TaskItems/1", Planned(1, "2026-10-10"))
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.BadRequest);

        var act = () => Tools(handler).UpdateTasks(
            [new TaskUpdate { Id = 1, JournalDate = "tomorrow", Project = "Alpha" }],
            TestContext.Current.CancellationToken);

        (await act.Should().ThrowAsync<McpException>()).Which.Message
            .Should().Contain("x #1: Task #1 was updated and planned for 2026-10-10, but assigning it to project 'Alpha' failed: Project is full.");
    }
}
