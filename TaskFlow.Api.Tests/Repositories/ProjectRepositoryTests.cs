using FluentAssertions;
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
        project.CreatedAt.Should().NotBe(default);
        project.UpdatedAt.Should().BeNull();

        project.Name = "Alpha 2";
        await repo.UpdateAsync(project);

        (await repo.GetByIdAsync(project.Id))!.UpdatedAt.Should().NotBeNull();
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

        all.Select(p => p.Name).Should().ContainInOrder("Alpha", "Bravo");
        all.Single(p => p.Name == "Bravo").Tasks.Should().HaveCount(1);
    }

    [Fact]
    public async Task NameExistsAsync_ShouldHonorExcludeId()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p = await repo.AddAsync(new Project { Name = "Alpha" });

        (await repo.NameExistsAsync("Alpha")).Should().BeTrue();
        (await repo.NameExistsAsync("Alpha", p.Id)).Should().BeFalse();
        (await repo.NameExistsAsync("Other")).Should().BeFalse();
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

        tasks.Should().ContainSingle().Which.Title.Should().Be("1");
        tasks[0].Project!.Name.Should().Be("A");
    }

    [Fact]
    public async Task DeleteAsync_ShouldNoOp_WhenMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);

        var act = () => repo.DeleteAsync(123);

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task AssignTaskAsync_ShouldReturnProjectNotFound_AndTaskNotFound()
    {
        using var context = CreateInMemoryContext();
        var repo = new ProjectRepository(context);
        var p = await repo.AddAsync(new Project { Name = "A" });

        (await repo.AssignTaskAsync(999, 1)).Should().Be(AssignTaskResult.ProjectNotFound);
        (await repo.AssignTaskAsync(p.Id, 999)).Should().Be(AssignTaskResult.TaskNotFound);
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

        (await repo.AssignTaskAsync(p.Id, task.Id)).Should().Be(AssignTaskResult.Success);
        (await repo.AssignTaskAsync(p.Id, task.Id)).Should().Be(AssignTaskResult.AlreadyAssigned);

        var saved = await context.TaskItems.AsNoTracking().SingleAsync();
        saved.ProjectId.Should().Be(p.Id);
        var events = await context.TaskItemEvents.Where(e => e.TaskItemId == task.Id).ToListAsync();
        events.Should().ContainSingle(e => e.EventType == "ProjectChanged")
            .Which.ChangeSummary.Should().Be("Assigned to project 'Alpha'.");
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

        (await repo.AssignTaskAsync(b.Id, task.Id)).Should().Be(AssignTaskResult.Success);

        (await context.TaskItems.AsNoTracking().SingleAsync()).ProjectId.Should().Be(b.Id);
        (await context.TaskItemEvents.SingleAsync()).ChangeSummary.Should().Be("Project changed from 'A' to 'B'.");
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

        (await repo.UnassignTaskAsync(p.Id, task.Id)).Should().BeTrue();

        (await context.TaskItems.AsNoTracking().SingleAsync()).ProjectId.Should().BeNull();
        (await context.TaskItemEvents.SingleAsync()).ChangeSummary.Should().Be("Removed from project 'Alpha'.");
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

        (await repo.UnassignTaskAsync(p.Id, task.Id)).Should().BeFalse();
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
            task.ProjectId.Should().BeNull();
            (await context.Projects.CountAsync()).Should().Be(0);
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

            (await repo.NameExistsAsync("alpha")).Should().BeTrue();

            var act = () => repo.AddAsync(new Project { Name = "ALPHA" });
            await act.Should().ThrowAsync<DbUpdateException>();
        }
    }
}
