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
            projectName: projectId is null ? null : "Alpha",
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
    public async Task Create_AssignsTheGoal_AfterTheTaskExists()
    {
        var (tools, handler) = Setup(h => h
            .Post("TaskItems", Task5(), HttpStatusCode.Created)
            .Post("Goals/2/tasks", status: HttpStatusCode.NoContent));

        var text = await tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "docs" }], Ct);

        Writes(handler).Should().Equal("POST TaskItems", "POST Goals/2/tasks");
        handler.BodyOf(HttpMethod.Post, "Goals/2/tasks").GetProperty("taskItemId").GetInt32().Should().Be(5);
        text.Should().Contain("goal: Docs").And.NotContain("!");
    }

    [Fact]
    public async Task Create_SubtaskThatInheritedTheGoal_SkipsTheAssignCall()
    {
        var (tools, handler) = Setup(h => h.Post("TaskItems", Task5(goalId: 2, parentId: 4), HttpStatusCode.Created));

        var text = await tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "2", ParentTaskId = 4 }], Ct);

        Writes(handler).Should().Equal("POST TaskItems");
        text.Should().Contain("goal: Docs").And.NotContain("!");
    }

    [Theory]
    [InlineData("refused")]
    [InlineData("unreachable")]
    [InlineData("timeout")]
    public async Task Create_AssignmentFailure_KeepsThePlusLine_AndWarns(string failure)
    {
        var (tools, _) = Setup(h =>
        {
            h.Get("TaskItems", Array.Empty<object>()).Post("TaskItems", Task5(), HttpStatusCode.Created);
            _ = failure switch
            {
                "refused" => h.Post("Goals/2/tasks", NotNow, HttpStatusCode.UnprocessableEntity),
                "unreachable" => h.Fail(HttpMethod.Post, "Goals/2/tasks", new HttpRequestException("refused")),
                _ => h.Fail(HttpMethod.Post, "Goals/2/tasks", new TaskCanceledException()),
            };
        });

        var text = await tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "Docs" }], Ct);

        var lines = text.Split('\n');
        lines[0].Should().Be("Created 1 of 1 task(s).");
        lines.Should().HaveCount(2);
        lines[1].Should().StartWith("+ #5").And.Contain("no goal").And.Contain(failure switch
        {
            "refused" => "swap_now",
            "unreachable" => "cannot reach the TaskFlow API",
            _ => "could not be confirmed",
        });
    }

    [Fact]
    public async Task Create_RefusedReassignmentOfAnInheritedGoal_NamesTheGoalItHas()
    {
        var (tools, _) = Setup(h => h
            .Post("TaskItems", Task5(goalId: 1, parentId: 4), HttpStatusCode.Created)
            .Post("Goals/2/tasks", new { message = "A subtask's goal follows its parent." }, HttpStatusCode.BadRequest));

        var text = await tools.CreateTasks([new NewTask { Title = "Five", Project = "Alpha", Goal = "2", ParentTaskId = 4 }], Ct);

        text.Should().Contain("Goal 'Docs' was not assigned; the task has goal 'Ship v1'.");
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
    public async Task Update_GoalOnly_SendsNoPut_AndReportsTheGoal()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Get("TaskItems/5", Task5(goalId: 2))
            .Post("Goals/2/tasks", status: HttpStatusCode.NoContent));

        var text = await tools.UpdateTask(5, goal: "Docs", ct: Ct);

        Writes(handler).Should().Equal("POST Goals/2/tasks");
        text.Should().StartWith("Updated #5. Changed goal -> Docs.");
    }

    [Fact]
    public async Task Update_GoalNone_RemovesTheTaskFromItsGoal()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Get("TaskItems/5", Task5())
            .Delete("Goals/2/tasks/5"));

        var text = await tools.UpdateTask(5, goal: "None", ct: Ct);

        Writes(handler).Should().Equal("DELETE Goals/2/tasks/5");
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
    public async Task Update_OmittedGoal_MakesNoGoalCall()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Put("TaskItems/5", Task5(goalId: 2)));

        var text = await tools.UpdateTask(5, priority: "high", ct: Ct);

        Writes(handler).Should().Equal("PUT TaskItems/5");
        handler.Sent(HttpMethod.Get, "Goals").Should().BeEmpty();
        text.Split('\n')[0].Should().NotContain("goal");
    }

    [Fact]
    public async Task Update_AlreadyInTheGoal_IsSuccess()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Get("TaskItems/5", Task5(goalId: 2))
            .Post("Goals/2/tasks", new { message = "Already assigned." }, HttpStatusCode.Conflict));

        var text = await tools.UpdateTask(5, goal: "Docs", ct: Ct);

        text.Should().StartWith("Updated #5. Changed goal -> Docs.");
    }

    [Theory]
    [InlineData("Ship v1", "POST Goals/1/tasks")]
    [InlineData("none", "DELETE Goals/2/tasks/5")]
    public async Task Update_LeavingForNowOrNoGoal_AndStarting_WritesTheGoalFirst(string goal, string goalWrite)
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Post("Goals/1/tasks", status: HttpStatusCode.NoContent)
            .Delete("Goals/2/tasks/5")
            .Put("TaskItems/5", Task5(goalId: goal == "none" ? null : 1, status: "InProgress")));

        await tools.UpdateTask(5, status: "inprogress", goal: goal, ct: Ct);

        Writes(handler).Should().Equal(goalWrite, "PUT TaskItems/5");
    }

    [Fact]
    public async Task Update_ToANextGoal_WritesTheGoalAfterThePut()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 1, status: "InProgress"))
            .Get("TaskItems/5", Task5(goalId: 2))
            .Put("TaskItems/5", Task5(goalId: 1))
            .Post("Goals/2/tasks", status: HttpStatusCode.NoContent));

        await tools.UpdateTask(5, status: "todo", goal: "Docs", ct: Ct);

        Writes(handler).Should().Equal("PUT TaskItems/5", "POST Goals/2/tasks");
    }

    [Fact]
    public async Task Update_WithAReparent_WritesTheGoalAfterThePut_EvenForTheNowGoal()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2, parentId: 4))
            .Get("TaskItems/5", Task5(goalId: 1))
            .Put("TaskItems/5", Task5(goalId: 2))
            .Post("Goals/1/tasks", status: HttpStatusCode.NoContent));

        await tools.UpdateTask(5, parentTaskId: 0, goal: "Ship v1", ct: Ct);

        Writes(handler).Should().Equal("PUT TaskItems/5", "POST Goals/1/tasks");
    }

    [Fact]
    public async Task Update_WithAProjectMove_JudgesTheGoalAfterTheMove()
    {
        // The goal id on the task before the move must not make the tool skip the assign call.
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 1, projectId: 8))
            .Get("TaskItems/5", Task5())
            .Get("TaskItems/5", Task5(goalId: 1))
            .Post("Projects/7/tasks", status: HttpStatusCode.NoContent)
            .Post("Goals/1/tasks", status: HttpStatusCode.NoContent));

        await tools.UpdateTask(5, project: "Alpha", goal: "Ship v1", ct: Ct);

        Writes(handler).Should().Equal("POST Projects/7/tasks", "POST Goals/1/tasks");
    }

    [Fact]
    public async Task Update_ReportsAGoalThatAProjectMoveCleared()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2))
            .Get("TaskItems/5", Task5(projectId: 8))
            .Post("Projects/8/tasks", status: HttpStatusCode.NoContent));

        var text = await tools.UpdateTask(5, project: "Beta", ct: Ct);

        text.Should().StartWith("Updated #5. Changed project -> Beta, goal (removed).");
    }

    [Fact]
    public async Task Update_ReportsAGoalTakenFromANewParent()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Put("TaskItems/5", Task5(goalId: 3, parentId: 4)));

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

    [Fact]
    public async Task Update_GoalRefusedAfterThePut_SaysWhatWasSaved_AndWhatRemains()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Put("TaskItems/5", Task5(status: "InProgress"))
            .Post("Goals/2/tasks", NotNow, HttpStatusCode.UnprocessableEntity));

        var message = await Error(() => tools.UpdateTask(5, status: "inprogress", goal: "Docs", ct: Ct));

        message.Should().StartWith("Task #5 was saved (status), but assigning it to goal 'Docs' failed:")
            .And.Contain("Now goal: #1 Ship v1")
            .And.EndWith("Retry only the goal change: call update_task with id=5 and goal='2' only.");
    }

    [Fact]
    public async Task Update_PutRefusedAfterAGoalWrite_SaysTheGoalWasSaved()
    {
        var (tools, _) = Setup(h => h
            .Get("TaskItems/5", Task5(goalId: 2, status: "Draft"))
            .Post("Goals/1/tasks", status: HttpStatusCode.NoContent)
            .Put("TaskItems/5", new { message = "Title too long." }, HttpStatusCode.BadRequest));

        var message = await Error(() => tools.UpdateTask(5, title: "New", goal: "Ship v1", ct: Ct));

        message.Should().StartWith("Task #5's goal was saved ('Ship v1'), but updating the other fields failed: Title too long.")
            .And.Contain("without goal");
    }

    [Fact]
    public async Task Update_ProjectFailureWithAGoalPending_RetriesBoth()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5(projectId: null))
            .Put("TaskItems/5", Task5(projectId: null))
            .Post("Projects/7/tasks", new { message = "Project is full." }, HttpStatusCode.BadRequest));

        var message = await Error(() => tools.UpdateTask(5, priority: "high", project: "Alpha", goal: "Docs", ct: Ct));

        message.Should().Contain("Retry only the project and goal changes: call update_task with id=5, project='Alpha' and goal='2' only.");
        handler.Sent(HttpMethod.Post, "Goals/2/tasks").Should().BeEmpty();
    }

    [Fact]
    public async Task UpdateTasks_UnreachableGoalStep_SaysWhatWasSaved_AndStopsTheBatch()
    {
        var (tools, handler) = Setup(h => h
            .Get("TaskItems/5", Task5())
            .Put("TaskItems/5", Task5())
            .Fail(HttpMethod.Post, "Goals/2/tasks", new HttpRequestException("refused")));

        var message = await Error(() => tools.UpdateTasks(
            [new TaskUpdate { Id = 5, Priority = "high", Goal = "Docs" }, new TaskUpdate { Id = 6, Priority = "high" }], Ct));

        message.Should().Contain("x #5: Task #5 was saved (priority)")
            .And.Contain("resend only that item with just id and goal.")
            .And.Contain("x #6: not attempted");
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
