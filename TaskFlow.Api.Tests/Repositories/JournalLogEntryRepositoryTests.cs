using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class JournalLogEntryRepositoryTests
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
    public async Task AddAndGetAll_ShouldReturnLogsOrdered()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 10", Date = new DateOnly(2026, 5, 10) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalLogEntryRepository(context);
        await repo.AddAsync(new JournalLogEntry { JournalEntryId = entry.Id, Content = "A" });
        await Task.Delay(5);
        await repo.AddAsync(new JournalLogEntry { JournalEntryId = entry.Id, Content = "B" });

        var logs = (await repo.GetAllByEntryIdAsync(entry.Id)).ToList();

        logs.Should().HaveCount(2);
        logs[0].Content.Should().Be("A");
        logs[1].Content.Should().Be("B");
    }

    [Fact]
    public async Task UpdateAndDelete_ShouldSetUpdatedAtAndRemove()
    {
        using var context = CreateInMemoryContext();
        var entry = new JournalEntry { Title = "May 10", Date = new DateOnly(2026, 5, 10) };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalLogEntryRepository(context);
        var log = await repo.AddAsync(new JournalLogEntry { JournalEntryId = entry.Id, Content = "Initial" });

        log.Content = "Updated";
        await repo.UpdateAsync(log);

        var fetched = await repo.GetByIdAsync(entry.Id, log.Id);
        fetched.Should().NotBeNull();
        fetched!.UpdatedAt.Should().NotBeNull();

        await repo.DeleteAsync(entry.Id, log.Id);
        await repo.DeleteAsync(entry.Id, 999);

        (await repo.GetByIdAsync(entry.Id, log.Id)).Should().BeNull();
    }

    [Fact]
    public async Task GetByIdAsync_ShouldIncludeTaskItem()
    {
        using var context = CreateInMemoryContext();

        var task = new TaskItem { Title = "Linked Task", Status = Status.Todo };
        var entry = new JournalEntry { Title = "May 10", Date = new DateOnly(2026, 5, 10) };
        context.TaskItems.Add(task);
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();

        var repo = new JournalLogEntryRepository(context);
        var log = await repo.AddAsync(new JournalLogEntry
        {
            JournalEntryId = entry.Id,
            Content = "Work done",
            TaskItemId = task.Id,
            LinkedTaskTitleSnapshot = task.Title,
        });

        var fetched = await repo.GetByIdAsync(entry.Id, log.Id);

        fetched.Should().NotBeNull();
        fetched!.TaskItem.Should().NotBeNull();
        fetched.TaskItem!.Title.Should().Be("Linked Task");
    }

    [Fact]
    public async Task DeleteTask_ShouldNullTaskItemId_AndPreserveSnapshot()
    {
        var (context, connection) = CreateSqliteContext();
        await using (connection)
        await using (context)
        {
            var task = new TaskItem { Title = "Will Be Deleted", Status = Status.Todo };
            var entry = new JournalEntry { Title = "May 10", Date = new DateOnly(2026, 5, 10) };
            context.TaskItems.Add(task);
            context.JournalEntries.Add(entry);
            await context.SaveChangesAsync();

            var repo = new JournalLogEntryRepository(context);
            var log = await repo.AddAsync(new JournalLogEntry
            {
                JournalEntryId = entry.Id,
                Content = "Worked on task",
                TaskItemId = task.Id,
                LinkedTaskTitleSnapshot = task.Title,
            });

            // Delete the task — OnDelete(SetNull) should null TaskItemId on the log
            context.TaskItems.Remove(task);
            await context.SaveChangesAsync();

            var fetched = await repo.GetByIdAsync(entry.Id, log.Id);

            fetched.Should().NotBeNull();
            fetched!.TaskItemId.Should().BeNull();
            fetched.LinkedTaskTitleSnapshot.Should().Be("Will Be Deleted");
        }
    }
}
