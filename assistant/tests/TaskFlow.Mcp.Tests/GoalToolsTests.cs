using System.Net;
using System.Text.Json;
using AwesomeAssertions;
using ModelContextProtocol;
using TaskFlow.Contracts;
using TaskFlow.Mcp.Api;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Tests;

public class GoalToolsTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly object[] Sample =
    [
        Fixtures.Goal(1, "Ship v1", status: "Now", description: "Old text", doneWhen: "Released", open: 2, done: 1),
        Fixtures.Goal(2, "Docs"),
        Fixtures.Goal(3, "Polish"),
        Fixtures.Goal(4, "Mobile", status: "Parked", parkedReason: "no\ntime"),
        Fixtures.Goal(5, "Spike", status: "Done", closedAt: "2026-10-05T20:00:00Z", done: 3),
        Fixtures.Goal(6, "Cleanup"),
        Fixtures.Goal(8, "Cleanup"),
        Fixtures.Goal(9, "Empty one"),
    ];

    private static (GoalTools Tools, StubHandler Handler) Setup(Action<StubHandler>? configure = null)
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha") })
            .Get("Goals", Sample);
        configure?.Invoke(handler);
        return (new GoalTools(Fixtures.Client(handler), Fixtures.Time()), handler);
    }

    private static async Task<string> Error(Func<Task<string>> act) =>
        (await act.Should().ThrowAsync<McpException>()).Which.Message;

    private static bool IsWrite(RecordedRequest r) => r.Method != HttpMethod.Get;

    [Fact]
    public async Task ListGoals_KeepsTheApiOrder_WithReasonLocalDatesAndCounts()
    {
        var (tools, handler) = Setup();

        var text = await tools.ListGoals("alpha", Ct);

        handler.Sent(HttpMethod.Get, "Goals").Single().Query.Should().Be("?projectId=7");
        var lines = text.Split('\n');
        lines[0].Should().Be("8 goal(s) in project 'Alpha':");
        // 03:00Z is the previous day at UTC-7.
        lines[1].Should().Be("#1 [Now] Ship v1 | since 2026-10-01 | 2 open / 1 done");
        lines[4].Should().Be("#4 [Parked] Mobile | parked: no time | since 2026-10-01 | 0 open / 0 done");
        lines[5].Should().Be("#5 [Done] Spike | since 2026-10-01 | closed 2026-10-05 | 0 open / 3 done");
    }

    [Fact]
    public async Task SaveGoal_Create_DefaultsToNext_ReadsNoGoals_AndSendsNoReorder()
    {
        var (tools, handler) = Setup(h => h.Post("Goals", Fixtures.Goal(10, "Launch"), HttpStatusCode.Created));

        var text = await tools.SaveGoal("Alpha", title: " Launch ", doneWhen: "Live", ct: Ct);

        var body = handler.BodyOf(HttpMethod.Post, "Goals");
        body.GetProperty("projectId").GetInt32().Should().Be(7);
        body.GetProperty("title").GetString().Should().Be("Launch");
        body.GetProperty("status").GetString().Should().Be("next");
        body.GetProperty("doneWhen").GetString().Should().Be("Live");
        handler.Requests.Should().NotContain(r => r.Method == HttpMethod.Put);
        handler.Sent(HttpMethod.Get, "Goals").Should().BeEmpty();
        text.Should().StartWith("Created goal in project 'Alpha': #10 [Next] Launch");
    }

    [Fact]
    public async Task SaveGoal_Edit_KeepsOmittedFields_AndAnEmptyStringClears()
    {
        var (tools, handler) = Setup(h => h.Put("Goals/1", Fixtures.Goal(1, "Ship v1", status: "Now")));

        await tools.SaveGoal("Alpha", goal: "ship", doneWhen: "", ct: Ct);

        var body = handler.BodyOf(HttpMethod.Put, "Goals/1");
        body.GetProperty("title").GetString().Should().Be("Ship v1");
        body.GetProperty("description").GetString().Should().Be("Old text");
        body.GetProperty("doneWhen").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("status").GetString().Should().Be("now");
    }

    [Fact]
    public async Task SaveGoal_EditingAParkedGoal_KeepsItsReason_AndLeavingParkedDropsIt()
    {
        var (tools, handler) = Setup(h => h.Put("Goals/4", Fixtures.Goal(4, "Mobile", status: "Parked")));

        await tools.SaveGoal("Alpha", goal: "4", title: "Phones", ct: Ct);
        handler.BodyOf(HttpMethod.Put, "Goals/4").GetProperty("parkedReason").GetString().Should().Be("no\ntime");

        await tools.SaveGoal("Alpha", goal: "4", status: "next", ct: Ct);
        handler.BodyOf(HttpMethod.Put, "Goals/4").GetProperty("parkedReason").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Theory]
    [InlineData("Parked", " waiting on legal ", "parked", "waiting on legal")]
    [InlineData("DONE", null, "done", null)]
    [InlineData("dropped", null, "dropped", null)]
    [InlineData("now", null, "now", null)]
    public async Task SaveGoal_StatusChange_SendsTheNewStatusAndReason(string status, string? reason, string sentStatus, string? sentReason)
    {
        var (tools, handler) = Setup(h => h.Put("Goals/2", Fixtures.Goal(2, "Docs")));

        await tools.SaveGoal("Alpha", goal: "Docs", status: status, parkedReason: reason, ct: Ct);

        var body = handler.BodyOf(HttpMethod.Put, "Goals/2");
        body.GetProperty("status").GetString().Should().Be(sentStatus);
        body.GetProperty("parkedReason").GetString().Should().Be(sentReason);
    }

    [Fact]
    public async Task SaveGoal_EditWithPosition_SendsItInThePut_AndNoReorderCall()
    {
        var (tools, handler) = Setup(h => h.Put("Goals/9", Fixtures.Goal(9, "Empty one")));

        var text = await tools.SaveGoal("Alpha", goal: "9", position: 2, ct: Ct);

        handler.Requests.Where(IsWrite).Select(r => r.Path).Should().Equal("Goals/9");
        handler.BodyOf(HttpMethod.Put, "Goals/9").GetProperty("position").GetInt32().Should().Be(2);
        text.Should().Contain("position 2 in Next");
    }

    [Fact]
    public async Task SaveGoal_CreateWithPosition_SendsItInThePost_WithoutReadingGoals()
    {
        var (tools, handler) = Setup(h => h.Post("Goals", Fixtures.Goal(10, "Launch"), HttpStatusCode.Created));

        await tools.SaveGoal("Alpha", title: "Launch", position: 6, ct: Ct);

        handler.Requests.Where(IsWrite).Select(r => $"{r.Method} {r.Path}").Should().Equal("POST Goals");
        handler.BodyOf(HttpMethod.Post, "Goals").GetProperty("position").GetInt32().Should().Be(6);
        handler.Sent(HttpMethod.Get, "Goals").Should().BeEmpty();
    }

    [Fact]
    public async Task SaveGoal_WithoutPosition_SendsNoPosition()
    {
        var (tools, handler) = Setup(h => h.Put("Goals/2", Fixtures.Goal(2, "Docs")));

        await tools.SaveGoal("Alpha", goal: "Docs", title: "Documents", ct: Ct);

        handler.BodyOf(HttpMethod.Put, "Goals/2").GetProperty("position").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Theory]
    [InlineData("create", "position 7 is out of range: use 1 to 6.")]
    [InlineData("edit", "position only applies to a Next goal, and this one would be dropped.")]
    public async Task SaveGoal_ApiPositionRefusal_IsPassedThrough_AndSaysNothingWasSaved(string mode, string apiText)
    {
        var (tools, _) = Setup(h => _ = mode == "create"
            ? h.Post("Goals", new { message = apiText }, HttpStatusCode.BadRequest)
            : h.Put("Goals/2", new { message = apiText }, HttpStatusCode.BadRequest));

        var message = await Error(() => mode == "create"
            ? tools.SaveGoal("Alpha", title: "Launch", position: 7, ct: Ct)
            : tools.SaveGoal("Alpha", goal: "2", status: "dropped", position: 1, ct: Ct));

        message.Should().Be(apiText + " Nothing was saved.");
    }

    [Fact]
    public async Task SaveGoal_Timeout_SaysToCheckBeforeRetrying_NotThatNothingWasSaved()
    {
        var (tools, _) = Setup(h => h.Fail(HttpMethod.Post, "Goals", new TaskCanceledException()));

        var message = await Error(() => tools.SaveGoal("Alpha", title: "Launch", ct: Ct));

        message.Should().Contain("did not respond in time").And.Contain("check with get_task before retrying").And.NotContain("Nothing was saved");
    }

    [Theory]
    [InlineData(null, "Launch", "done", null, null, "only be next or now")]
    [InlineData(null, "Launch", "parked", "later", null, "only be next or now")]
    [InlineData(null, "Launch", null, "later", null, "parkedReason is only valid")]
    [InlineData("2", null, null, "later", null, "parkedReason is only valid")]
    public async Task SaveGoal_RejectsBadInput_BeforeAnyWrite(string? goal, string? title, string? status, string? parkedReason, int? position, string expected)
    {
        var (tools, handler) = Setup();

        var message = await Error(() => tools.SaveGoal("Alpha", goal: goal, title: title, status: status, parkedReason: parkedReason, position: position, ct: Ct));

        message.Should().Contain(expected).And.Contain("Nothing was changed");
        handler.Requests.Should().NotContain(r => IsWrite(r));
    }

    [Fact]
    public async Task SaveGoal_SecondNowOnCreate_SaysToCreateAsNextThenSwap()
    {
        var (tools, _) = Setup(h => h.Post("Goals", new { message = "This project already has a Now goal." }, HttpStatusCode.Conflict));

        var message = await Error(() => tools.SaveGoal("Alpha", title: "Launch", status: "now", ct: Ct));

        message.Should().StartWith("This project already has a Now goal. Nothing was saved.").And.Contain("Create it with status=next, then call swap_now");
    }

    [Fact]
    public async Task SaveGoal_SecondNowOnEdit_SuggestsSwapNow()
    {
        var (tools, _) = Setup(h => h.Put("Goals/2", new { message = "This project already has a Now goal." }, HttpStatusCode.Conflict));

        var message = await Error(() => tools.SaveGoal("Alpha", goal: "Docs", status: "now", ct: Ct));

        message.Should().StartWith("This project already has a Now goal. Nothing was saved.").And.Contain("call swap_now").And.NotContain("Create it");
    }

    [Fact]
    public async Task SwapNow_ReportsThePreviousNowGoal()
    {
        var (tools, handler) = Setup(h => h.Post("Goals/2/swap-now", Fixtures.Goal(2, "Docs", status: "Now")));

        var text = await tools.SwapNow("Alpha", "docs", Ct);

        handler.Sent(HttpMethod.Post, "Goals/2/swap-now").Should().ContainSingle();
        text.Should().Be("Goal #2 Docs is now the Now goal of project 'Alpha'. #1 Ship v1 moved to the top of Next.");
    }

    [Fact]
    public async Task SwapNow_Refused_NamesTheTasksInProgress()
    {
        var (tools, _) = Setup(h => h.Post(
            "Goals/2/swap-now",
            new
            {
                code = ErrorCodes.GoalNowHasInProgressTasks,
                message = "The current goal has tasks in progress.",
                details = new { goalId = 1, tasks = new[] { new { id = 11, title = "Fix\nbug" }, new { id = 12, title = "Write" } } },
            },
            HttpStatusCode.UnprocessableEntity));

        var message = await Error(() => tools.SwapNow("Alpha", "2", Ct));

        message.Should().Contain("status=blocked").And.EndWith("\nTasks in progress: #11 Fix bug; #12 Write");
    }

    [Fact]
    public async Task DeleteGoal_WithTasks_NeedsConfirmation()
    {
        var (tools, handler) = Setup();

        var text = await tools.DeleteGoal("Alpha", "Ship v1", ct: Ct);

        text.Should().StartWith("Nothing was deleted.").And.Contain("has 3 task(s) (2 open)").And.Contain("Unsorted").And.Contain("Ask the user");
        handler.Requests.Should().NotContain(r => IsWrite(r));
    }

    [Fact]
    public async Task DeleteGoal_Confirmed_Deletes()
    {
        var (tools, handler) = Setup(h => h.Delete("Goals/1"));

        var text = await tools.DeleteGoal("Alpha", "1", confirmed: true, ct: Ct);

        handler.Sent(HttpMethod.Delete, "Goals/1").Should().ContainSingle();
        text.Should().Contain("3 task(s) returned to Unsorted");
    }

    [Fact]
    public async Task DeleteGoal_WithNoTasks_DeletesAtOnce()
    {
        var (tools, handler) = Setup(h => h.Delete("Goals/9"));

        var text = await tools.DeleteGoal("Alpha", "empty ONE", ct: Ct);

        handler.Sent(HttpMethod.Delete, "Goals/9").Should().ContainSingle();
        text.Should().Contain("It had no tasks");
    }

    [Theory]
    [InlineData("Empty", "No goal is titled 'Empty'. Did you mean #9 Empty one?")]
    [InlineData("cleanup", "Several goals are titled 'cleanup': #6 Cleanup, #8 Cleanup.")]
    public async Task DeleteGoal_NeverGuesses(string goal, string expected)
    {
        var (tools, handler) = Setup();

        var message = await Error(() => tools.DeleteGoal("Alpha", goal, ct: Ct));

        message.Should().StartWith(expected).And.Contain("Nothing was deleted");
        handler.Requests.Should().NotContain(r => IsWrite(r));
    }

    [Theory]
    [InlineData("Cleanup", "ambiguous", "#6 Cleanup, #8 Cleanup")]
    [InlineData("p", "ambiguous", "#1 Ship v1")]
    [InlineData("Nope", "No goal matches 'Nope'", "#9 Empty one")]
    public async Task UnresolvedGoal_ListsIds_AndAsksForOne(string goal, string kind, string listed)
    {
        var (tools, handler) = Setup();

        var message = await Error(() => tools.SwapNow("Alpha", goal, Ct));

        message.Should().Contain(kind).And.Contain(listed).And.EndWith("Pass the goal id.");
        handler.Requests.Should().NotContain(r => IsWrite(r));
    }
}

