using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Tests.Repositories;

/// <summary>Real SQLite with a fresh context per call, so transactions and cascades behave as in production.</summary>
public sealed class GoalRepositoryTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly DbContextOptions<TaskDbContext> _options;
    private readonly int _projectId;

    public GoalRepositoryTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options;
        using var ctx = NewContext();
        ctx.Database.EnsureCreated();
        _projectId = AddProject("Alpha");
    }

    public void Dispose() => _connection.Dispose();

    private TaskDbContext NewContext() => new(_options);

    private int AddProject(string name)
    {
        using var ctx = NewContext();
        var project = new Project { Name = name };
        ctx.Projects.Add(project);
        ctx.SaveChanges();
        return project.Id;
    }

    private async Task<T> RunAsync<T>(Func<GoalRepository, Task<T>> action)
    {
        await using var ctx = NewContext();
        return await action(new GoalRepository(ctx));
    }

    private async Task<int> CreateAsync(string title, GoalStatus status = GoalStatus.Next, int? projectId = null)
    {
        var result = await RunAsync(r => r.CreateAsync(
            new Goal { ProjectId = projectId ?? _projectId, Title = title, Status = status }));
        Assert.Equal(GoalWriteStatus.Success, result.Status);
        return result.GoalId;
    }

    private Task<GoalWriteResult> SetStatusAsync(int id, GoalStatus status, string? reason = null) =>
        RunAsync(r => r.UpdateAsync(id, new Goal { Title = "t" + id, Status = status, ParkedReason = reason }));

    private async Task<Goal> GetAsync(int id) => (await RunAsync(r => r.GetByIdAsync(id)))!;

    private int AddTask(Status status, int? goalId = null, int? parentId = null, int? projectId = null)
    {
        using var ctx = NewContext();
        var task = new TaskItem
        {
            Title = "task",
            Status = status,
            GoalId = goalId,
            ParentTaskItemId = parentId,
            ProjectId = projectId ?? _projectId,
        };
        ctx.TaskItems.Add(task);
        ctx.SaveChanges();
        return task.Id;
    }

    private TaskItem StoredTask(int id)
    {
        using var ctx = NewContext();
        return ctx.TaskItems.Single(t => t.Id == id);
    }

    [Fact]
    public async Task GetAll_OrdersNowNextParkedClosed_AndCountsTasks()
    {
        var dropped = await CreateAsync("dropped");
        var parkedFirst = await CreateAsync("parked first");
        var nextA = await CreateAsync("next a");
        var done = await CreateAsync("done");
        var nextB = await CreateAsync("next b");
        var parkedLast = await CreateAsync("parked last");
        var now = await CreateAsync("now", GoalStatus.Now);
        await SetStatusAsync(dropped, GoalStatus.Dropped);
        await SetStatusAsync(parkedFirst, GoalStatus.Parked, "r");
        await SetStatusAsync(done, GoalStatus.Done);
        await SetStatusAsync(parkedLast, GoalStatus.Parked, "r");
        AddTask(Status.Blocked, now);
        AddTask(Status.Todo, now);
        AddTask(Status.Completed, now);

        var goals = await RunAsync(r => r.GetAllAsync(_projectId));

        Assert.Equal([now, nextA, nextB, parkedLast, parkedFirst, done, dropped], goals.Select(g => g.Id));
        Assert.Equal(2, goals[0].Tasks.Count(t => t.Status != Status.Completed));
        Assert.Equal(3, goals[0].Tasks.Count);
    }

    [Fact]
    public async Task Create_RefusesASecondNowAndAnUnknownProject()
    {
        await CreateAsync("now", GoalStatus.Now);

        var second = await RunAsync(r => r.CreateAsync(new Goal { ProjectId = _projectId, Title = "x", Status = GoalStatus.Now }));
        var orphan = await RunAsync(r => r.CreateAsync(new Goal { ProjectId = 999, Title = "x" }));
        var elsewhere = await CreateAsync("now", GoalStatus.Now, AddProject("Beta"));

        Assert.Equal(GoalWriteStatus.NowExists, second.Status);
        Assert.Equal(GoalWriteStatus.ProjectNotFound, orphan.Status);
        Assert.True(elsewhere > 0);
        Assert.Single(await RunAsync(r => r.GetAllAsync(_projectId)));
    }

    [Fact]
    public async Task Update_TracksStatusDates_ReasonAndNextOrder()
    {
        var a = await CreateAsync("a");
        var b = await CreateAsync("b");

        await SetStatusAsync(a, GoalStatus.Parked, "waiting");
        var parked = await GetAsync(a);
        await SetStatusAsync(a, GoalStatus.Parked, "still waiting");
        var edited = await GetAsync(a);

        Assert.Equal("still waiting", edited.ParkedReason);
        Assert.Equal(parked.StatusChangedAt, edited.StatusChangedAt);
        Assert.Null(edited.ClosedAt);

        await SetStatusAsync(a, GoalStatus.Done);
        var done = await GetAsync(a);
        await SetStatusAsync(a, GoalStatus.Done);
        var resaved = await GetAsync(a);
        await SetStatusAsync(a, GoalStatus.Dropped);
        var dropped = await GetAsync(a);

        Assert.Null(done.ParkedReason);
        Assert.NotNull(done.ClosedAt);
        Assert.Equal(done.ClosedAt, resaved.ClosedAt);
        Assert.True(dropped.ClosedAt > done.ClosedAt);

        await SetStatusAsync(a, GoalStatus.Next);
        var reopened = await GetAsync(a);

        Assert.Null(reopened.ClosedAt);
        Assert.True(reopened.DisplayOrder > (await GetAsync(b)).DisplayOrder);
    }

    [Theory]
    [InlineData(GoalStatus.Next)]
    [InlineData(GoalStatus.Parked)]
    public async Task Update_KeepsTheNowGoal_WhileItHasTasksInProgress(GoalStatus target)
    {
        var now = await CreateAsync("now", GoalStatus.Now);
        var running = AddTask(Status.InProgress, now);
        AddTask(Status.Todo, now);

        var result = await SetStatusAsync(now, target, "r");

        Assert.Equal(GoalWriteStatus.NowHasInProgressTasks, result.Status);
        Assert.Equal(running, Assert.Single(result.Tasks!).Id);
        var stored = await GetAsync(now);
        Assert.Equal(GoalStatus.Now, stored.Status);
        Assert.Equal("now", stored.Title);
    }

    [Theory]
    [InlineData(GoalStatus.Done)]
    [InlineData(GoalStatus.Dropped)]
    public async Task Update_RefusesToCloseAGoalWithOpenTasks(GoalStatus target)
    {
        var goal = await CreateAsync("goal");
        var open = AddTask(Status.Todo, goal);
        var subtask = AddTask(Status.Draft, goal, parentId: open);
        AddTask(Status.Completed, goal);

        var result = await SetStatusAsync(goal, target);

        Assert.Equal(GoalWriteStatus.HasOpenTasks, result.Status);
        Assert.Equal([open, subtask], result.Tasks!.Select(t => t.Id));
        Assert.Equal(GoalStatus.Next, (await GetAsync(goal)).Status);
    }

    [Fact]
    public async Task SwapNow_PutsTheOldNowAtTheTopOfNext()
    {
        var old = await CreateAsync("old", GoalStatus.Now);
        var a = await CreateAsync("a");
        var target = await CreateAsync("target");
        var b = await CreateAsync("b");

        var result = await RunAsync(r => r.SwapNowAsync(target));

        Assert.Equal(GoalWriteStatus.Success, result.Status);
        var goals = await RunAsync(r => r.GetAllAsync(_projectId));
        Assert.Equal([target, old, a, b], goals.Select(g => g.Id));
        Assert.Equal([GoalStatus.Now, GoalStatus.Next, GoalStatus.Next, GoalStatus.Next], goals.Select(g => g.Status));
        Assert.Equal([0, 1, 2], goals.Skip(1).Select(g => g.DisplayOrder));
    }

    [Fact]
    public async Task SwapNow_ChangesNothing_WhenTheNowGoalHasASubtaskInProgress()
    {
        var old = await CreateAsync("old", GoalStatus.Now);
        var target = await CreateAsync("target");
        var parent = AddTask(Status.Todo, old);
        var running = AddTask(Status.InProgress, old, parentId: parent);

        var result = await RunAsync(r => r.SwapNowAsync(target));

        Assert.Equal(GoalWriteStatus.NowHasInProgressTasks, result.Status);
        Assert.Equal(old, result.GoalId);
        Assert.Equal(running, Assert.Single(result.Tasks!).Id);
        Assert.Equal(GoalStatus.Now, (await GetAsync(old)).Status);
        Assert.Equal(GoalStatus.Next, (await GetAsync(target)).Status);
    }

    [Fact]
    public async Task SwapNow_HandlesNoNowGoal_TheNowGoalItself_AndAClosedGoal()
    {
        var parked = await CreateAsync("parked");
        await SetStatusAsync(parked, GoalStatus.Parked, "r");
        var done = await CreateAsync("done");
        await SetStatusAsync(done, GoalStatus.Done);

        var first = await RunAsync(r => r.SwapNowAsync(parked));
        var swapped = await GetAsync(parked);
        var again = await RunAsync(r => r.SwapNowAsync(parked));
        var closed = await RunAsync(r => r.SwapNowAsync(done));

        Assert.Equal(GoalWriteStatus.Success, first.Status);
        Assert.Equal(GoalStatus.Now, swapped.Status);
        Assert.Null(swapped.ParkedReason);
        Assert.Equal(GoalWriteStatus.Success, again.Status);
        Assert.Equal(swapped.StatusChangedAt, (await GetAsync(parked)).StatusChangedAt);
        Assert.Equal(GoalWriteStatus.Closed, closed.Status);
    }

    [Fact]
    public async Task Reorder_AcceptsOnlyAnExactPermutationOfTheNextGoals()
    {
        var now = await CreateAsync("now", GoalStatus.Now);
        var a = await CreateAsync("a");
        var b = await CreateAsync("b");
        var foreign = await CreateAsync("foreign", projectId: AddProject("Beta"));

        foreach (var bad in new int[][] { [a], [a, a], [a, foreign], [b, a, now] })
        {
            Assert.False(await RunAsync(r => r.ReorderAsync(_projectId, bad)));
        }

        Assert.Equal([now, a, b], (await RunAsync(r => r.GetAllAsync(_projectId))).Select(g => g.Id));
        Assert.True(await RunAsync(r => r.ReorderAsync(_projectId, [b, a])));
        Assert.Equal([now, b, a], (await RunAsync(r => r.GetAllAsync(_projectId))).Select(g => g.Id));
    }

    [Fact]
    public async Task Delete_KeepsTheTasksWithoutAGoal()
    {
        var now = await CreateAsync("now", GoalStatus.Now);
        var task = AddTask(Status.InProgress, now);

        Assert.True(await RunAsync(r => r.DeleteAsync(now)));

        Assert.Null(StoredTask(task).GoalId);
        Assert.Equal(_projectId, StoredTask(task).ProjectId);
        Assert.False(await RunAsync(r => r.DeleteAsync(now)));
    }

    [Fact]
    public async Task ProjectDelete_RemovesItsGoals_AndLeavesTasksUnlinked()
    {
        var goal = await CreateAsync("goal");
        var task = AddTask(Status.Todo, goal);

        await using (var ctx = NewContext())
        {
            await new ProjectRepository(ctx).DeleteAsync(_projectId);
        }

        Assert.Null(await RunAsync(r => r.GetByIdAsync(goal)));
        Assert.Null(StoredTask(task).GoalId);
        Assert.Null(StoredTask(task).ProjectId);
    }

    [Fact]
    public async Task AssignAndRemove_CarryTheSubtasksInTheGoalsProject()
    {
        var goal = await CreateAsync("goal");
        var parent = AddTask(Status.Todo);
        var child = AddTask(Status.Todo, parentId: parent);
        var outside = AddTask(Status.InProgress, parentId: parent, projectId: AddProject("Beta"));

        var assigned = await RunAsync(r => r.AssignTaskAsync(goal, parent));

        Assert.Equal(AssignGoalTaskStatus.Success, assigned.Status);
        Assert.Equal(goal, StoredTask(parent).GoalId);
        Assert.Equal(goal, StoredTask(child).GoalId);
        Assert.Null(StoredTask(outside).GoalId);

        Assert.Equal(RemoveGoalTaskResult.Success, await RunAsync(r => r.RemoveTaskAsync(goal, parent)));
        Assert.Null(StoredTask(parent).GoalId);
        Assert.Null(StoredTask(child).GoalId);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Assign_RefusesWorkInProgressIntoAGoalThatIsNotNow(bool inProgressIsSubtask)
    {
        await CreateAsync("now", GoalStatus.Now);
        var next = await CreateAsync("next");
        var parent = AddTask(inProgressIsSubtask ? Status.Todo : Status.InProgress);
        var child = AddTask(inProgressIsSubtask ? Status.InProgress : Status.Todo, parentId: parent);

        var result = await RunAsync(r => r.AssignTaskAsync(next, parent));

        Assert.Equal(AssignGoalTaskStatus.GoalNotNow, result.Status);
        Assert.Equal("now", result.NowGoal!.Title);
        Assert.Null(StoredTask(parent).GoalId);
        Assert.Null(StoredTask(child).GoalId);
    }

    [Fact]
    public async Task Assign_AllowsWorkInProgress_WhenTheProjectHasNoNowGoal()
    {
        var next = await CreateAsync("next");
        var task = AddTask(Status.InProgress);

        Assert.Equal(AssignGoalTaskStatus.Success, (await RunAsync(r => r.AssignTaskAsync(next, task))).Status);
    }

    /// <summary>Races are accepted, so two Now goals can exist; no read of the Now goal may assume there is one.</summary>
    [Fact]
    public async Task TwoNowGoals_LeftByARace_DoNotBreakReadsOrWrites()
    {
        var first = await CreateAsync("first", GoalStatus.Now);
        var second = await CreateAsync("second");
        var next = await CreateAsync("next");
        await using (var ctx = NewContext())
        {
            (await ctx.Goals.SingleAsync(g => g.Id == second, TestContext.Current.CancellationToken)).Status = GoalStatus.Now;
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        await using (var ctx = NewContext())
        {
            Assert.NotNull(await new TaskRepository(ctx).GetBlockingNowGoalAsync(next));
        }

        var third = await RunAsync(r => r.CreateAsync(new Goal { ProjectId = _projectId, Title = "x", Status = GoalStatus.Now }));
        var swap = await RunAsync(r => r.SwapNowAsync(next));

        Assert.Equal(GoalWriteStatus.NowExists, third.Status);
        Assert.Equal(GoalWriteStatus.Success, swap.Status);
        Assert.Equal(GoalStatus.Now, (await GetAsync(next)).Status);
        Assert.Contains(first, (await RunAsync(r => r.GetAllAsync(_projectId))).Select(g => g.Id));
    }

    [Fact]
    public async Task Assign_And_Remove_RejectTargetsThatCannotTakeAGoal()
    {
        var goal = await CreateAsync("goal");
        var closed = await CreateAsync("closed");
        await SetStatusAsync(closed, GoalStatus.Dropped);
        var task = AddTask(Status.Todo);
        var child = AddTask(Status.Todo, parentId: task);
        var elsewhere = AddTask(Status.Todo, projectId: AddProject("Beta"));

        async Task<AssignGoalTaskStatus> Assign(int goalId, int taskId) =>
            (await RunAsync(r => r.AssignTaskAsync(goalId, taskId))).Status;

        Assert.Equal(AssignGoalTaskStatus.GoalNotFound, await Assign(999, task));
        Assert.Equal(AssignGoalTaskStatus.TaskNotFound, await Assign(goal, 999));
        Assert.Equal(AssignGoalTaskStatus.IsSubtask, await Assign(goal, child));
        Assert.Equal(AssignGoalTaskStatus.WrongProject, await Assign(goal, elsewhere));
        Assert.Equal(AssignGoalTaskStatus.GoalClosed, await Assign(closed, task));
        Assert.Equal(AssignGoalTaskStatus.Success, await Assign(goal, task));
        Assert.Equal(AssignGoalTaskStatus.AlreadyAssigned, await Assign(goal, task));
        Assert.Equal(RemoveGoalTaskResult.IsSubtask, await RunAsync(r => r.RemoveTaskAsync(goal, child)));
        Assert.Equal(RemoveGoalTaskResult.NotFound, await RunAsync(r => r.RemoveTaskAsync(closed, task)));
        Assert.Equal(goal, StoredTask(task).GoalId);
    }
}
