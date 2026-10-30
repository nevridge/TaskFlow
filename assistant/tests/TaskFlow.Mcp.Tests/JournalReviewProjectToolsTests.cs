using System.Net;
using FluentAssertions;
using ModelContextProtocol;
using TaskFlow.Mcp.Api;
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
            .Get("JournalEntries/3/notes", new[] { new { id = 1, content = "Remember the demo", createdAt = "2026-10-09T15:00:00Z" } })
            .Get("TaskItems", Array.Empty<object>());

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Journal 2026-10-09 (entry #3) - today")
            .And.Contain("Summary: Busy day")
            .And.Contain("Planned tasks (1):").And.Contain("#5 [High/Todo] Spec")
            .And.Contain("09:30 Kicked off the spec [task #5]")
            .And.Contain("Remember the demo");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Post);
    }

    [Fact]
    public async Task GetJournal_PlannedBlockedTask_ShowsReasonAndDuration()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("JournalEntries/3/todos", new[]
            {
                Fixtures.Task(5, "Spec", status: "Blocked", priority: "High", blockedReason: "On vendor", blockedAt: "2026-10-05T10:00:00Z"),
                Fixtures.Task(6, "Plain"),
            })
            .Get("JournalEntries/3/notes", Array.Empty<object>())
            .Get("TaskItems", Array.Empty<object>());

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("#5 [High/Blocked] Spec | blocked: On vendor (4d)").And.Contain("#6 [Low/Todo] Plain");
        text.Should().NotContain("#6 [Low/Todo] Plain |");
    }

    [Fact]
    public async Task GetJournal_CreatesTheEntry_WhenMissing()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(8, "2026-10-09"), HttpStatusCode.Created)
            .Get("JournalEntries/8/todos", Array.Empty<object>())
            .Get("JournalEntries/8/notes", Array.Empty<object>())
            .Get("TaskItems", Array.Empty<object>());

        var text = await Tools(handler).GetJournal();

        var body = handler.BodyOf(HttpMethod.Post, "JournalEntries");
        body.GetProperty("date").GetString().Should().Be("2026-10-09");
        body.GetProperty("title").GetString().Should().Be("Journal 10-09-2026");
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
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
            .Get("JournalEntries/9/notes", Array.Empty<object>())
            .Get("TaskItems", Array.Empty<object>());

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("entry #9");
        handler.Sent(HttpMethod.Get, "JournalEntries").Should().HaveCount(2);
        handler.BodyOf(HttpMethod.Post, "JournalEntries").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
    }

    [Fact]
    public async Task EnsureAsync_Rethrows_WhenConflictIsFollowedByAnEmptyFind()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", new { message = "exists" }, HttpStatusCode.Conflict);

        var act = () => JournalResolver.EnsureAsync(Fixtures.Client(handler), Fixtures.Today, -420, CancellationToken.None);

        (await act.Should().ThrowAsync<TaskFlowApiException>()).Which.Status.Should().Be(HttpStatusCode.Conflict);
    }

    [Theory]
    [InlineData("tomorrow", "2026-10-10")]
    [InlineData("yesterday", "2026-10-08")]
    public async Task GetJournal_CreatesOtherDays_WithTheSameOffset(string date, string expected)
    {
        var handler = EmptyJournalStub();

        await Tools(handler).GetJournal(date);

        var body = handler.BodyOf(HttpMethod.Post, "JournalEntries");
        body.GetProperty("date").GetString().Should().Be(expected);
        body.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
    }

    [Fact]
    public async Task SetJournalTodos_CreatesTheEntryAndAddsTheTodo_WithTheSameOffset()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(8, "2026-10-09"), HttpStatusCode.Created)
            .Get("TaskItems", new[] { Fixtures.Task(1, "Planned") })
            .Post("JournalEntries/8/todos", status: HttpStatusCode.NoContent);

        await Tools(handler).SetJournalTodos(add: [1]);

        handler.BodyOf(HttpMethod.Post, "JournalEntries").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        handler.BodyOf(HttpMethod.Post, "JournalEntries/8/todos").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
    }

    [Fact]
    public async Task AddLogEntry_CreatesAMissingEntry_WithTheOffset()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(8, "2026-10-09"), HttpStatusCode.Created)
            .Post("JournalEntries/8/logs", new { id = 1, content = "Did it", journalEntryId = 8, createdAt = "2026-10-09T16:30:00Z" });

        await Tools(handler).AddLogEntry("Did it");

        handler.BodyOf(HttpMethod.Post, "JournalEntries").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
    }

    [Fact]
    public async Task UpdateJournal_CreatesAMissingEntry_WithTheOffset()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(8, "2026-10-09"), HttpStatusCode.Created)
            .Post("JournalEntries/8/notes", new { id = 1, content = "A note", createdAt = "2026-10-09T16:30:00Z" });

        await Tools(handler).UpdateJournal(note: "A note");

        handler.BodyOf(HttpMethod.Post, "JournalEntries").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
    }

    [Fact]
    public async Task GetJournal_NearUtcMidnight_SendsTheOffsetForLocalTodayAndTomorrow()
    {
        var handler = EmptyJournalStub();
        var tools = new JournalTools(Fixtures.Client(handler), Fixtures.Time(new DateTimeOffset(2026, 10, 10, 2, 0, 0, TimeSpan.Zero), -300));

        await tools.GetJournal("today");
        var today = handler.BodyOf(HttpMethod.Post, "JournalEntries");
        await tools.GetJournal("tomorrow");
        var tomorrow = handler.BodyOf(HttpMethod.Post, "JournalEntries");

        today.GetProperty("date").GetString().Should().Be("2026-10-09");
        today.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-300);
        tomorrow.GetProperty("date").GetString().Should().Be("2026-10-10");
        tomorrow.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-300);
    }

    [Theory]
    [InlineData(330)]
    [InlineData(345)]
    [InlineData(-570)]
    [InlineData(-300)]
    [InlineData(-420)]
    [InlineData(-720)]
    [InlineData(840)]
    public async Task GetJournal_SendsTheLocalOffset_ForDifferentZones(int offsetMinutes)
    {
        var handler = EmptyJournalStub();
        var tools = new JournalTools(Fixtures.Client(handler), Fixtures.Time(new DateTimeOffset(2026, 10, 9, 17, 0, 0, TimeSpan.Zero), offsetMinutes));

        await tools.GetJournal();

        handler.BodyOf(HttpMethod.Post, "JournalEntries").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(offsetMinutes);
    }

    [Fact]
    public async Task GetJournal_RereadsTheOffsetPerCall_AcrossADaylightSavingChange()
    {
        var rule = TimeZoneInfo.AdjustmentRule.CreateAdjustmentRule(
            new DateTime(2026, 1, 1),
            new DateTime(2026, 12, 31),
            TimeSpan.FromHours(1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 2, 0, 0), 3, 8),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 2, 0, 0), 11, 1));
        var zone = TimeZoneInfo.CreateCustomTimeZone("dst", TimeSpan.FromHours(-8), "dst", "std", "day", [rule]);
        var clock = Fixtures.Time();
        clock.SetLocalTimeZone(zone);
        var handler = EmptyJournalStub();
        var tools = new JournalTools(Fixtures.Client(handler), clock);

        await tools.GetJournal();
        var before = handler.BodyOf(HttpMethod.Post, "JournalEntries");
        clock.Advance(TimeSpan.FromDays(30));
        await tools.GetJournal();
        var after = handler.BodyOf(HttpMethod.Post, "JournalEntries");

        before.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        after.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-480);
    }

    [Fact]
    public async Task SetJournalTodos_CreatesANonTodayEntry_WithItsDateAndTheSameOffset()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(8, "2026-10-10"), HttpStatusCode.Created)
            .Get("TaskItems", new[] { Fixtures.Task(1, "Planned") })
            .Post("JournalEntries/8/todos", status: HttpStatusCode.NoContent);

        await Tools(handler).SetJournalTodos(add: [1], date: "tomorrow");

        var entry = handler.BodyOf(HttpMethod.Post, "JournalEntries");
        entry.GetProperty("date").GetString().Should().Be("2026-10-10");
        entry.GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
        handler.BodyOf(HttpMethod.Post, "JournalEntries/8/todos").GetProperty("timezoneOffsetMinutes").GetInt32().Should().Be(-420);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task JournalTools_ReadTheClockOnce_PerToolCall(bool entryExists)
    {
        var handler = new StubHandler()
            .Get("JournalEntries", entryExists ? new object[] { Fixtures.Journal(3, "2026-10-09") } : Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(3, "2026-10-09"), HttpStatusCode.Created)
            .Get("JournalEntries/3/todos", Array.Empty<object>())
            .Get("JournalEntries/3/notes", Array.Empty<object>())
            .Get("TaskItems", new[] { Fixtures.Task(1, "Planned") })
            .Post("JournalEntries/3/todos", status: HttpStatusCode.NoContent)
            .Post("JournalEntries/3/logs", new { id = 1, content = "x", journalEntryId = 3, createdAt = "2026-10-09T16:30:00Z" })
            .Post("JournalEntries/3/notes", new { id = 1, content = "n", createdAt = "2026-10-09T16:30:00Z" });
        var clock = new CountingTimeProvider();
        var tools = new JournalTools(Fixtures.Client(handler), clock);
        var calls = new Func<Task>[]
        {
            () => tools.GetJournal(),
            () => tools.SetJournalTodos(add: [1]),
            () => tools.AddLogEntry("x"),
            () => tools.UpdateJournal(note: "n"),
        };

        foreach (var call in calls)
        {
            clock.UtcReads = 0;
            await call();

            clock.UtcReads.Should().Be(1);
        }
    }

    private static StubHandler JournalWith(object[] todos, object[] allTasks, string date = "2026-10-09") => new StubHandler()
        .Get("JournalEntries", new[] { Fixtures.Journal(3, date) })
        .Get("JournalEntries/3/todos", todos)
        .Get("JournalEntries/3/notes", Array.Empty<object>())
        .Get("TaskItems", allTasks);

    [Fact]
    public async Task GetJournal_ConciseParentWithOpenSubtasks_ListsThemUnderTheParentWithoutCount()
    {
        var handler = JournalWith(
            [Fixtures.Task(5, "Ship", priority: "High", childTaskCount: 2)],
            [Fixtures.Task(5, "Ship", priority: "High", childTaskCount: 2), Fixtures.Task(12, "Changelog", parentId: 5), Fixtures.Task(14, "Tag", status: "Blocked", parentId: 5, blockedReason: "CI")]);

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("#5 [High/Todo] Ship").And.Contain("    Open subtasks (2):")
            .And.Contain("      - #12 [Todo] Changelog")
            .And.Contain("      - #14 [Blocked] Tag")
            .And.NotContain("subtask(s)").And.NotContain("CI");
    }

    [Fact]
    public async Task GetJournal_DetailedParentWithOpenSubtasks_ListsThemAndDropsTheCount()
    {
        var handler = JournalWith(
            [Fixtures.Task(5, "Ship", childTaskCount: 1)],
            [Fixtures.Task(5, "Ship", childTaskCount: 1), Fixtures.Task(12, "Changelog", parentId: 5)]);

        var text = await Tools(handler).GetJournal(responseFormat: "detailed");

        text.Should().Contain("Open subtasks (1):").And.Contain("      - #12 [Todo] Changelog").And.NotContain("subtask(s)");
    }

    [Fact]
    public async Task GetJournal_ParentWithNoSubtasks_HasNoSubtaskSection()
    {
        var handler = JournalWith([Fixtures.Task(5, "Ship")], [Fixtures.Task(5, "Ship")]);

        var text = await Tools(handler).GetJournal();

        text.Should().NotContain("Open subtasks").And.NotContain("subtask(s)");
    }

    [Fact]
    public async Task GetJournal_ParentWithOnlyClosedSubtasks_HasNoSectionAndNoCount()
    {
        var handler = JournalWith(
            [Fixtures.Task(5, "Ship", childTaskCount: 2)],
            [Fixtures.Task(5, "Ship", childTaskCount: 2), Fixtures.Task(12, "Done", status: "Completed", parentId: 5), Fixtures.Task(13, "Done2", isComplete: true, parentId: 5)]);

        var text = await Tools(handler).GetJournal(responseFormat: "detailed");

        text.Should().NotContain("Open subtasks").And.NotContain("subtask(s)").And.NotContain("Done");
    }

    [Fact]
    public async Task GetJournal_MixedOpenAndClosedSubtasks_ShowsOnlyOpenOrderedByUrgency()
    {
        var handler = JournalWith(
            [Fixtures.Task(5, "Ship")],
            [
                Fixtures.Task(21, "Low late", parentId: 5, priority: "Low"),
                Fixtures.Task(22, "Closed", status: "Completed", parentId: 5, priority: "High"),
                Fixtures.Task(23, "High", parentId: 5, priority: "High", due: "2026-11-02"),
                Fixtures.Task(24, "High sooner", parentId: 5, priority: "High", due: "2026-11-01"),
                Fixtures.Task(5, "Ship"),
            ]);

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Open subtasks (3):").And.NotContain("Closed");
        text.IndexOf("#24 [Todo]", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("#23 [Todo]", StringComparison.Ordinal));
        text.IndexOf("#23 [Todo]", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("#21 [Todo]", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GetJournal_SubtaskPlannedSameDay_AppearsTopLevelAndNestedWithMarker()
    {
        var parent = Fixtures.Task(5, "Ship", priority: "High");
        var sub = Fixtures.Task(14, "Tag", parentId: 5, priority: "Medium");
        var handler = JournalWith([parent, sub], [parent, sub]);

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Planned tasks (2):")
            .And.Contain("  #14 [Medium/Todo] Tag | subtask of #5")
            .And.Contain("      - #14 [Todo] Tag | planned today");
    }

    [Fact]
    public async Task GetJournal_SubtaskPlannedOnANonTodayDay_UsesPlannedThisDayMarker()
    {
        var parent = Fixtures.Task(5, "Ship");
        var sub = Fixtures.Task(14, "Tag", parentId: 5);
        var handler = JournalWith([parent, sub], [parent, sub], "2026-10-10");

        var text = await Tools(handler).GetJournal("tomorrow");

        text.Should().Contain("      - #14 [Todo] Tag | planned this day").And.NotContain("planned today");
    }

    [Fact]
    public async Task GetJournal_BlockedSubtask_ShowsReasonInDetailedOnly()
    {
        var parent = Fixtures.Task(5, "Ship");
        var sub = Fixtures.Task(14, "Tag", status: "Blocked", parentId: 5, blockedReason: "waiting on CI", blockedAt: "2026-10-07T10:00:00Z");
        var handler = JournalWith([parent], [parent, sub]);

        var concise = await Tools(handler).GetJournal();
        var detailed = await Tools(handler).GetJournal(responseFormat: "detailed");

        concise.Should().Contain("      - #14 [Blocked] Tag").And.NotContain("waiting on CI");
        detailed.Should().Contain("      - #14 [Blocked] Tag | blocked: waiting on CI (2d)");
    }

    [Fact]
    public async Task GetJournal_FetchesTaskItemsOnce_WithNoPerParentRequests()
    {
        var p1 = Fixtures.Task(5, "A");
        var p2 = Fixtures.Task(6, "B");
        var handler = JournalWith([p1, p2], [p1, p2, Fixtures.Task(12, "S1", parentId: 5), Fixtures.Task(13, "S2", parentId: 6)]);

        await Tools(handler).GetJournal();

        handler.Sent(HttpMethod.Get, "TaskItems").Should().ContainSingle();
        handler.Sent(HttpMethod.Get, "JournalEntries/3/todos").Should().ContainSingle();
        handler.Sent(HttpMethod.Get, "JournalEntries/3/notes").Should().ContainSingle();
        handler.Requests.Should().OnlyContain(r => r.Method == HttpMethod.Get && !r.Path.StartsWith("TaskItems/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GetJournal_SubtaskOfAnUnplannedParent_IsNotNested()
    {
        var handler = JournalWith(
            [Fixtures.Task(5, "Planned")],
            [Fixtures.Task(5, "Planned"), Fixtures.Task(99, "Other parent"), Fixtures.Task(12, "Orphan sub", parentId: 99)]);

        var text = await Tools(handler).GetJournal();

        text.Should().NotContain("Open subtasks").And.NotContain("Orphan sub");
    }

    [Fact]
    public async Task GetJournal_TaskItemsFails_ThrowsMcpException()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("JournalEntries/3/todos", Array.Empty<object>())
            .Get("JournalEntries/3/notes", Array.Empty<object>())
            .On(HttpMethod.Get, "TaskItems", status: HttpStatusCode.InternalServerError);

        var act = () => Tools(handler).GetJournal();

        await act.Should().ThrowAsync<McpException>();
    }

    [Fact]
    public async Task GetJournal_ChildCountDisagreesWithFoundChildren_RendersTheFoundList()
    {
        var handler = JournalWith(
            [Fixtures.Task(5, "Ship", childTaskCount: 3), Fixtures.Task(6, "Other", childTaskCount: 0)],
            [Fixtures.Task(5, "Ship", childTaskCount: 3), Fixtures.Task(6, "Other"), Fixtures.Task(12, "One", parentId: 5), Fixtures.Task(13, "A", parentId: 6), Fixtures.Task(14, "B", parentId: 6)]);

        var text = await Tools(handler).GetJournal(responseFormat: "detailed");

        text.Should().Contain("Open subtasks (1):").And.Contain("Open subtasks (2):").And.NotContain("subtask(s)");
    }

    [Fact]
    public async Task GetJournal_WithPlannedTasks_ReadsUtcNowOnceMoreThanWithNone()
    {
        var parent = Fixtures.Task(5, "Ship", status: "Blocked", blockedAt: "2026-10-07T10:00:00Z");
        var planned = JournalWith([parent, Fixtures.Task(6, "B"), Fixtures.Task(7, "C")], [parent, Fixtures.Task(12, "S", parentId: 5)]);
        var empty = JournalWith([], []);
        var plannedClock = new CountingTimeProvider();
        var emptyClock = new CountingTimeProvider();

        await new JournalTools(Fixtures.Client(planned), plannedClock).GetJournal();
        await new JournalTools(Fixtures.Client(empty), emptyClock).GetJournal();

        plannedClock.UtcReads.Should().Be(emptyClock.UtcReads + 1);
    }

    [Fact]
    public void Task_Detailed_ShowsSubtaskCountByDefault_AndShowChildCountFalseSuppressesIt()
    {
        var dto = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(
            System.Text.Json.JsonSerializer.Serialize(Fixtures.Task(5, "Ship", childTaskCount: 2), TaskFlowApiClient.Json), TaskFlowApiClient.Json)!;

        Formatting.Task(dto, Fixtures.Today, detailed: true).Should().Contain("2 subtask(s)");
        Formatting.Task(dto, Fixtures.Today, detailed: true, showChildCount: false).Should().NotContain("subtask(s)");
    }

    private static StubHandler EmptyJournalStub() => new StubHandler()
        .Get("JournalEntries", Array.Empty<object>())
        .Post("JournalEntries", Fixtures.Journal(8, "2026-10-09"), HttpStatusCode.Created)
        .Get("JournalEntries/8/todos", Array.Empty<object>())
        .Get("JournalEntries/8/notes", Array.Empty<object>())
        .Get("TaskItems", Array.Empty<object>());

    private sealed class CountingTimeProvider : TimeProvider
    {
        private readonly TimeZoneInfo _zone = TimeZoneInfo.CreateCustomTimeZone("test", TimeSpan.FromHours(-7), "test", "test");

        public int UtcReads { get; set; }

        public override TimeZoneInfo LocalTimeZone => _zone;

        public override DateTimeOffset GetUtcNow()
        {
            UtcReads++;
            return new DateTimeOffset(2026, 10, 9, 17, 0, 0, TimeSpan.Zero);
        }
    }

    [Fact]
    public async Task GetJournal_AcceptsOtherDates_AndRejectsGarbage()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(2, "2026-10-08") })
            .Get("JournalEntries/2/todos", Array.Empty<object>())
            .Get("JournalEntries/2/notes", Array.Empty<object>())
            .Get("TaskItems", Array.Empty<object>());
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
    public async Task ProjectStatus_ListsBlockedSeparately_CountsThemOpen_AndDoesNotStallThem()
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(1, "Alpha") })
            .Get("TaskItems", new[]
            {
                Fixtures.Task(1, "Waiting", status: "Blocked", priority: "High", moveCount: 5, projectId: 1, projectName: "Alpha", blockedReason: "On vendor", blockedAt: "2026-10-05T10:00:00Z"),
                Fixtures.Task(2, "No reason", status: "Blocked", projectId: 1, projectName: "Alpha", blockedAt: "2026-10-09T10:00:00Z"),
                Fixtures.Task(3, "Open", projectId: 1, projectName: "Alpha"),
                Fixtures.Task(4, "Done 1", status: "Completed", isComplete: true, projectId: 1),
                Fixtures.Task(5, "Done 2", status: "Completed", isComplete: true, projectId: 1),
                Fixtures.Task(6, "Done 3", status: "Completed", isComplete: true, projectId: 1),
            });

        var text = await Tools(handler).ProjectStatus("Alpha");

        text.Should().Contain("Project Alpha (#1): 3 open (2 blocked) / 3 done")
            .And.Contain("Blocked (2):")
            .And.Contain("#1 [High/Blocked] Waiting | blocked: On vendor (4d)")
            .And.Contain("#2 [Low/Blocked] No reason | blocked (<1d)")
            .And.NotContain("Stalled")
            .And.Contain("Most urgent open (3):");
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

    private static StubHandler ReviewHandler(object[] tasks, object[]? projects = null)
    {
        return new StubHandler()
            .Get("TaskItems", tasks)
            .Get("Projects", projects ?? [])
            .Get("JournalEntries", Array.Empty<object>());
    }

    [Fact]
    public async Task BlockedGroup_ListsCurrentlyBlocked_WithReasonDuration_AndOverdueInBoth()
    {
        var handler = ReviewHandler(
            [
                Fixtures.Task(1, "Waiting", status: "Blocked", priority: "High", due: "2026-10-01", projectId: 7, projectName: "Alpha", blockedReason: "On vendor", blockedAt: "2026-10-05T10:00:00Z"),
                Fixtures.Task(2, "Stuck blocked", status: "Blocked", moveCount: 6, blockedAt: "2026-10-09T10:00:00Z"),
                Fixtures.Task(3, "Plain"),
            ],
            [Fixtures.Project(7, "Alpha", open: 1, done: 0, blockedCount: 1)])
            .Get("TaskItems/1/history", Array.Empty<object>())
            .Get("TaskItems/2/history", Array.Empty<object>())
            .Get("TaskItems/3/history", Array.Empty<object>());
        var tools = new ReviewTools(Fixtures.Client(handler), Fixtures.Time());

        var text = await tools.WeeklyReview();

        text.Should().Contain("Blocked:").And.Contain("#2 [Low/Blocked] Stuck blocked | blocked (<1d)");
        System.Text.RegularExpressions.Regex.Matches(text, @"#1 \[High/Blocked\] Waiting \| blocked: On vendor \(4d\)").Should().HaveCount(2, "in Blocked and Overdue");
        text.IndexOf("Blocked:", StringComparison.Ordinal).Should().BeLessThan(text.IndexOf("Overdue:", StringComparison.Ordinal));
        text.Should().NotContain("Stalled (", "blocked tasks are not shown as stalled");
        text.Should().Contain("Open now: 3 (overdue 1, stalled 0)").And.Contain("Alpha: 1 open (1 blocked) / 0 done");
    }

    [Fact]
    public async Task BlockedGroup_IsOmitted_WhenNothingIsBlocked()
    {
        var handler = ReviewHandler([Fixtures.Task(1, "Plain")]).Get("TaskItems/1/history", Array.Empty<object>());
        var tools = new ReviewTools(Fixtures.Client(handler), Fixtures.Time());

        (await tools.WeeklyReview()).Should().NotContain("Blocked");
    }

    [Fact]
    public async Task BlockedGroup_StillListsTasksBeyondTheHistoryLookupCap()
    {
        var tasks = Enumerable.Range(1, 305)
            .Select(i => i == 1
                ? Fixtures.Task(1, "Old blocked", status: "Blocked", blockedReason: "Waiting", blockedAt: "2026-10-05T10:00:00Z")
                : Fixtures.Task(i, $"T{i}"))
            .ToArray();
        var handler = ReviewHandler(tasks);
        for (var i = 6; i <= 305; i++)
        {
            handler.Get($"TaskItems/{i}/history", Array.Empty<object>());
        }

        var text = await new ReviewTools(Fixtures.Client(handler), Fixtures.Time()).WeeklyReview();

        text.Should().Contain("Blocked:").And.Contain("#1 [Low/Blocked] Old blocked | blocked: Waiting (4d)").And.Contain("most recent of 305 tasks");
    }

    [Fact]
    public async Task InvertedRange_IsRejected()
    {
        var tools = new ReviewTools(Fixtures.Client(new StubHandler()), Fixtures.Time());

        await FluentActions.Awaiting(() => tools.WeeklyReview(from: "2026-10-09", to: "2026-10-01"))
            .Should().ThrowAsync<McpException>().WithMessage("*after 'to'*");
    }
}
