using FluentAssertions;
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
            loaded.Todos.Should().HaveCount(2, "the scenario needs planned tasks for the bug to occur");

            loaded.Title = "Renamed";
            loaded.Summary = "new summary";
            var act = () => repo.UpdateAsync(loaded);

            await act.Should().NotThrowAsync();
            using var verify = NewContext(connection);
            var saved = await verify.JournalEntries.AsNoTracking().SingleAsync();
            saved.Title.Should().Be("Renamed");
            saved.Summary.Should().Be("new summary");
            saved.UpdatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
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

            await act.Should().NotThrowAsync();
            using var verify = NewContext(connection);
            (await verify.JournalEntries.AsNoTracking().SingleAsync()).Summary.Should().Be("works");
            (await verify.JournalEntries.Include(e => e.Todos).AsNoTracking().SingleAsync()).Todos.Should().ContainSingle();
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
            (await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == taskId)).Title.Should().Be("Linked task");
            (await verify.TaskItems.AsNoTracking().SingleAsync(t => t.Id == childId)).Priority.Should().Be(Priority.Low);
            (await verify.JournalLogEntries.AsNoTracking().SingleAsync()).Content.Should().Be("a log line");

            var reloaded = await new JournalEntryRepository(verify).GetByIdAsync(entryId);
            reloaded!.Todos.Select(t => t.Id).Should().BeEquivalentTo([taskId, childId]);
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
            saved.Date.Should().Be(Day);
            saved.CreatedAt.Should().Be(new DateTime(2026, 10, 9, 8, 0, 0, DateTimeKind.Utc));
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

            loaded.UpdatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5), "the controller returns this instance");
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

        (await context.JournalEntries.AsNoTracking().SingleAsync()).Summary.Should().Be("tracked edit");
    }

    [Fact]
    public async Task UpdateAsync_ShouldThrow_WhenTheEntryDoesNotExist()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        using var context = new TaskDbContext(options);
        var repo = new JournalEntryRepository(context);

        var act = () => repo.UpdateAsync(new JournalEntry { Id = 404, Title = "ghost", Date = Day });

        await act.Should().ThrowAsync<KeyNotFoundException>().WithMessage("*404*");
    }
}
