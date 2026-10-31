using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

/// <summary>
/// Characterization tests: when a repository's UpdateAsync is called on an entity that is already tracked
/// (loaded via GetByIdAsync with an Include), only the root entity may be written. Related, already-tracked
/// entities (the old linked TaskItem, the Project) must not be re-marked Modified. Uses real SQLite with a
/// fresh context per simulated request and a SaveChangesInterceptor that records the entity states at save time.
/// </summary>
public sealed class RepositoryUpdateWritesOnlyRootTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly RecordingInterceptor _interceptor = new();
    private readonly DbContextOptions<TaskDbContext> _options;

    public RepositoryUpdateWritesOnlyRootTests()
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

    private TaskDbContext NewContext() => new(_options);

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

    [Fact]
    public async Task Update_RelinkDoesNotModifyOldTask()
    {
        int entryId, logId, oldId, newId;
        await using (var seed = NewContext())
        {
            var entry = new JournalEntry { Title = "Day", Date = new DateOnly(2026, 5, 1) };
            var oldTask = new TaskItem { Title = "Old" };
            var newTask = new TaskItem { Title = "New" };
            seed.AddRange(entry, oldTask, newTask);
            await seed.SaveChangesAsync();
            var log = new JournalLogEntry
            {
                Content = "log",
                JournalEntryId = entry.Id,
                TaskItemId = oldTask.Id,
                LinkedTaskTitleSnapshot = "Old"
            };
            seed.JournalLogEntries.Add(log);
            await seed.SaveChangesAsync();
            (entryId, logId, oldId, newId) = (entry.Id, log.Id, oldTask.Id, newTask.Id);
        }

        await using (var ctx = NewContext())
        {
            var repo = new JournalLogEntryRepository(ctx);
            var log = await repo.GetByIdAsync(entryId, logId);
            Assert.NotNull(log);
            Assert.Equal(oldId, log.TaskItem?.Id);

            // Mirrors JournalLogEntriesController.ApplyTaskLinkAsync: only FK and snapshot change.
            log.TaskItemId = newId;
            log.LinkedTaskTitleSnapshot = "New";

            _interceptor.Saved.Clear();
            await repo.UpdateAsync(log);
        }

        Assert.Contains(_interceptor.Saved, s => s.EntityType == nameof(JournalLogEntry) && s.Id == logId && s.State == EntityState.Modified);
        Assert.DoesNotContain(_interceptor.Saved, s => s.EntityType == nameof(TaskItem));

        await using var verify = NewContext();
        var persisted = await verify.JournalLogEntries.AsNoTracking().SingleAsync(l => l.Id == logId);
        Assert.Equal(newId, persisted.TaskItemId);
        Assert.Equal("New", persisted.LinkedTaskTitleSnapshot);
    }

    [Fact]
    public async Task Update_TrackedTaskEdit_DoesNotModifyProject()
    {
        int taskId, projectId;
        await using (var seed = NewContext())
        {
            var project = new Project { Name = "Proj" };
            var task = new TaskItem { Title = "Task", Project = project };
            seed.AddRange(project, task);
            await seed.SaveChangesAsync();
            (taskId, projectId) = (task.Id, project.Id);
        }

        await using (var ctx = NewContext())
        {
            var repo = new TaskRepository(ctx);
            var task = await repo.GetByIdAsync(taskId);
            Assert.NotNull(task);
            Assert.Equal(projectId, task.Project?.Id);

            task.Title = "Edited";

            _interceptor.Saved.Clear();
            await repo.UpdateAsync(task);
        }

        Assert.Contains(_interceptor.Saved, s => s.EntityType == nameof(TaskItem) && s.Id == taskId && s.State == EntityState.Modified);
        Assert.DoesNotContain(_interceptor.Saved, s => s.EntityType == nameof(Project));

        await using var verify = NewContext();
        var persisted = await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == taskId);
        Assert.Equal("Edited", persisted.Title);
    }
}
