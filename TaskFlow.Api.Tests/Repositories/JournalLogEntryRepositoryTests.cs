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
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    private static JournalEntry SeedEntry(TaskDbContext context, int id = 1)
    {
        var entry = new JournalEntry { Id = id, Title = $"Entry {id}", Date = new DateOnly(2026, 5, id) };
        context.JournalEntries.Add(entry);
        context.SaveChanges();
        return entry;
    }

    [Fact]
    public async Task GetAllByEntryIdAsync_ShouldReturnLogEntriesForEntry()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        SeedEntry(context, 2);
        context.JournalLogEntries.AddRange(
            new JournalLogEntry { Id = 12, Content = "Log B", JournalEntryId = 1, CreatedAt = new DateTime(2026, 5, 8, 8, 0, 0, DateTimeKind.Utc) },
            new JournalLogEntry { Id = 11, Content = "Log A", JournalEntryId = 1, CreatedAt = new DateTime(2026, 5, 8, 7, 0, 0, DateTimeKind.Utc) },
            new JournalLogEntry { Id = 13, Content = "Log C", JournalEntryId = 2 }
        );
        await context.SaveChangesAsync();
        var repo = new JournalLogEntryRepository(context);

        var result = await repo.GetAllByEntryIdAsync(1);

        result.Should().HaveCount(2);
        result.Should().AllSatisfy(l => l.JournalEntryId.Should().Be(1));
        result.Select(l => l.Id).Should().ContainInOrder(11, 12);
    }

    [Fact]
    public async Task GetAllByEntryIdAsync_ShouldReturnEmpty_WhenNoLogs()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalLogEntryRepository(context);

        var result = await repo.GetAllByEntryIdAsync(1);

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnLogEntry_WhenExists()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        context.JournalLogEntries.Add(new JournalLogEntry { Id = 10, Content = "Log 1", JournalEntryId = 1 });
        await context.SaveChangesAsync();
        var repo = new JournalLogEntryRepository(context);

        var result = await repo.GetByIdAsync(1, 10);

        result.Should().NotBeNull();
        result!.Id.Should().Be(10);
        result.Content.Should().Be("Log 1");
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenNotExists()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalLogEntryRepository(context);

        var result = await repo.GetByIdAsync(1, 999);

        result.Should().BeNull();
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenLogBelongsToDifferentEntry()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        SeedEntry(context, 2);
        context.JournalLogEntries.Add(new JournalLogEntry { Id = 10, Content = "Log 1", JournalEntryId = 2 });
        await context.SaveChangesAsync();
        var repo = new JournalLogEntryRepository(context);

        var result = await repo.GetByIdAsync(1, 10);

        result.Should().BeNull();
    }

    [Fact]
    public async Task AddAsync_ShouldPersistLogEntryWithCreatedAt()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalLogEntryRepository(context);
        var logEntry = new JournalLogEntry { Content = "New log", JournalEntryId = 1 };

        var result = await repo.AddAsync(logEntry);

        result.Id.Should().BeGreaterThan(0);
        result.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
        var persisted = await context.JournalLogEntries.FindAsync(result.Id);
        persisted.Should().NotBeNull();
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistChangesWithUpdatedAt()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        context.JournalLogEntries.Add(new JournalLogEntry { Id = 5, Content = "Original", JournalEntryId = 1 });
        await context.SaveChangesAsync();
        var repo = new JournalLogEntryRepository(context);
        var logEntry = await context.JournalLogEntries.FindAsync(5);
        logEntry!.Content = "Updated";

        await repo.UpdateAsync(logEntry);

        var persisted = await context.JournalLogEntries.FindAsync(5);
        persisted!.Content.Should().Be("Updated");
        persisted.UpdatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task DeleteAsync_ShouldRemoveLogEntry_WhenExists()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        context.JournalLogEntries.Add(new JournalLogEntry { Id = 5, Content = "Log", JournalEntryId = 1 });
        await context.SaveChangesAsync();
        var repo = new JournalLogEntryRepository(context);

        await repo.DeleteAsync(1, 5);

        var persisted = await context.JournalLogEntries.FindAsync(5);
        persisted.Should().BeNull();
    }

    [Fact]
    public async Task DeleteAsync_ShouldDoNothing_WhenNotExists()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalLogEntryRepository(context);

        var act = async () => await repo.DeleteAsync(1, 999);

        await act.Should().NotThrowAsync();
    }
}
