using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class ProjectRepositoryTests
{
    private static TaskDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    private static (TaskDbContext context, SqliteConnection connection) CreateSqliteContext()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new TaskDbContext(options);
        context.Database.EnsureCreated();
        return (context, connection);
    }

    [Fact]
    public async Task AddAsync_ShouldSetCreatedAt_AndUpdateAsyncShouldSetUpdatedAt()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);

        var project = await repo.AddAsync(new Project { Name = "Alpha" });
        Assert.NotEqual(default, project.CreatedAt);
        Assert.Null(project.UpdatedAt);

        project.Name = "Alpha 2";
        await repo.UpdateAsync(project);

        Assert.NotNull((await repo.GetByIdAsync(project.Id))!.UpdatedAt);
    }

    [Fact]
    public async Task GetAllAsync_ShouldReturnProjectsOrderedByName_WithTasks()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var b = await repo.AddAsync(new Project { Name = "Bravo" });
        await repo.AddAsync(new Project { Name = "Alpha" });
        context.TaskItems.Add(new TaskItem { Title = "T", ProjectId = b.Id });
        await context.SaveChangesAsync();

        var all = (await repo.GetAllAsync()).ToList();

        Assert.Equal(new[] { "Alpha", "Bravo" }, all.Select(p => p.Name).Where(n => n is "Alpha" or "Bravo"));
        Assert.Single(all.Single(p => p.Name == "Bravo").Tasks);
    }

    [Fact]
    public async Task NameExistsAsync_ShouldHonorExcludeId()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p = await repo.AddAsync(new Project { Name = "Alpha" });

        Assert.True(await repo.NameExistsAsync("Alpha"));
        Assert.False(await repo.NameExistsAsync("Alpha", p.Id));
        Assert.False(await repo.NameExistsAsync("Other"));
    }

    [Fact]
    public async Task GetTasksAsync_ShouldReturnOnlyProjectTasks()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p1 = await repo.AddAsync(new Project { Name = "A" });
        var p2 = await repo.AddAsync(new Project { Name = "B" });
        context.TaskItems.AddRange(
            new TaskItem { Title = "1", ProjectId = p1.Id },
            new TaskItem { Title = "2", ProjectId = p2.Id },
            new TaskItem { Title = "3" });
        await context.SaveChangesAsync();

        var tasks = (await repo.GetTasksAsync(p1.Id)).ToList();

        Assert.Equal("1", Assert.Single(tasks).Title);
        Assert.Equal("A", tasks[0].Project!.Name);
    }

    [Fact]
    public async Task DeleteAsync_ShouldNoOp_WhenMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);

        var act = () => repo.DeleteAsync(123);

        Assert.Null(await Record.ExceptionAsync(act));
    }

    [Fact]
    public async Task AssignTaskAsync_ShouldReturnProjectNotFound_AndTaskNotFound()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p = await repo.AddAsync(new Project { Name = "A" });

        Assert.Equal(AssignTaskResult.ProjectNotFound, (await repo.AssignTaskAsync(999, 1)));
        Assert.Equal(AssignTaskResult.TaskNotFound, (await repo.AssignTaskAsync(p.Id, 999)));
    }

    [Fact]
    public async Task AssignTaskAsync_ShouldAssign_RecordEvent_AndRejectDuplicate()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p = await repo.AddAsync(new Project { Name = "Alpha" });
        var task = new TaskItem { Title = "T" };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        Assert.Equal(AssignTaskResult.Success, (await repo.AssignTaskAsync(p.Id, task.Id)));
        Assert.Equal(AssignTaskResult.AlreadyAssigned, (await repo.AssignTaskAsync(p.Id, task.Id)));

        var saved = await context.TaskItems.AsNoTracking().SingleAsync();
        Assert.Equal(p.Id, saved.ProjectId);
        var events = await context.TaskItemEvents.Where(e => e.TaskItemId == task.Id).ToListAsync();
        var projectChanged = Assert.Single(events, e => e.EventType == "ProjectChanged");
        Assert.Equal("Assigned to project 'Alpha'.", projectChanged.ChangeSummary);
    }

    [Fact]
    public async Task AssignTaskAsync_ShouldMoveTaskBetweenProjects()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var a = await repo.AddAsync(new Project { Name = "A" });
        var b = await repo.AddAsync(new Project { Name = "B" });
        var task = new TaskItem { Title = "T", ProjectId = a.Id };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        Assert.Equal(AssignTaskResult.Success, (await repo.AssignTaskAsync(b.Id, task.Id)));

        Assert.Equal(b.Id, (await context.TaskItems.AsNoTracking().SingleAsync()).ProjectId);
        Assert.Equal("Project changed from 'A' to 'B'.", (await context.TaskItemEvents.SingleAsync()).ChangeSummary);
    }

    [Fact]
    public async Task UnassignTaskAsync_ShouldClearProject_AndRecordEvent()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p = await repo.AddAsync(new Project { Name = "Alpha" });
        var task = new TaskItem { Title = "T", ProjectId = p.Id };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        Assert.True(await repo.UnassignTaskAsync(p.Id, task.Id));

        Assert.Null((await context.TaskItems.AsNoTracking().SingleAsync()).ProjectId);
        Assert.Equal("Removed from project 'Alpha'.", (await context.TaskItemEvents.SingleAsync()).ChangeSummary);
    }

    [Fact]
    public async Task UnassignTaskAsync_ShouldReturnFalse_WhenTaskNotInProject()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p = await repo.AddAsync(new Project { Name = "Alpha" });
        var task = new TaskItem { Title = "T" };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        Assert.False(await repo.UnassignTaskAsync(p.Id, task.Id));
    }

    [Fact]
    public async Task DeleteAsync_ShouldKeepTasks_AndClearTheirProject_OnSqlite()
    {
        var (context, connection) = CreateSqliteContext();
        using (connection)
        using (context)
        {
            var repo = new ProjectRepository(context);
            var p = await repo.AddAsync(new Project { Name = "Alpha" });
            context.TaskItems.Add(new TaskItem { Title = "T", ProjectId = p.Id });
            await context.SaveChangesAsync();
            context.ChangeTracker.Clear();

            await repo.DeleteAsync(p.Id);

            var task = await context.TaskItems.AsNoTracking().SingleAsync();
            Assert.Null(task.ProjectId);
            Assert.Equal(0, (await context.Projects.CountAsync()));
        }
    }

    [Fact]
    public async Task Name_ShouldBeUniqueCaseInsensitively_OnSqlite()
    {
        var (context, connection) = CreateSqliteContext();
        using (connection)
        using (context)
        {
            var repo = new ProjectRepository(context);
            await repo.AddAsync(new Project { Name = "Alpha" });

            Assert.True(await repo.NameExistsAsync("alpha"));

            var act = () => repo.AddAsync(new Project { Name = "ALPHA" });
            await Assert.ThrowsAsync<DbUpdateException>(act);
        }
    }
}
