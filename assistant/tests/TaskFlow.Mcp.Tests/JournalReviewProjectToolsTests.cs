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
            .Get("TaskItems", new[] { Fixtures.Task(5, "Spec", priority: "High", projectId: 7, projectName: "Apollo") });

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Journal 2026-10-09 (entry #3) - today")
            .And.Contain("Summary: Busy day")
            .And.Contain("Planned tasks (1):").And.Contain("#5 [High/Todo] Spec")
            .And.Contain("09:30 Kicked off the spec [task #5 | Apollo | High]")
            .And.Contain("Remember the demo");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Post);
    }

    private static object LinkedLog(int id, int? taskId, bool deleted = false) =>
        new { id, content = "Did work", journalEntryId = 3, createdAt = "2026-10-09T16:30:00Z", taskItemId = taskId, linkedTaskTitle = "T", linkedTaskDeleted = deleted };

    private static StubHandler LogHandler(object[] logs, Action<StubHandler>? tasks = null)
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09", null, logs) })
            .Get("JournalEntries/3/todos", Array.Empty<object>())
            .Get("JournalEntries/3/notes", Array.Empty<object>());
        tasks?.Invoke(handler);
        return handler;
    }

    [Fact]
    public async Task GetJournal_LinkedTaskWithoutProject_OmitsProjectSegment()
    {
        var handler = LogHandler([LinkedLog(1, 5)], h => h.Get("TaskItems", new[] { Fixtures.Task(5, "Spec", priority: "High") }));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #5 | High]");
    }

    [Fact]
    public async Task GetJournal_LinkedTaskNotInList_ShowsBareTaskId()
    {
        var handler = LogHandler([LinkedLog(1, 99)], h => h.Get("TaskItems", new[] { Fixtures.Task(5, "Spec") }));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #99]").And.NotContain("Note: task details unavailable");
    }

    [Fact]
    public async Task GetJournal_DeletedLink_KeepsDeletedMarkerEvenWhenIdIsInList()
    {
        var handler = LogHandler([LinkedLog(1, 5, deleted: true)], h => h.Get("TaskItems", new[] { Fixtures.Task(5, "Spec", projectName: "Apollo") }));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #5, deleted]").And.NotContain("Apollo");
    }

    [Fact]
    public async Task GetJournal_LogWithoutLinkedTask_IsUnchanged()
    {
        var handler = LogHandler([LinkedLog(1, null)], h => h.Get("TaskItems", new[] { Fixtures.Task(5, "Spec") }));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("09:30 Did work").And.NotContain("[task");
    }

    [Fact]
    public async Task GetJournal_LinkedLogs_MakeNoExtraTaskRequests()
    {
        var handler = LogHandler([LinkedLog(1, 5), LinkedLog(2, 6)], h => h.Get("TaskItems", new[] { Fixtures.Task(5, "A"), Fixtures.Task(6, "B") }));

        await Tools(handler).GetJournal();

        handler.Requests.Count(r => r.Path.StartsWith("TaskItems", StringComparison.Ordinal)).Should().Be(1);
    }

    [Fact]
    public async Task GetJournal_TaskItemsFails_LinkedLinesAreBareAndJournalStillReturns()
    {
        var handler = LogHandler([LinkedLog(1, 5)], h => h.On(HttpMethod.Get, "TaskItems", status: HttpStatusCode.InternalServerError));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #5]").And.Contain("Log (1):").And.Contain("Note: task details unavailable for linked log lines (");
    }

    [Fact]
    public async Task GetJournal_TaskItemsTimesOut_LinkedLinesAreBare()
    {
        var handler = LogHandler([LinkedLog(1, 5)], h => h.Fail(HttpMethod.Get, "TaskItems", new TaskCanceledException("timeout")));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #5]");
    }

    [Fact]
    public async Task GetJournal_TaskItemsBadJson_LinkedLinesAreBare()
    {
        var handler = LogHandler([LinkedLog(1, 5)], h => h.Get("TaskItems", "not json"));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #5]");
    }

    [Fact]
    public async Task GetJournal_BlankProjectAndPriority_OmitsBothSegments()
    {
        var handler = LogHandler(
            [LinkedLog(1, 5), LinkedLog(2, 6)],
            h => h.Get("TaskItems", new[] { Fixtures.Task(5, "A", priority: "", projectName: "  "), Fixtures.Task(6, "B", priority: "", projectName: "Apollo") }));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #5]").And.Contain("Did work [task #6 | Apollo]");
    }

    [Fact]
    public async Task GetJournal_ProjectNameWithPipeAndBracket_IsRenderedVerbatim()
    {
        var handler = LogHandler([LinkedLog(1, 5)], h => h.Get("TaskItems", new[] { Fixtures.Task(5, "A", priority: "High", projectName: "R|D [x]") }));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Did work [task #5 | R|D [x] | High]");
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

    private static int LineOf(string[] lines, string startsWith) =>
        Array.FindIndex(lines, l => l.StartsWith(startsWith, StringComparison.Ordinal));

    [Fact]
    public void TaskItemDto_Deserializes_ParentTitleAndOpenChildCount_WhenPresent()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(Fixtures.Task(12, "Sub", parentId: 5, parentTitle: "Ship", openChildCount: 3), TaskFlowApiClient.Json);

        var dto = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(json, TaskFlowApiClient.Json)!;

        dto.ParentTitle.Should().Be("Ship");
        dto.OpenChildCount.Should().Be(3);
    }

    [Fact]
    public void TaskItemDto_Deserializes_WithDefaults_WhenFieldsAreAbsent()
    {
        const string json = """{"id":1,"title":"T","status":"Todo","priority":"Low","childTaskCount":0,"moveCount":0,"daysTagged":0}""";

        var dto = System.Text.Json.JsonSerializer.Deserialize<TaskItemDto>(json, TaskFlowApiClient.Json)!;

        dto.ParentTitle.Should().BeNull();
        dto.OpenChildCount.Should().Be(0);
    }

    [Fact]
    public async Task GetJournal_SubtaskWhoseParentIsNotARow_ShowsContextHeaderAndCountsOnlyTheSubtask()
    {
        var handler = JournalWith([Fixtures.Task(12, "Changelog", parentId: 5, parentTitle: "Ship")], []);

        var text = await Tools(handler).GetJournal();

        var lines = text.Split('\n');
        text.Should().Contain("Planned tasks (1):");
        var header = LineOf(lines, "  Context: #5 Ship (not counted)");
        header.Should().BeGreaterThan(0);
        lines[header + 1].Should().StartWith("    #12 [Low/Todo] Changelog");
    }

    [Fact]
    public async Task GetJournal_ParentRowWithOpenSubtaskRow_IsAnUncountedContextLine_AndNothingIsListedTwice()
    {
        var parent = Fixtures.Task(5, "Ship", priority: "High", childTaskCount: 1, openChildCount: 1);
        var sub = Fixtures.Task(14, "Tag", parentId: 5, parentTitle: "Ship", priority: "Medium");
        var handler = JournalWith([parent, sub], []);

        var text = await Tools(handler).GetJournal();

        var lines = text.Split('\n');
        text.Should().Contain("Planned tasks (1):");
        lines[LineOf(lines, "  Context: #5 Ship (not counted)") + 1].Should().StartWith("    #14 [Medium/Todo] Tag");
        text.Should().NotContain("#5 [High");
        lines.Count(l => l.Contains("#14", StringComparison.Ordinal)).Should().Be(1);
        lines.Count(l => l.Contains("#5 ", StringComparison.Ordinal)).Should().Be(1);
    }

    [Fact]
    public async Task GetJournal_CompletedOnlySubtaskUnderANonRowParent_IsANormalCountedRowWithNoHeader()
    {
        var handler = JournalWith([Fixtures.Task(12, "Done", status: "Completed", parentId: 5, parentTitle: "Ship")], []);

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Planned tasks (1):").And.Contain("  #12 [Low/Completed] Done").And.NotContain("Context");
    }

    [Fact]
    public async Task GetJournal_CompletedOnlySubtaskUnderARowParent_NestsUnderANormalCountedParent()
    {
        var handler = JournalWith(
            [Fixtures.Task(5, "Ship", childTaskCount: 1), Fixtures.Task(12, "Done", status: "Completed", parentId: 5, parentTitle: "Ship")],
            []);

        var text = await Tools(handler).GetJournal();

        var lines = text.Split('\n');
        text.Should().Contain("Planned tasks (2):").And.NotContain("Context");
        lines[LineOf(lines, "  #5 [Low/Todo] Ship") + 1].Should().StartWith("    #12 [Low/Completed] Done");
    }

    [Fact]
    public async Task GetJournal_SeveralSubtasksOfOneNonRowParent_ShareOneHeaderPlacedAtTheMostUrgentSubtask()
    {
        var handler = JournalWith(
            [
                Fixtures.Task(21, "Low late", parentId: 5, parentTitle: "Ship"),
                Fixtures.Task(23, "High sub", parentId: 5, parentTitle: "Ship", priority: "High", due: "2026-11-02"),
                Fixtures.Task(24, "Medium", priority: "Medium"),
                Fixtures.Task(30, "Urgent", priority: "High"),
            ],
            []);

        var text = await Tools(handler).GetJournal();

        var lines = text.Split('\n');
        text.Should().Contain("Planned tasks (4):");
        lines.Count(l => l.StartsWith("  Context:", StringComparison.Ordinal)).Should().Be(1);
        var order = new[] { "  Context: #5 Ship", "    #23 ", "    #21 ", "  #30 ", "  #24 " }.Select(p => LineOf(lines, p)).ToArray();
        order.Should().OnlyContain(i => i > 0).And.BeInAscendingOrder();
    }

    [Fact]
    public async Task GetJournal_MixedDay_CountEqualsTheCountedLines()
    {
        var handler = JournalWith(
            [
                Fixtures.Task(5, "Ship", priority: "High", openChildCount: 1),
                Fixtures.Task(14, "Tag", parentId: 5, parentTitle: "Ship"),
                Fixtures.Task(15, "Other sub", parentId: 8, parentTitle: "Other"),
                Fixtures.Task(16, "Done sub", status: "Completed", parentId: 9, parentTitle: "Third"),
                Fixtures.Task(20, "Plain"),
            ],
            []);

        var text = await Tools(handler).GetJournal();

        var taskLines = text.Split('\n').Count(l => System.Text.RegularExpressions.Regex.IsMatch(l, @"^\s+#\d+ \["));
        text.Should().Contain("Planned tasks (4):").And.Contain("  Context: #5 Ship (not counted)").And.Contain("  Context: #8 Other (not counted)");
        taskLines.Should().Be(4);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task GetJournal_BlankParentTitle_FallsBackToTheParentId(string? parentTitle)
    {
        var handler = JournalWith([Fixtures.Task(12, "Changelog", parentId: 5, parentTitle: parentTitle)], []);

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("  Context: #5 (not counted)");
    }

    [Fact]
    public async Task GetJournal_ParentWithOpenChildrenButNoSubtaskRowsThatDay_IsANormalRow()
    {
        var handler = JournalWith([Fixtures.Task(5, "Ship", childTaskCount: 2, openChildCount: 2)], []);

        var concise = await Tools(handler).GetJournal();
        var detailed = await Tools(handler).GetJournal(responseFormat: "detailed");

        concise.Should().Contain("Planned tasks (1):").And.Contain("  #5 [Low/Todo] Ship").And.NotContain("Context");
        detailed.Should().Contain("2 subtask(s)");
    }

    [Fact]
    public async Task GetJournal_TaskItemsFails_PlannedBlockIsUnaffected_AndOnlyTheLogLinkNoteIsAdded()
    {
        var logs = new[] { LinkedLog(1, 12) };
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09", null, logs) })
            .Get("JournalEntries/3/todos", new[] { Fixtures.Task(12, "Changelog", parentId: 5, parentTitle: "Ship") })
            .Get("JournalEntries/3/notes", Array.Empty<object>())
            .On(HttpMethod.Get, "TaskItems", status: HttpStatusCode.InternalServerError);

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Planned tasks (1):").And.Contain("  Context: #5 Ship (not counted)").And.Contain("    #12 [Low/Todo] Changelog")
            .And.Contain("Note: task details unavailable for linked log lines (")
            .And.NotContain("open subtasks could not be loaded");
        text.Split('\n').Count(l => l.StartsWith("Note:", StringComparison.Ordinal)).Should().Be(1);
    }

    [Fact]
    public async Task GetJournal_TaskItemsTimesOut_PlannedBlockIsUnaffected_AndThereIsNoNoteWithoutLinkedLogs()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("JournalEntries/3/todos", new[] { Fixtures.Task(5, "Ship") })
            .Get("JournalEntries/3/notes", Array.Empty<object>())
            .Fail(HttpMethod.Get, "TaskItems", new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout."));

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Planned tasks (1):").And.Contain("#5").And.NotContain("Note:");
    }

    [Fact]
    public async Task GetJournal_NoRows_SaysNone()
    {
        var handler = JournalWith([], []);

        var text = await Tools(handler).GetJournal();

        text.Should().Contain("Planned tasks: none");
    }

    [Fact]
    public async Task SetJournalTodos_MixedBatch_ShowsGuidanceOnTheRefusedTask_AndAddsTheRest()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("TaskItems", new[] { Fixtures.Task(1, "Goal"), Fixtures.Task(2, "Plain") })
            .Post("JournalEntries/3/todos", new { code = "TASK_PLAN_HAS_OPEN_SUBTASKS", message = "A task with open subtasks can't be planned on a day. Plan its subtasks instead." }, HttpStatusCode.UnprocessableEntity)
            .Post("JournalEntries/3/todos", status: HttpStatusCode.NoContent);

        var text = await Tools(handler).SetJournalTodos(add: [1, 2]);

        text.Should().Contain("x #1 Goal: A task with open subtasks can't be planned on a day. Plan its subtasks instead.")
            .And.Contain("[TASK_PLAN_HAS_OPEN_SUBTASKS]")
            .And.Contain("Plan its subtasks instead, using update_task or update_tasks with journalDate")
            .And.Contain("+ #2 Plain planned for 2026-10-09");
    }

    [Fact]
    public async Task SetJournalTodos_EveryAddRefused_ThrowsWithGuidanceOnEachLine()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("TaskItems", new[] { Fixtures.Task(1, "Goal"), Fixtures.Task(2, "Done") })
            .Post("JournalEntries/3/todos", new { code = "TASK_PLAN_HAS_OPEN_SUBTASKS", message = "Has open subtasks." }, HttpStatusCode.UnprocessableEntity)
            .Post("JournalEntries/3/todos", new { code = "TASK_PLAN_COMPLETED_NOT_ALLOWED", message = "Completed." }, HttpStatusCode.UnprocessableEntity);

        var act = () => Tools(handler).SetJournalTodos(add: [1, 2]);

        var ex = (await act.Should().ThrowAsync<McpException>()).Which;
        ex.Message.Should().Contain("x #1 Goal: Has open subtasks.").And.Contain("Plan its subtasks instead")
            .And.Contain("x #2 Done: Completed.").And.Contain("A completed task cannot be planned onto a different day");
    }

    [Fact]
    public async Task SetJournalTodos_CodedUnprocessableOnRemove_UsesGuidance()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("TaskItems", new[] { Fixtures.Task(1, "Goal"), Fixtures.Task(2, "Plain") })
            .On(HttpMethod.Delete, "JournalEntries/3/todos/1", new { code = "TASK_PLAN_COMPLETED_NOT_ALLOWED", message = "Completed." }, HttpStatusCode.UnprocessableEntity)
            .On(HttpMethod.Delete, "JournalEntries/3/todos/2", status: HttpStatusCode.NoContent);

        var text = await Tools(handler).SetJournalTodos(remove: [1, 2]);

        text.Should().Contain("x #1 Goal: Completed.").And.Contain("A completed task cannot be planned onto a different day")
            .And.Contain("- #2 Plain removed from 2026-10-09");
    }

    [Fact]
    public async Task SetJournalTodos_ConflictStillReportsAlreadyPlanned()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("TaskItems", new[] { Fixtures.Task(1, "Goal") })
            .Post("JournalEntries/3/todos", new { message = "already linked" }, HttpStatusCode.Conflict);

        var text = await Tools(handler).SetJournalTodos(add: [1]);

        text.Should().Contain("= #1 Goal was already planned for 2026-10-09");
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
    public async Task GetJournal_TokenAlreadyCanceled_ThrowsOperationCanceledException()
    {
        var handler = JournalWith([Fixtures.Task(5, "Ship")], [Fixtures.Task(5, "Ship")]);
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        var act = () => Tools(handler).GetJournal(ct: cts.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task GetJournal_TodosFail_StillThrowsMcpException()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .On(HttpMethod.Get, "JournalEntries/3/todos", status: HttpStatusCode.InternalServerError)
            .Get("JournalEntries/3/notes", Array.Empty<object>())
            .Get("TaskItems", Array.Empty<object>());

        var act = () => Tools(handler).GetJournal();

        await act.Should().ThrowAsync<McpException>();
    }

    [Fact]
    public async Task GetJournal_NotesFail_StillThrowsMcpException()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09") })
            .Get("JournalEntries/3/todos", Array.Empty<object>())
            .On(HttpMethod.Get, "JournalEntries/3/notes", status: HttpStatusCode.InternalServerError)
            .Get("TaskItems", Array.Empty<object>());

        var act = () => Tools(handler).GetJournal();

        await act.Should().ThrowAsync<McpException>();
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

    private static StubHandler AppendHandler(string? existing) => new StubHandler()
        .Get("JournalEntries", new[] { Fixtures.Journal(3, "2026-10-09", existing) })
        .Put("JournalEntries/3", Fixtures.Journal(3, "2026-10-09", "saved"))
        .Post("JournalEntries/3/notes", new { id = 1, content = "n", createdAt = "2026-10-09T17:00:00Z" }, HttpStatusCode.Created);

    [Fact]
    public async Task UpdateJournal_Append_AddsAfterABlankLine_AndReportsTheLength()
    {
        var handler = AppendHandler("Morning: spec review.");

        var text = await Tools(handler).UpdateJournal(summary: "Afternoon: demo.", append: true);

        var put = handler.BodyOf(HttpMethod.Put, "JournalEntries/3");
        put.GetProperty("summary").GetString().Should().Be("Morning: spec review.\n\nAfternoon: demo.");
        put.GetProperty("title").GetString().Should().Be("Journal 2026-10-09");
        text.Should().Be("Appended to the journal summary for 2026-10-09 (now 39 of 10000 characters).");
    }

    [Fact]
    public async Task UpdateJournal_Append_TrimsTrailingWhitespaceBeforeTheSeparator()
    {
        var handler = AppendHandler("Old text  \n\n");

        await Tools(handler).UpdateJournal(summary: "  New text \n", append: true);

        handler.BodyOf(HttpMethod.Put, "JournalEntries/3").GetProperty("summary").GetString().Should().Be("Old text\n\nNew text");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  \n")]
    public async Task UpdateJournal_Append_ToAnEmptySummary_SavesJustTheNewText(string? existing)
    {
        var handler = AppendHandler(existing);

        await Tools(handler).UpdateJournal(summary: "First entry", append: true);

        handler.BodyOf(HttpMethod.Put, "JournalEntries/3").GetProperty("summary").GetString().Should().Be("First entry");
    }

    [Fact]
    public async Task UpdateJournal_Append_WithNoEntry_CreatesItAndSavesTheNewText()
    {
        var handler = new StubHandler()
            .Get("JournalEntries", Array.Empty<object>())
            .Post("JournalEntries", Fixtures.Journal(8, "2026-10-09"), HttpStatusCode.Created)
            .Put("JournalEntries/8", Fixtures.Journal(8, "2026-10-09", "Fresh"));

        await Tools(handler).UpdateJournal(summary: "Fresh", append: true);

        handler.BodyOf(HttpMethod.Put, "JournalEntries/8").GetProperty("summary").GetString().Should().Be("Fresh");
    }

    [Fact]
    public async Task UpdateJournal_Append_WithANote_SavesBoth()
    {
        var handler = AppendHandler("Old");

        var text = await Tools(handler).UpdateJournal(summary: "New", note: "A note", append: true);

        handler.BodyOf(HttpMethod.Put, "JournalEntries/3").GetProperty("summary").GetString().Should().Be("Old\n\nNew");
        handler.BodyOf(HttpMethod.Post, "JournalEntries/3/notes").GetProperty("content").GetString().Should().Be("A note");
        text.Should().StartWith("Appended to the journal summary for 2026-10-09 (now 8 of 10000 characters).").And.EndWith("Note added.");
    }

    [Fact]
    public async Task UpdateJournal_BlankSummaryWithoutAppend_StillReplaces()
    {
        var handler = AppendHandler("Old");

        var text = await Tools(handler).UpdateJournal(summary: "");

        handler.BodyOf(HttpMethod.Put, "JournalEntries/3").GetProperty("summary").GetString().Should().BeEmpty();
        text.Should().Be("Journal 2026-10-09: summary replaced.");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task UpdateJournal_AppendWithBlankSummary_IsRejected_AndSavesNothing(string? summary)
    {
        var handler = AppendHandler("Old");

        var act = () => Tools(handler).UpdateJournal(summary: summary, note: "n", append: true);

        await act.Should().ThrowAsync<McpException>().WithMessage("*append=true needs*");
        handler.Requests.Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateJournal_Append_AtExactlyTheLimit_IsAccepted()
    {
        var handler = AppendHandler(new string('a', 4998));

        await Tools(handler).UpdateJournal(summary: new string('b', 5000), append: true);

        handler.BodyOf(HttpMethod.Put, "JournalEntries/3").GetProperty("summary").GetString()!.Length.Should().Be(10000);
    }

    [Fact]
    public async Task UpdateJournal_Append_OverTheLimit_IsRejected_WithLengthsAndAWayOut()
    {
        var handler = AppendHandler(new string('a', 5000));

        var act = () => Tools(handler).UpdateJournal(summary: new string('b', 5000), note: "n", append: true);

        var message = (await act.Should().ThrowAsync<McpException>()).Which.Message;
        message.Should().Contain("10002 characters").And.Contain("existing 5000").And.Contain("new 5000").And.Contain("limit is 10000")
            .And.Contain("Nothing was saved").And.Contain("append=false");
        handler.Sent(HttpMethod.Put, "JournalEntries/3").Should().BeEmpty();
        handler.Sent(HttpMethod.Post, "JournalEntries/3/notes").Should().BeEmpty();
    }
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
                Fixtures.Task(4, "Done", status: "Completed", projectId: 1, projectName: "Alpha"),
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
                Fixtures.Task(4, "Done 1", status: "Completed", projectId: 1),
                Fixtures.Task(5, "Done 2", status: "Completed", projectId: 1),
                Fixtures.Task(6, "Done 3", status: "Completed", projectId: 1),
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
                Fixtures.Task(1, "Finished this week", status: "Completed", projectId: 7, projectName: "Alpha"),
                Fixtures.Task(2, "Finished last month", status: "Completed"),
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
            .Get("TaskItems", new[] { Fixtures.Task(1, "Late finisher", status: "Completed") })
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

        text.Should().Contain("Blocked:").And.Contain("#1 [Low/Blocked] Old blocked | blocked: Waiting (4d)").And.Contain("highest-id of 305 tasks");
    }

    [Fact]
    public async Task InvertedRange_IsRejected()
    {
        var tools = new ReviewTools(Fixtures.Client(new StubHandler()), Fixtures.Time());

        await FluentActions.Awaiting(() => tools.WeeklyReview(from: "2026-10-09", to: "2026-10-01"))
            .Should().ThrowAsync<McpException>().WithMessage("*after 'to'*");
    }
}
