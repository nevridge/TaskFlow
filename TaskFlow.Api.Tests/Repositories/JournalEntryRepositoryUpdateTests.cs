using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

/// <summary>
/// UpdateAsync receives the detached graph returned by GetByIdAsync (entry + todos + child tasks + log entries).
/// It must change only the entry's own fields; re-attaching the graph tried to re-insert the todo join rows
/// (UNIQUE constraint failure) and rewrote every loaded task and log row.
/// </summary>
public class JournalEntryRepositoryUpdateTests
{
    private static readonly DateOnly Day = new(2026, 10, 9);

    private static (SqliteConnection Connection, int EntryId, int TaskId, int ChildId) CreateSeededDatabase()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        using var seed = NewContext(connection);
        seed.Database.EnsureCreated();

        var entry = new JournalEntry { Title = "Journal 10-09-2026", Date = Day, Summary = "old summary", CreatedAt = new DateTime(2026, 10, 9, 8, 0, 0, DateTimeKind.Utc) };
        var task = new TaskItem { Title = "Linked task", Priority = Priority.High, Status = Status.Todo };
        var child = new TaskItem { Title = "Child task", ParentTaskItem = task };
        seed.JournalEntries.Add(entry);
        seed.TaskItems.AddRange(task, child);
        seed.SaveChanges();

        entry.Todos.Add(task);
        entry.Todos.Add(child);
        task.CurrentJournalEntryId = entry.Id;
        child.CurrentJournalEntryId = entry.Id;
        entry.LogEntries.Add(new JournalLogEntry { Content = "a log line", TaskItemId = task.Id, CreatedAt = DateTime.UtcNow });
        seed.SaveChanges();