public class GoalRuleGuidanceTests
{
    private static string Guided(string code, object details)
    {
        var json = JsonSerializer.SerializeToElement(details, TaskFlowApiClient.Json);
        return ToolGuard.WithGuidance(new TaskFlowApiException(HttpStatusCode.UnprocessableEntity, code, "Nope.", json));
    }

    [Fact]
    public async Task TaskGoalNotNow_FromTheWire_NamesTheNowGoal_AndOffersASwap()
    {
        var handler = new StubHandler().Post(
            "TaskItems",
            new { code = ErrorCodes.TaskGoalNotNow, message = "Not now.", details = new { taskItemId = (int?)null, goalId = 2, nowGoalId = 1, nowGoalTitle = "Ship v1" } },
            HttpStatusCode.UnprocessableEntity);

        var ex = await Assert.ThrowsAsync<TaskFlowApiException>(() => Fixtures.Client(handler).CreateTaskAsync(
            new CreateTaskRequest("T", null, "inprogress", "low", null, null, 3, null, 0), TestContext.Current.CancellationToken));

        var text = ToolGuard.WithGuidance(ex);
        text.Should().Contain("swap_now").And.EndWith("\nNow goal: #1 Ship v1");
    }

    [Fact]
    public void GoalHasOpenTasks_NamesAtMostTwentyTasks()
    {
        var tasks = Enumerable.Range(1, 23).Select(i => new { id = i, title = $"T{i}" }).ToArray();

        var line = Guided(ErrorCodes.GoalHasOpenTasks, new { openCount = 23, tasks }).Split('\n')[2];

        line.Should().StartWith("Open tasks: #1 T1; #2 T2").And.EndWith("#20 T20 and 3 more").And.NotContain("#21");
    }

