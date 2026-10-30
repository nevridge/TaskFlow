using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Real-stack tests for <see cref="ProjectsController"/>: real repository, real SQLite, one fresh
/// <see cref="TaskDbContext"/> per simulated request.
/// </summary>
public sealed class ProjectsControllerRealStackTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly RecordingInterceptor _interceptor = new();
    private readonly DbContextOptions<TaskDbContext> _options;

    public ProjectsControllerRealStackTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(_interceptor)
            .Options;
        using var ctx = new TaskDbContext(_options);
        ctx.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private sealed class RecordingInterceptor : SaveChangesInterceptor
    {
        public List<(string EntityType, EntityState State)> Saved { get; } = [];

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            Record(eventData);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Record(eventData);
            return ValueTask.FromResult(result);
        }

        private void Record(DbContextEventData eventData)
        {
            foreach (var entry in eventData.Context!.ChangeTracker.Entries()
                         .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            {
                Saved.Add((entry.Metadata.ClrType.Name, entry.State));
            }
        }
    }

    private static ProjectsController NewController(TaskDbContext ctx) =>
        new(new ProjectRepository(ctx), new ProjectValidator(), new Mock<FluentValidation.IValidator<AssignProjectTaskDto>>().Object);

    private async Task<int> SeedProjectWithTasksAsync()
    {
        await using var ctx = NewContext();
        var project = new Project { Name = "Alpha" };
        project.Tasks.Add(new TaskItem { Title = "T1" });
        project.Tasks.Add(new TaskItem { Title = "T2", Status = Status.Completed });
        ctx.Projects.Add(project);
        await ctx.SaveChangesAsync();
        _interceptor.Saved.Clear();
        return project.Id;
    }

    private TaskDbContext NewContext() => new(_options);

    [Fact]
    public async Task Update_Rename_DoesNotMarkTasksModified()
    {
        var projectId = await SeedProjectWithTasksAsync();
        await using (var ctx = NewContext())
        {
            var result = await NewController(ctx).Update(
                projectId, new UpdateProjectDto { Name = "Beta", Description = "d", IsArchived = false });

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var dto = Assert.IsType<ProjectResponseDto>(ok.Value);
            Assert.Equal("Beta", dto.Name);
            Assert.Equal(1, dto.OpenTaskCount);
            Assert.Equal(1, dto.CompletedTaskCount);
        }

        var modified = _interceptor.Saved.Where(s => s.State == EntityState.Modified).Select(s => s.EntityType).ToList();
        Assert.Equal(["Project"], modified);

        await using var verify = NewContext();
        Assert.Equal("Beta", (await verify.Projects.AsNoTracking().SingleAsync()).Name);
        Assert.Equal(2, await verify.TaskItems.CountAsync(t => t.ProjectId == projectId));
    }

    [Fact]
    public async Task Get_ReturnsTaskCountsWithoutTracking()
    {
        var projectId = await SeedProjectWithTasksAsync();
        await using var ctx = NewContext();

        var result = await NewController(ctx).Get(projectId);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<ProjectResponseDto>(ok.Value);
        Assert.Equal(1, dto.OpenTaskCount);
        Assert.Equal(1, dto.CompletedTaskCount);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task Delete_ClearsTaskProjects()
    {
        var projectId = await SeedProjectWithTasksAsync();
        await using (var ctx = NewContext())
        {
            Assert.IsType<NoContentResult>(await NewController(ctx).Delete(projectId));
        }

        await using var verify = NewContext();
        Assert.Empty(await verify.Projects.ToListAsync());
        Assert.All(await verify.TaskItems.ToListAsync(), t => Assert.Null(t.ProjectId));
    }
}
