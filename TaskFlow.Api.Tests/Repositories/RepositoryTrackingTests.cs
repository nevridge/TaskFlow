using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Mappers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

/// <summary>
/// Pins change-tracking behavior of the repository read paths: read-only queries return untracked entities
/// (with Includes still populated), while the tracked <c>GetByIdAsync</c> methods used by load-then-mutate flows
/// keep tracking. Every read uses a fresh context so Includes really execute against the database.
/// </summary>
public sealed class RepositoryTrackingTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly DbContextOptions<TaskDbContext> _options;

    public RepositoryTrackingTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options;
        using var ctx = new TaskDbContext(_options);
        ctx.Database.EnsureCreated();
    }

    public void Dispose() => _connection.Dispose();

    private TaskDbContext NewContext() => new(_options);

    private sealed record Seed(int ProjectId, int ParentId, int ChildId, int EntryId, int NoteId, int JournalNoteId, int LogId);

    private async Task<Seed> SeedAsync()
    {
        await using var ctx = NewContext();
        var project = new Project { Name = "Proj" };
        var parent = new TaskItem { Title = "Parent", Project = project };
        var entry = new JournalEntry { Title = "Day", Date = new DateOnly(2026, 5, 1) };
        ctx.AddRange(project, parent, entry);
        await ctx.SaveChangesAsync();

        var child = new TaskItem { Title = "Child", ParentTaskItemId = parent.Id, ProjectId = project.Id };
        var note = new Note { Content = "n", TaskItemId = parent.Id };
        var journalNote = new JournalNote { Content = "jn", JournalEntryId = entry.Id };
        var log = new JournalLogEntry
        {
            Content = "log",
            JournalEntryId = entry.Id,
            TaskItemId = parent.Id,
            LinkedTaskTitleSnapshot = "snapshot"
        };
        ctx.AddRange(child, note, journalNote, log);
        ctx.TaskItemEvents.Add(new TaskItemEvent
        {
            TaskItemId = parent.Id,
            EventType = "TaskCreated",
            OccurredAtUtc = DateTime.UtcNow,
            ChangeSummary = "x"
        });
        await ctx.SaveChangesAsync();
        return new Seed(project.Id, parent.Id, child.Id, entry.Id, note.Id, journalNote.Id, log.Id);
    }

    // ---- TaskRepository ----

    [Fact]
    public async Task TaskGetAllAsync_ReturnsUntrackedWithProject()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = (await new TaskRepository(ctx).GetAllAsync()).ToList();

        Assert.Equal("Proj", result.Single(t => t.Id == seed.ParentId).Project?.Name);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task TaskGetChildrenAsync_ReturnsUntracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = (await new TaskRepository(ctx).GetChildrenAsync(seed.ParentId)).ToList();

        Assert.Equal(seed.ChildId, Assert.Single(result).Id);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task TaskGetHistoryAsync_ReturnsUntrackedOrderedEvents()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = (await new TaskRepository(ctx).GetHistoryAsync(seed.ParentId)).ToList();

        Assert.Equal("TaskCreated", Assert.Single(result).EventType);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task TaskGetByIdNoTrackingAsync_ReturnsUntrackedWithProject()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new TaskRepository(ctx).GetByIdNoTrackingAsync(seed.ParentId);

        Assert.Equal("Proj", result?.Project?.Name);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task TaskGetByIdNoTrackingAsync_ReturnsNull_WhenMissing()
    {
        await using var ctx = NewContext();

        Assert.Null(await new TaskRepository(ctx).GetByIdNoTrackingAsync(999));
    }

    [Fact]
    public async Task TaskGetByIdAsync_ReturnsTracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new TaskRepository(ctx).GetByIdAsync(seed.ParentId);

        Assert.NotNull(result);
        Assert.Equal(EntityState.Unchanged, ctx.Entry(result).State);
    }

    [Fact]
    public async Task TaskTrackedLoadMutateUpdate_PersistsChange()
    {
        var seed = await SeedAsync();
        await using (var requestCtx = NewContext())
        {
            var repo = new TaskRepository(requestCtx);
            var task = await repo.GetByIdAsync(seed.ParentId);
            Assert.NotNull(task);
            task.Title = "Renamed";
            task.Status = Status.Todo;
            await repo.UpdateAsync(task);
        }

        await using var verify = NewContext();
        var persisted = await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == seed.ParentId);
        Assert.Equal("Renamed", persisted.Title);
        Assert.Equal(Status.Todo, persisted.Status);
    }

    // ---- ProjectRepository ----

    [Fact]
    public async Task ProjectGetTasksAsync_ReturnsUntrackedWithProject()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = (await new ProjectRepository(ctx).GetTasksAsync(seed.ProjectId)).ToList();

        Assert.Equal(2, result.Count);
        Assert.All(result, t => Assert.Equal("Proj", t.Project?.Name));
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task ProjectGetByIdNoTrackingAsync_ReturnsUntrackedWithTasks()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new ProjectRepository(ctx).GetByIdNoTrackingAsync(seed.ProjectId);

        Assert.Equal(2, result?.Tasks.Count);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task ProjectGetByIdAsync_ReturnsTracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new ProjectRepository(ctx).GetByIdAsync(seed.ProjectId);

        Assert.NotNull(result);
        Assert.Equal(EntityState.Unchanged, ctx.Entry(result).State);
        Assert.Equal(2, result.Tasks.Count);
    }

    // ---- NoteRepository ----

    [Fact]
    public async Task NoteGetAllByTaskIdAsync_ReturnsUntracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = (await new NoteRepository(ctx).GetAllByTaskIdAsync(seed.ParentId)).ToList();

        Assert.Single(result);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task NoteGetByIdNoTrackingAsync_ReturnsUntracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new NoteRepository(ctx).GetByIdNoTrackingAsync(seed.ParentId, seed.NoteId);

        Assert.Equal("n", result?.Content);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task NoteGetByIdAsync_ReturnsTracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new NoteRepository(ctx).GetByIdAsync(seed.ParentId, seed.NoteId);

        Assert.NotNull(result);
        Assert.Equal(EntityState.Unchanged, ctx.Entry(result).State);
    }

    // ---- JournalNoteRepository ----

    [Fact]
    public async Task JournalNoteGetAllByEntryIdAsync_ReturnsUntracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = (await new JournalNoteRepository(ctx).GetAllByEntryIdAsync(seed.EntryId)).ToList();

        Assert.Single(result);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task JournalNoteGetByIdNoTrackingAsync_ReturnsUntracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new JournalNoteRepository(ctx).GetByIdNoTrackingAsync(seed.EntryId, seed.JournalNoteId);

        Assert.Equal("jn", result?.Content);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task JournalNoteGetByIdAsync_ReturnsTracked()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = await new JournalNoteRepository(ctx).GetByIdAsync(seed.EntryId, seed.JournalNoteId);

        Assert.NotNull(result);
        Assert.Equal(EntityState.Unchanged, ctx.Entry(result).State);
    }

    // ---- JournalLogEntryRepository ----

    [Fact]
    public async Task LogGetAllByEntryIdAsync_ReturnsUntrackedWithTaskItem()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var result = (await new JournalLogEntryRepository(ctx).GetAllByEntryIdAsync(seed.EntryId)).ToList();

        var log = Assert.Single(result);
        Assert.Equal("Parent", log.TaskItem?.Title);
        Assert.Equal("Parent", JournalLogEntryMapper.ToDto(log).LinkedTaskTitle);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task LogGetByIdNoTrackingAsync_ReturnsUntrackedWithTaskItem()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var log = await new JournalLogEntryRepository(ctx).GetByIdNoTrackingAsync(seed.EntryId, seed.LogId);

        Assert.NotNull(log);
        Assert.Equal("Parent", log.TaskItem?.Title);
        Assert.Equal("Parent", JournalLogEntryMapper.ToDto(log).LinkedTaskTitle);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }

    [Fact]
    public async Task LogGetByIdAsync_ReturnsTrackedWithTaskItem()
    {
        var seed = await SeedAsync();
        await using var ctx = NewContext();

        var log = await new JournalLogEntryRepository(ctx).GetByIdAsync(seed.EntryId, seed.LogId);

        Assert.NotNull(log);
        Assert.Equal(EntityState.Unchanged, ctx.Entry(log).State);
        Assert.Equal("Parent", log.TaskItem?.Title);
    }
}
