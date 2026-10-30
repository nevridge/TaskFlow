using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Real-stack tests for <see cref="TaskItemsController"/> around read-path change tracking: real repositories,
/// real SQLite, one fresh <see cref="TaskDbContext"/> per simulated request.
/// </summary>
public sealed class TaskItemsControllerRealStackTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly DbContextOptions<TaskDbContext> _options;

    public TaskItemsControllerRealStackTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options;
        using var ctx = new TaskDbContext(_options);
        ctx.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private TaskDbContext NewContext() => new(_options);

    private static TaskItemsController NewController(TaskDbContext ctx) =>
        new(new TaskRepository(ctx), new TaskItemValidator(), new JournalEntryRepository(ctx), new ProjectRepository(ctx));

    [Fact]
    public async Task Update_TrackedLoad_PersistsChanges()
    {
        int id;
        await using (var seed = NewContext())
        {
            var task = new TaskItem { Title = "Original", Status = Status.Todo };
            seed.TaskItems.Add(task);
            await seed.SaveChangesAsync();
            id = task.Id;
        }

        await using (var ctx = NewContext())
        {
            var result = await NewController(ctx).Update(
                id, new UpdateTaskItemDto { Title = "Changed", Status = Status.Completed });
            Assert.IsType<OkObjectResult>(result.Result);
        }

        await using var verify = NewContext();
        var persisted = await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);
        Assert.Equal("Changed", persisted.Title);
        Assert.Equal(Status.Completed, persisted.Status);
    }

    [Fact]
    public async Task Update_LastChildCompletedWithAutoComplete_CompletesParent()
    {
        int parentId, childId;
        await using (var seed = NewContext())
        {
            var parent = new TaskItem { Title = "Parent", Status = Status.Todo };
            seed.TaskItems.Add(parent);
            await seed.SaveChangesAsync();
            var child = new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id };
            seed.TaskItems.Add(child);
            await seed.SaveChangesAsync();
            parentId = parent.Id;
            childId = child.Id;
        }

        await using (var ctx = NewContext())
        {
            var result = await NewController(ctx).Update(childId, new UpdateTaskItemDto
            {
                Title = "Child",
                Status = Status.Completed,
                ParentTaskItemId = parentId,
                AutoCompleteParentWhenChildrenDone = true
            });
            Assert.IsType<OkObjectResult>(result.Result);
        }

        await using var verify = NewContext();
        Assert.Equal(Status.Completed, (await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == parentId)).Status);
    }

    [Fact]
    public async Task Create_WithProjectAndParent_ReturnsPersistedProjectNameAndParentLink()
    {
        int projectId, parentId;
        await using (var seed = NewContext())
        {
            var project = new Project { Name = "Proj" };
            var parent = new TaskItem { Title = "Parent" };
            seed.AddRange(project, parent);
            await seed.SaveChangesAsync();
            projectId = project.Id;
            parentId = parent.Id;
        }

        var journalDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
        await using var ctx = NewContext();
        var result = await NewController(ctx).Create(new CreateTaskItemDto
        {
            Title = "Child",
            Status = Status.Todo,
            ProjectId = projectId,
            ParentTaskItemId = parentId,
            JournalDate = journalDate
        });

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var dto = Assert.IsType<TaskItemResponseDto>(created.Value);
        Assert.Equal("Proj", dto.ProjectName);
        Assert.Equal(projectId, dto.ProjectId);
        Assert.Equal(parentId, dto.ParentTaskItemId);
        Assert.Equal("Todo", dto.Status);
        Assert.Equal(journalDate, dto.CurrentJournalDate);
        Assert.NotNull(dto.CurrentJournalEntryId);
        Assert.Equal(0, dto.ChildTaskCount);
    }

    [Fact]
    public async Task Delete_AfterNoTrackingLookup_RemovesRow()
    {
        int id;
        await using (var seed = NewContext())
        {
            var task = new TaskItem { Title = "Doomed" };
            seed.TaskItems.Add(task);
            await seed.SaveChangesAsync();
            id = task.Id;
        }

        await using (var ctx = NewContext())
        {
            var result = await NewController(ctx).Delete(id);
            Assert.IsType<NoContentResult>(result);
        }

        await using var verify = NewContext();
        Assert.False(await verify.TaskItems.AnyAsync(t => t.Id == id));
    }

    [Fact]
    public async Task Get_ReturnsProjectNameAndLeavesTrackerEmpty()
    {
        int id;
        await using (var seed = NewContext())
        {
            var project = new Project { Name = "Proj" };
            var task = new TaskItem { Title = "T", Project = project };
            seed.TaskItems.Add(task);
            await seed.SaveChangesAsync();
            id = task.Id;
        }

        await using var ctx = NewContext();
        var result = await NewController(ctx).Get(id);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("Proj", Assert.IsType<TaskItemResponseDto>(ok.Value).ProjectName);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }
}