        return (connection, entry.Id, task.Id, child.Id);
    }

    private static TaskDbContext NewContext(SqliteConnection connection) =>
        new(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(connection).Options);

    [Fact]
    public async Task UpdateAsync_ShouldPersistTitleAndSummary_WhenTheEntryHasPlannedTasks()
    {
        var (connection, entryId, _, _) = CreateSeededDatabase();
        using (connection)
        {
            // One context per request, as in production: load (detached graph), edit, update.
            using var context = NewContext(connection);
            var repo = new JournalEntryRepository(context);
            var loaded = (await repo.GetByIdAsync(entryId))!;
            // the scenario needs planned tasks for the bug to occur
            Assert.Equal(2, loaded.Todos.Count());

            loaded.Title = "Renamed";
            loaded.Summary = "new summary";
            var act = () => repo.UpdateAsync(loaded);

            Assert.Null(await Record.ExceptionAsync(act));
            using var verify = NewContext(connection);
            var saved = await verify.JournalEntries.AsNoTracking().SingleAsync();
            Assert.Equal("Renamed", saved.Title);
            Assert.Equal("new summary", saved.Summary);
            Assert.NotNull(saved.UpdatedAt);
            Assert.Equal(DateTime.UtcNow, saved.UpdatedAt.Value, TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistSummary_WhenTheEntryHasASinglePlannedTask()
    {
        // The simplest real-world case (what the MCP assistant hit): one planned task, no subtasks.
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        using (connection)
        {
            int entryId;
            using (var seed = NewContext(connection))
            {
                seed.Database.EnsureCreated();
                var entry = new JournalEntry { Title = "Day", Date = Day };
                var task = new TaskItem { Title = "Only task" };
                seed.JournalEntries.Add(entry);
                seed.TaskItems.Add(task);
                seed.SaveChanges();
                entry.Todos.Add(task);
                task.CurrentJournalEntryId = entry.Id;
                seed.SaveChanges();
                entryId = entry.Id;
            }

            using var context = NewContext(connection);
            var repo = new JournalEntryRepository(context);
            var loaded = (await repo.GetByIdAsync(entryId))!;

            loaded.Summary = "works";
            var act = () => repo.UpdateAsync(loaded);

            Assert.Null(await Record.ExceptionAsync(act));
            using var verify = NewContext(connection);
            Assert.Equal("works", (await verify.JournalEntries.AsNoTracking().SingleAsync()).Summary);
            Assert.Single((await verify.JournalEntries.Include(e => e.Todos).AsNoTracking().SingleAsync()).Todos);
        }
    }

    [Fact]
    public async Task UpdateAsync_ShouldLeaveTodosLogsAndLinkedTasksUntouched()
    {
        var (connection, entryId, taskId, childId) = CreateSeededDatabase();
        using (connection)
        {
            using var context = NewContext(connection);
            var repo = new JournalEntryRepository(context);
            var loaded = (await repo.GetByIdAsync(entryId))!;

            // Stale values on the loaded graph must not be written back.
            loaded.Summary = "changed";
            loaded.Todos.Single(t => t.Id == taskId).Title = "STALE TITLE";
            loaded.Todos.Single(t => t.Id == childId).Priority = Priority.High;
            loaded.LogEntries.Single().Content = "STALE LOG";
            await repo.UpdateAsync(loaded);

            using var verify = NewContext(connection);
            Assert.Equal("Linked task", (await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == taskId)).Title);
            Assert.Equal(Priority.Low, (await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == childId)).Priority);
            Assert.Equal("a log line", (await verify.JournalLogEntries.AsNoTracking().SingleAsync()).Content);

            var reloaded = await new JournalEntryRepository(verify).GetByIdAsync(entryId);
            Assert.Equal(new[] { taskId, childId }.Order(), reloaded!.Todos.Select(t => t.Id).Order());
        }
    }

    [Fact]
    public async Task UpdateAsync_ShouldNotChangeDateOrCreatedAt()
    {
        var (connection, entryId, _, _) = CreateSeededDatabase();
        using (connection)
        {
            using var context = NewContext(connection);
            var repo = new JournalEntryRepository(context);
            var loaded = (await repo.GetByIdAsync(entryId))!;

            loaded.Date = Day.AddDays(30);
            loaded.CreatedAt = DateTime.UtcNow.AddYears(-1);
            loaded.Summary = "x";
            await repo.UpdateAsync(loaded);

            using var verify = NewContext(connection);
            var saved = await verify.JournalEntries.AsNoTracking().SingleAsync();
            Assert.Equal(Day, saved.Date);
            Assert.Equal(new DateTime(2026, 10, 9, 8, 0, 0, DateTimeKind.Utc), saved.CreatedAt);
        }
    }

    [Fact]
    public async Task UpdateAsync_ShouldSetUpdatedAtOnTheInstancePassedIn()
    {
        var (connection, entryId, _, _) = CreateSeededDatabase();
        using (connection)
        {
            using var context = NewContext(connection);
            var repo = new JournalEntryRepository(context);
            var loaded = (await repo.GetByIdAsync(entryId))!;

            await repo.UpdateAsync(loaded);

            Assert.NotNull(loaded.UpdatedAt);
            // the controller returns this instance
            Assert.Equal(DateTime.UtcNow, loaded.UpdatedAt.Value, TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task UpdateAsync_ShouldWork_ForAnEntryTrackedByTheSameContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        using var context = new TaskDbContext(options);
        var repo = new JournalEntryRepository(context);
        var entry = await repo.AddAsync(new JournalEntry { Title = "t", Date = Day.AddDays(5) });

        entry.Summary = "tracked edit";
        await repo.UpdateAsync(entry);

        Assert.Equal("tracked edit", (await context.JournalEntries.AsNoTracking().SingleAsync()).Summary);
    }

    [Fact]
    public async Task UpdateAsync_ShouldThrow_WhenTheEntryDoesNotExist()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        using var context = new TaskDbContext(options);
        var repo = new JournalEntryRepository(context);

        var act = () => repo.UpdateAsync(new JournalEntry { Id = 404, Title = "ghost", Date = Day });

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(act);
        Assert.Contains("404", ex.Message, StringComparison.OrdinalIgnoreCase);
    }
}
