using FluentAssertions;
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
}