    [Theory]
    [InlineData(ErrorCodes.TaskGoalNotNow, "{}")]
    [InlineData(ErrorCodes.TaskGoalNotNow, "{\"nowGoalId\":\"1\",\"nowGoalTitle\":\"x\"}")]
    [InlineData(ErrorCodes.GoalHasOpenTasks, "[1]")]
    [InlineData(ErrorCodes.GoalHasOpenTasks, "{\"tasks\":3}")]
    [InlineData(ErrorCodes.GoalHasOpenTasks, "{\"tasks\":[]}")]
    [InlineData(ErrorCodes.GoalNowHasInProgressTasks, "{\"tasks\":[1]}")]
    [InlineData(ErrorCodes.GoalNowHasInProgressTasks, "{\"tasks\":[{\"id\":1}]}")]
    public void MalformedDetails_AddNothing(string code, string details)
    {
        using var doc = JsonDocument.Parse(details);

        var text = ToolGuard.WithGuidance(new TaskFlowApiException(HttpStatusCode.UnprocessableEntity, code, "Nope.", doc.RootElement));

        text.Split('\n').Should().HaveCount(2);
    }

    [Fact]
    public void MissingDetails_AddNothing() =>
        ToolGuard.WithGuidance(new TaskFlowApiException(HttpStatusCode.UnprocessableEntity, ErrorCodes.GoalHasOpenTasks, "Nope."))
            .Split('\n').Should().HaveCount(2);
}
