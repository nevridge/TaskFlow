using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Real-stack tests (real repositories, real SQLite). Each simulated request gets a fresh
/// <see cref="TaskDbContext"/> on the shared connection, mirroring one scoped context per request.
/// </summary>
public sealed class JournalLogEntriesControllerRealStackTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly RecordingInterceptor _interceptor = new();
    private readonly DbContextOptions<TaskDbContext> _options;

    public JournalLogEntriesControllerRealStackTests()
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
        public List<(string EntityType, int Id, EntityState State)> Saved { get; } = [];

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
                Saved.Add((entry.Metadata.ClrType.Name, (int)(entry.Property("Id").CurrentValue ?? 0), entry.State));
            }
        }
    }

    private TaskDbContext NewContext() => new(_options);

    private static JournalLogEntriesController NewController(TaskDbContext ctx) =>
        new(
            new JournalEntryRepository(ctx),
            new JournalLogEntryRepository(ctx),
            new JournalLogEntryValidator(),
            new TaskRepository(ctx));

    private async Task<(int EntryId, int LogId, int OldId, int NewId)> SeedAsync(bool linkedToOld = true)
    {
        await using var ctx = NewContext();
        var entry = new JournalEntry { Title = "Day", Date = new DateOnly(2026, 5, 1) };
        var oldTask = new TaskItem { Title = "Old" };
        var newTask = new TaskItem { Title = "New" };
        ctx.AddRange(entry, oldTask, newTask);
        await ctx.SaveChangesAsync();

        var log = new JournalLogEntry
        {
            Content = "log",
            JournalEntryId = entry.Id,
            TaskItemId = linkedToOld ? oldTask.Id : null,
            LinkedTaskTitleSnapshot = linkedToOld ? "Old" : null
        };
        ctx.JournalLogEntries.Add(log);
        await ctx.SaveChangesAsync();
        return (entry.Id, log.Id, oldTask.Id, newTask.Id);
    }

    private async Task<JournalLogEntryResponseDto> UpdateAsync(int entryId, int logId, int? taskItemId)
    {
        await using var ctx = NewContext();
        var result = await NewController(ctx).Update(
            entryId, logId, new UpdateJournalLogEntryDto { Content = "log", TaskItemId = taskItemId });
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<JournalLogEntryResponseDto>(ok.Value);
    }

    private async Task<JournalLogEntry> ReloadAsync(int logId)
    {
        await using var ctx = NewContext();
        return await ctx.JournalLogEntries.AsNoTracking().SingleAsync(l => l.Id == logId);
    }

    [Fact]
    public async Task Update_RelinkToDifferentTask_ReturnsNewTaskTitleAndPersists()
    {
        var (entryId, logId, _, newId) = await SeedAsync();

        var dto = await UpdateAsync(entryId, logId, newId);

        Assert.Equal("New", dto.LinkedTaskTitle);
        Assert.Equal(newId, dto.TaskItemId);
        var persisted = await ReloadAsync(logId);
        Assert.Equal(newId, persisted.TaskItemId);
        Assert.Equal("New", persisted.LinkedTaskTitleSnapshot);
    }

    [Fact]
    public async Task Update_Unlink_ClearsLinkAndPersists()
    {
        var (entryId, logId, _, _) = await SeedAsync();

        var dto = await UpdateAsync(entryId, logId, null);

        Assert.Null(dto.TaskItemId);
        Assert.Null(dto.LinkedTaskTitle);
        var persisted = await ReloadAsync(logId);
        Assert.Null(persisted.TaskItemId);
        Assert.Null(persisted.LinkedTaskTitleSnapshot);
    }

    [Fact]
    public async Task Update_LinkFromPreviouslyUnlinked_ReturnsLinkedTitle()
    {
        var (entryId, logId, _, newId) = await SeedAsync(linkedToOld: false);

        var dto = await UpdateAsync(entryId, logId, newId);

        Assert.Equal("New", dto.LinkedTaskTitle);
        var persisted = await ReloadAsync(logId);
        Assert.Equal(newId, persisted.TaskItemId);
        Assert.Equal("New", persisted.LinkedTaskTitleSnapshot);
    }

    [Fact]
    public async Task Update_RelinkWhenOldTaskDeleted_ReturnsNewTaskTitle()
    {
        var (entryId, logId, oldId, newId) = await SeedAsync();
        await using (var ctx = NewContext())
        {
            await new TaskRepository(ctx).DeleteAsync(oldId);
        }

        var dto = await UpdateAsync(entryId, logId, newId);

        Assert.Equal("New", dto.LinkedTaskTitle);
        var persisted = await ReloadAsync(logId);
        Assert.Equal(newId, persisted.TaskItemId);
        Assert.Equal("New", persisted.LinkedTaskTitleSnapshot);
    }

    [Fact]
    public async Task Update_RelinkDoesNotModifyLinkedTasks()
    {
        var (entryId, logId, oldId, newId) = await SeedAsync();

        _interceptor.Saved.Clear();

        await UpdateAsync(entryId, logId, newId);

        // The newly linked task comes from an untracked lookup, so it must never be written.
        // (The previously Included old task may be marked Modified by UpdateAsync as before this change; values are identical.)
        Assert.DoesNotContain(_interceptor.Saved, s => s.EntityType == nameof(TaskItem) && s.Id == newId);
        Assert.Contains(_interceptor.Saved, s => s.EntityType == nameof(JournalLogEntry) && s.Id == logId && s.State == EntityState.Modified);

        await using var ctx = NewContext();
        var tasks = await ctx.TaskItems.AsNoTracking().ToListAsync();
        Assert.Equal("Old", tasks.Single(t => t.Id == oldId).Title);
        Assert.Equal("New", tasks.Single(t => t.Id == newId).Title);
        Assert.All(tasks, t => Assert.Equal(Status.Draft, t.Status));
    }

    [Fact]
    public async Task Delete_AfterNoTrackingLookup_RemovesRow()
    {
        var (entryId, logId, _, _) = await SeedAsync();

        await using (var ctx = NewContext())
        {
            var result = await NewController(ctx).Delete(entryId, logId);
            Assert.IsType<NoContentResult>(result);
        }

        await using var verify = NewContext();
        Assert.False(await verify.JournalLogEntries.AnyAsync(l => l.Id == logId));
    }

    [Fact]
    public async Task Update_NonExistentTask_ReturnsBadRequest()
    {
        var (entryId, logId, oldId, _) = await SeedAsync();
        await using var ctx = NewContext();

        var result = await NewController(ctx).Update(
            entryId, logId, new UpdateJournalLogEntryDto { Content = "log", TaskItemId = 9999 });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var persisted = await ReloadAsync(logId);
        Assert.Equal(oldId, persisted.TaskItemId);
    }

    [Fact]
    public async Task GetAll_ReturnsLinkedTitleWithoutTracking()
    {
        var (entryId, _, _, _) = await SeedAsync();
        await using var ctx = NewContext();

        var result = await NewController(ctx).GetAll(entryId);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var items = Assert.IsAssignableFrom<IEnumerable<JournalLogEntryResponseDto>>(ok.Value);
        Assert.Equal("Old", Assert.Single(items).LinkedTaskTitle);
        Assert.Empty(ctx.ChangeTracker.Entries());
    }
}
