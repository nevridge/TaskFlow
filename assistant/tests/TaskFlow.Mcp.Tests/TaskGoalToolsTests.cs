using System.Net;
using AwesomeAssertions;
using ModelContextProtocol;
using TaskFlow.Contracts;
using TaskFlow.Mcp.Tools;

namespace TaskFlow.Mcp.Tests;

/// <summary>The goal parameter of the task tools. Goal 1 is Now, goals 2 and 3 are Next, all in project Alpha (#7).</summary>
public class TaskGoalToolsTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static object Task5(int? goalId = null, string status = "Todo", int? projectId = 7, int? parentId = null) =>
        Fixtures.Task(
            5,
            "Five",
            status: status,
            projectId: projectId,
            projectName: projectId switch { 7 => "Alpha", 8 => "Beta", _ => null },
            parentId: parentId,
            goalId: goalId,
            goalTitle: goalId switch { 1 => "Ship v1", 2 => "Docs", 3 => "Polish", _ => null });

    private static (TaskTools Tools, StubHandler Handler) Setup(Action<StubHandler> configure)
    {
        var handler = new StubHandler()
            .Get("Projects", new[] { Fixtures.Project(7, "Alpha"), Fixtures.Project(8, "Beta") })
            .Get("Goals", new[]
            {
                Fixtures.Goal(1, "Ship v1", status: "Now"),
                Fixtures.Goal(2, "Docs"),
                Fixtures.Goal(3, "Polish"),
            });
        configure(handler);
        return (new TaskTools(Fixtures.Client(handler), Fixtures.Time()), handler);
    }

    private static IEnumerable<string> Writes(StubHandler handler) =>
        handler.Requests.Where(r => r.Method != HttpMethod.Get).Select(r => $"{r.Method} {r.Path}");

    private static async Task<string> Error(Func<Task<string>> act) =>
        (await act.Should().ThrowAsync<McpException>()).Which.Message;

    private static object NotNow => new
    {
        code = ErrorCodes.TaskGoalNotNow,
        message = "Not the current goal.",
        details = new { taskItemId = 5, goalId = 2, nowGoalId = 1, nowGoalTitle = "Ship v1" },
    };

    // --- create_tasks ---

    [Fact]
    public async Task Create_SendsTheGoal_InThePost_WithNoSecondCall()
    {
        var (tools, handler) = Setup(h => h.Post("TaskItems", Task5(goalId: 2), HttpStatusCode.Created));

        var text = await tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "docs" }], Ct);

        Writes(handler).Should().Equal("POST TaskItems");
        var body = handler.BodyOf(HttpMethod.Post, "TaskItems");
        body.GetProperty("goalId").GetInt32().Should().Be(2);
        body.GetProperty("projectId").GetInt32().Should().Be(7);
        text.Should().Contain("goal: Docs").And.NotContain("!");
    }

    [Theory]
    [InlineData("none", "Alpha")]
    [InlineData("None", null)]
    public async Task Create_WithGoalNone_CreatesTheTask_WithNoGoalCall(string goal, string? project)
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems", Array.Empty<object>())
            .Post("TaskItems", Task5(), HttpStatusCode.Created));

        var report = await tools.CreateTasks([new NewTask { Title = "Five", Project = project, Goal = goal }], ct: Ct);

        report.Should().Contain("+ ").And.NotContain("!");
        Writes(handler).Should().Equal("POST TaskItems");
        handler.Requests.Should().NotContain(r => r.Path == "Goals");
        handler.BodyOf(HttpMethod.Post, "TaskItems").GetProperty("goalId").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
    }

    [Fact]
    public async Task Create_SubtaskWhoseGoalIsTheParentsGoal_OmitsTheGoalFromThePost()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/4", Fixtures.Task(4, "Four", projectId: 7, projectName: "Alpha", goalId: 2, goalTitle: "Docs"))
            .Post("TaskItems", Task5(goalId: 2, parentId: 4), HttpStatusCode.Created));

        var text = await tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "2", ParentTaskId = 4 }], Ct);

        // The API refuses any goalId on a subtask, even the inherited one; the subtask gets the parent's goal anyway.
        Writes(handler).Should().Equal("POST TaskItems");
        handler.BodyOf(HttpMethod.Post, "TaskItems").GetProperty("goalId").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        text.Should().Contain("goal: Docs").And.NotContain("!");
    }

    [Fact]
    public async Task Create_SubtaskWithADifferentGoalThanItsParent_IsRefusedInTheTool_BeforeThePost()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/4", Fixtures.Task(4, "Four", projectId: 7, projectName: "Alpha", goalId: 1, goalTitle: "Ship v1"))
            .Post("TaskItems", Task5(goalId: 1, parentId: 4), HttpStatusCode.Created));

        var message = await Error(() => tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "2", ParentTaskId = 4 }], Ct));

        message.Should().Contain("x \"Five\"").And.Contain("subtask of #4").And.Contain("Change the parent's goal, or omit goal");
        Writes(handler).Should().BeEmpty();
    }

    [Fact]
    public async Task Create_RefusedByTheApi_CreatesNothing_AndSaysSo()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems", Array.Empty<object>())
            .Post("TaskItems", new { message = "The task must be in the goal's project." }, HttpStatusCode.BadRequest));

        var message = await Error(() => tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "Docs" }], Ct));

        message.Should().Contain("x \"Five\": The task must be in the goal's project. Nothing was saved.");
        Writes(handler).Should().Equal("POST TaskItems");
    }

    [Fact]
    public async Task Create_TimeoutOnThePost_SaysToCheckBeforeRetrying_AndStopsTheBatch()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems", Array.Empty<object>())
            .Fail(HttpMethod.Post, "TaskItems", new TaskCanceledException()));

        var message = await Error(() => tools.CreateTasks(
            [new NewTask { Title = "One", Project = "Alpha" }, new NewTask { Title = "Two", Project = "Alpha" }], Ct));

        message.Should().Contain("x \"One\": ").And.Contain("did not respond in time").And.Contain("check with get_task before retrying")
            .And.NotContain("Nothing was saved").And.Contain("x \"Two\": not attempted");
        Writes(handler).Should().Equal("POST TaskItems");
    }

    [Theory]
    [InlineData(null, "Docs", "goal needs project")]
    [InlineData("Alpha", "Nope", "No goal matches 'Nope'")]
    public async Task Create_UnresolvedGoal_FailsThatItemBeforeCreatingIt(string? project, string goal, string expected)
    {
        var (tools, handler) = Setup(_ => { });

        var message = await Error(() => tools.CreateTasks([new NewTask { Title = "Five", Project = project, Goal = goal }], Ct));

        message.Should().Contain("x \"Five\"").And.Contain(expected);
        Writes(handler).Should().BeEmpty();
    }

    // --- update_task ---

    [Fact]
    public async Task Update_GoalOnly_IsOnePatchWithOnlyTheGoal_AndReportsIt()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Patch("TaskItems/5", Task5(goalId: 2)));

        var text = await tools.UpdateTask(5, goal: "Docs", ct: Ct);

        Writes(handler).Should().Equal("PATCH TaskItems/5");
        handler.AssertPatchKeys("TaskItems/5", "goalId");
        handler.BodyOf(HttpMethod.Patch, "TaskItems/5").GetProperty("goalId").GetInt32().Should().Be(2);
        text.Should().StartWith("Updated #5. Changed goal -> Docs.");
    }

    [Fact]
    public async Task Update_GoalNone_SendsAnExplicitNull_AndReportsTheRemoval()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Patch("TaskItems/5", Task5()));

        var text = await tools.UpdateTask(5, goal: "None", ct: Ct);

        Writes(handler).Should().Equal("PATCH TaskItems/5");
        handler.AssertPatchKeys("TaskItems/5", "goalId");
        handler.BodyOf(HttpMethod.Patch, "TaskItems/5").GetProperty("goalId").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        text.Should().StartWith("Updated #5. Changed goal (removed).");
    }

    [Theory]
    [InlineData(null, "none")]
    [InlineData(2, "Docs")]
    public async Task Update_UnchangedGoal_MakesNoCall(int? current, string goal)
    {
        var (tools, handler) = Setup(h => h.Get("TaskItems/5", Task5(goalId: current)));

        var text = await tools.UpdateTask(5, goal: goal, ct: Ct);

        Writes(handler).Should().BeEmpty();
        text.Should().StartWith("Updated #5. No changes needed.");
    }

    [Fact]
    public async Task Update_UnchangedGoalWithAnotherField_OmitsTheGoalFromThePatch()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Patch("TaskItems/5", Task5(goalId: 2)));

        var text = await tools.UpdateTask(5, priority: "high", goal: "Docs", ct: Ct);

        handler.AssertPatchKeys("TaskItems/5", "priority");
        text.Split('\n')[0].Should().Be("Updated #5. Changed priority.");
    }

    [Fact]
    public async Task Update_OmittedGoal_SendsNoGoal_AndReadsNoGoals()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Patch("TaskItems/5", Task5(goalId: 2)));

        var text = await tools.UpdateTask(5, priority: "high", ct: Ct);

        Writes(handler).Should().Equal("PATCH TaskItems/5");
        handler.AssertPatchKeys("TaskItems/5", "priority");
        handler.Sent(HttpMethod.Get, "Goals").Should().BeEmpty();
        text.Split('\n')[0].Should().NotContain("goal");
    }

    [Theory]
    [InlineData("Ship v1", 1)]
    [InlineData("none", null)]
    public async Task Update_StatusAndGoalTogether_AreOnePatch(string goal, int? expectedGoalId)
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Patch("TaskItems/5", Task5(goalId: expectedGoalId, status: "InProgress")));

        await tools.UpdateTask(5, status: "inprogress", goal: goal, ct: Ct);

        Writes(handler).Should().Equal("PATCH TaskItems/5");
        handler.AssertPatchKeys("TaskItems/5", "status", "goalId");
    }

    [Fact]
    public async Task Update_ToANextGoalWhileInProgress_IsStillOnePatch_TheApiJudgesTheRule()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 1, status: "InProgress"))
            .Patch("TaskItems/5", Task5(goalId: 2)));

        await tools.UpdateTask(5, status: "todo", goal: "Docs", ct: Ct);

        Writes(handler).Should().Equal("PATCH TaskItems/5");
        handler.AssertPatchKeys("TaskItems/5", "status", "goalId");
    }

    [Fact]
    public async Task Update_WithAReparent_AndANewGoal_IsOnePatch()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2, parentId: 4))
            .Patch("TaskItems/5", Task5(goalId: 1)));

        await tools.UpdateTask(5, parentTaskId: 0, goal: "Ship v1", ct: Ct);

        Writes(handler).Should().Equal("PATCH TaskItems/5");
        handler.AssertPatchKeys("TaskItems/5", "parentTaskItemId", "goalId");
    }

    [Fact]
    public async Task Update_WithAProjectMove_AndAGoalOfTheNewProject_IsOnePatch()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 3, projectId: 8))
            .Patch("TaskItems/5", Task5(goalId: 1)));

        var text = await tools.UpdateTask(5, project: "Alpha", goal: "Ship v1", ct: Ct);

        Writes(handler).Should().Equal("PATCH TaskItems/5");
        handler.AssertPatchKeys("TaskItems/5", "projectId", "goalId");
        text.Should().StartWith("Updated #5. Changed project -> Alpha, goal -> Ship v1.");
    }

    [Fact]
    public async Task Update_ReportsAGoalThatAProjectMoveCleared()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Patch("TaskItems/5", Task5(projectId: 8)));

        var text = await tools.UpdateTask(5, project: "Beta", ct: Ct);

        handler.AssertPatchKeys("TaskItems/5", "projectId");
        text.Should().StartWith("Updated #5. Changed project -> Beta, goal (removed).");
    }

    [Fact]
    public async Task Update_ReportsAGoalTakenFromANewParent()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Patch("TaskItems/5", Task5(goalId: 3, parentId: 4)));

        var text = await tools.UpdateTask(5, parentTaskId: 4, ct: Ct);

        text.Should().StartWith("Updated #5. Changed parent, goal -> Polish.");
    }

    [Theory]
    [InlineData("Nope", null, "No goal matches 'Nope'")]
    [InlineData("Docs", "none", "would have no project")]
    public async Task Update_UnresolvedGoal_RejectsTheWholeUpdate(string goal, string? project, string expected)
    {
        var (tools, handler) = Setup(h => h.Get("TaskItems/5", Task5()));

        var message = await Error(() => tools.UpdateTask(5, priority: "high", goal: goal, project: project, ct: Ct));

        message.Should().Contain(expected);
        Writes(handler).Should().BeEmpty();
    }

    [Theory]
    [InlineData("Done")]
    [InlineData("Dropped")]
    public async Task Update_ToAClosedGoal_WritesNothing(string goalStatus)
    {
        var handler = new StubHandler()
            .Get("TaskItems/5", Task5())
            .Get("Goals", new[] { Fixtures.Goal(2, "Docs", status: goalStatus) });
        var tools = new TaskTools(Fixtures.Client(handler), Fixtures.Time());

        var message = await Error(() => tools.UpdateTask(5, title: "New", goal: "Docs", ct: Ct));

        message.Should().Contain($"is {goalStatus}").And.Contain("Nothing was changed");
        Writes(handler).Should().BeEmpty();
    }

    [Theory]
    [InlineData("Docs")]
    [InlineData("none")]
    public async Task Update_ADifferentGoalForASubtask_WritesNothing(string goal)
    {
        var (tools, handler) = Setup(h => h.Get("TaskItems/5", Task5(goalId: 1, parentId: 4)));

        var message = await Error(() => tools.UpdateTask(5, title: "New", goal: goal, ct: Ct));

        message.Should().Contain("subtask of #4").And.Contain("Change the parent's goal, or omit goal").And.Contain("Nothing was changed");
        Writes(handler).Should().BeEmpty();
    }

    [Fact]
    public async Task Update_TheInheritedGoalOnASubtask_IsOmittedFromThePatch()
    {
        // The API refuses any goalId on a subtask, even the value it inherits, so the tool must not send it.
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 1, parentId: 4))
            .Patch("TaskItems/5", Task5(goalId: 1, parentId: 4)));

        await tools.UpdateTask(5, title: "New", goal: "Ship v1", ct: Ct);

        handler.AssertPatchKeys("TaskItems/5", "title");
    }

    [Fact]
    public async Task Update_ANewSubtaskWithAGoalItsParentDoesNotGiveIt_WritesNothing()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Get("TaskItems/4", Fixtures.Task(4, "Four", projectId: 7, goalId: 1, goalTitle: "Ship v1")));

        var message = await Error(() => tools.UpdateTask(5, parentTaskId: 4, goal: "Docs", ct: Ct));

        message.Should().Contain("subtask of #4").And.Contain("Nothing was changed");
        Writes(handler).Should().BeEmpty();
    }

    [Fact]
    public async Task Update_GoalRefusal_ChangesNothing_AndSaysSo()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Patch("TaskItems/5", NotNow, HttpStatusCode.UnprocessableEntity));

        var message = await Error(() => tools.UpdateTask(5, status: "inprogress", goal: "Docs", ct: Ct));

        message.Should().StartWith("Not the current goal. [TASK_GOAL_NOT_NOW]")
            .And.Contain("Now goal: #1 Ship v1")
            .And.EndWith("\nNothing was saved.")
            .And.NotContain("was saved (").And.NotContain("Retry only");
        Writes(handler).Should().Equal("PATCH TaskItems/5");
    }

    [Fact]
    public async Task Update_PlainGoalRefusal_ChangesNothing_AndSaysSo()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Patch("TaskItems/5", new { message = "The task must be in the goal's project." }, HttpStatusCode.BadRequest));

        var message = await Error(() => tools.UpdateTask(5, title: "New", goal: "Docs", ct: Ct));

        message.Should().Be("The task must be in the goal's project. Nothing was saved.");
    }

    [Fact]
    public async Task UpdateTasks_GoalRefusal_IsAllOrNothingForThatItem_AndTheBatchContinues()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Patch("TaskItems/5", NotNow, HttpStatusCode.UnprocessableEntity)
            .Get("TaskItems/6", Fixtures.Task(6, "Six")).Patch("TaskItems/6", Fixtures.Task(6, "Six", priority: "High")));

        var text = await tools.UpdateTasks(
            [new TaskUpdate { Id = 5, Priority = "high", Goal = "Docs" }, new TaskUpdate { Id = 6, Priority = "high" }], Ct);

        var lines = text.Split('\n');
        lines[0].Should().Be("Updated 1 of 2 task(s).");
        lines[1].Should().StartWith("x #5: Not the current goal. [TASK_GOAL_NOT_NOW]").And.EndWith("Nothing was saved.")
            .And.NotContain("was saved (").And.NotContain("resend only");
        lines[2].Should().StartWith("+ #6 ");
        Writes(handler).Should().Equal("PATCH TaskItems/5", "PATCH TaskItems/6");
    }

    [Fact]
    public async Task UpdateTasks_UnreachableApi_StopsTheBatch_WithNoPartialSaveText()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Fail(HttpMethod.Patch, "TaskItems/5", new HttpRequestException("refused")));

        var message = await Error(() => tools.UpdateTasks(
            [new TaskUpdate { Id = 5, Priority = "high", Goal = "Docs" }, new TaskUpdate { Id = 6, Priority = "high" }], Ct));

        message.Should().Contain("x #5: cannot reach the TaskFlow API").And.Contain("x #6: not attempted")
            .And.NotContain("was saved").And.NotContain("Nothing was saved");
        handler.Sent(HttpMethod.Get, "TaskItems/6").Should().BeEmpty();
    }

    // --- list_tasks ---

    private static readonly object[] Listed =
    [
        Fixtures.Task(1, "In docs", projectId: 7, projectName: "Alpha", goalId: 2, goalTitle: "Do\ncs"),
        Fixtures.Task(2, "Unsorted alpha", projectId: 7, projectName: "Alpha"),
        Fixtures.Task(3, "Unsorted beta", projectId: 8, projectName: "Beta"),
        Fixtures.Task(4, "No project"),
    ];

    [Theory]
    [InlineData("Docs", "Alpha", "1")]
    [InlineData("none", "Alpha", "2")]
    [InlineData("none", null, "2,3")]
    public async Task List_FiltersByGoalOrUnsorted(string goal, string? project, string expected)
    {
        var (tools, _) = Setup(h => h.Get("TaskItems", Listed));

        var text = await tools.ListTasks(project: project, goal: goal, ct: Ct);

        var ids = text.Split('\n').Where(l => l.StartsWith('#')).Select(l => l[1..l.IndexOf(' ')]);
        ids.Should().BeEquivalentTo(expected.Split(','));
    }

    [Fact]
    public async Task List_ShowsTheGoalOnOneLine()
    {
        var (tools, _) = Setup(h => h.Get("TaskItems", Listed));

        var text = await tools.ListTasks(ct: Ct);

        text.Should().Contain("project: Alpha | goal: Do cs");
    }

    [Fact]
    public async Task GetTask_ShowsTheGoal()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Get("TaskItems/5/notes", Array.Empty<object>())
            .Get("TaskItems/5/history", Array.Empty<object>()));

        var text = await tools.GetTask(5, Ct);

        text.Should().Contain("project: Alpha | goal: Docs");
    }

    [Fact]
    public async Task List_GoalWithoutProject_IsRejected()
    {
        var (tools, handler) = Setup(_ => { });

        var message = await Error(() => tools.ListTasks(goal: "Docs", ct: Ct));

        message.Should().Contain("needs 'project'");
        handler.Requests.Should().BeEmpty();
    }
}
