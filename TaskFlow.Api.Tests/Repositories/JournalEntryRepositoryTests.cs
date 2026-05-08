using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class JournalEntryRepositoryTests
{
    private static TaskDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    private static JournalEntry SeedEntry(TaskDbContext context, int id = 1, DateOnly? date = null)
    {
        var entry = new JournalEntry
        {
            Id = id,
            Title = $"Entry {id}",
            Date = date ?? new DateOnly(2026, 5, id)
        };
        context.JournalEntries.Add(entry);
        context.SaveChanges();
        return entry;
    }

    private static TaskItem SeedTask(TaskDbContext context, int id = 1)
    {
        var task = new TaskItem { Id = id, Title = $"Task {id}" };
        context.TaskItems.Add(task);
        context.SaveChanges();
        return task;
    }

    [Fact]
    public async Task GetAllAsync_ShouldReturnAllEntries()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1, new DateOnly(2026, 5, 1));
        SeedEntry(context, 2, new DateOnly(2026, 5, 2));
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetAllAsync();

        result.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetAllAsync_ShouldReturnEmpty_WhenNoEntries()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetAllAsync();

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnEntry_WhenExists()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetByIdAsync(1);

        result.Should().NotBeNull();
        result!.Id.Should().Be(1);
        result.Title.Should().Be("Entry 1");
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenNotExists()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetByIdAsync(999);

        result.Should().BeNull();
    }

    [Fact]
    public async Task AddAsync_ShouldPersistEntryWithCreatedAt()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);
        var entry = new JournalEntry { Title = "New Entry", Date = new DateOnly(2026, 5, 7) };

        var result = await repo.AddAsync(entry);

        result.Id.Should().BeGreaterThan(0);
        result.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
        var persisted = await context.JournalEntries.FindAsync(result.Id);
        persisted.Should().NotBeNull();
    }

    [Fact]
    public async Task UpdateAsync_ShouldPersistChangesWithUpdatedAt()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalEntryRepository(context);
        var entry = await context.JournalEntries.FindAsync(1);
        entry!.Title = "Modified Title";

        await repo.UpdateAsync(entry);

        var persisted = await context.JournalEntries.FindAsync(1);
        persisted!.Title.Should().Be("Modified Title");
        persisted.UpdatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task DeleteAsync_ShouldRemoveEntry_WhenExists()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalEntryRepository(context);

        await repo.DeleteAsync(1);

        var persisted = await context.JournalEntries.FindAsync(1);
        persisted.Should().BeNull();
    }

    [Fact]
    public async Task DeleteAsync_ShouldDoNothing_WhenNotExists()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var act = async () => await repo.DeleteAsync(999);

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task GetTodosAsync_ShouldReturnLinkedTaskItems()
    {
        using var context = CreateInMemoryContext();
        var task = SeedTask(context, 1);
        var entry = new JournalEntry
        {
            Id = 1,
            Title = "Entry 1",
            Date = new DateOnly(2026, 5, 1),
            Todos = [task]
        };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetTodosAsync(1);

        result.Should().HaveCount(1);
        result.Should().Contain(t => t.Id == 1);
    }

    [Fact]
    public async Task GetTodosAsync_ShouldReturnEmpty_WhenNoTodosLinked()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetTodosAsync(1);

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetTodoAsync_ShouldReturnTask_WhenLinked()
    {
        using var context = CreateInMemoryContext();
        var task = SeedTask(context, 1);
        var entry = new JournalEntry
        {
            Id = 1,
            Title = "Entry 1",
            Date = new DateOnly(2026, 5, 1),
            Todos = [task]
        };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetTodoAsync(1, 1);

        result.Should().NotBeNull();
        result!.Id.Should().Be(1);
    }

    [Fact]
    public async Task GetTodoAsync_ShouldReturnNull_WhenNotLinked()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        SeedTask(context, 1);
        var repo = new JournalEntryRepository(context);

        var result = await repo.GetTodoAsync(1, 1);

        result.Should().BeNull();
    }

    [Fact]
    public async Task AddTodoAsync_ShouldLinkTaskItemToEntry()
    {
        using var context = CreateInMemoryContext();
        SeedEntry(context, 1);
        SeedTask(context, 1);
        var repo = new JournalEntryRepository(context);

        await repo.AddTodoAsync(1, 1);

        var entry = await context.JournalEntries.Include(e => e.Todos).FirstOrDefaultAsync(e => e.Id == 1);
        entry!.Todos.Should().Contain(t => t.Id == 1);
    }

    [Fact]
    public async Task RemoveTodoAsync_ShouldUnlinkTaskItemFromEntry()
    {
        using var context = CreateInMemoryContext();
        var task = SeedTask(context, 1);
        var entry = new JournalEntry
        {
            Id = 1,
            Title = "Entry 1",
            Date = new DateOnly(2026, 5, 1),
            Todos = [task]
        };
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();
        var repo = new JournalEntryRepository(context);

        await repo.RemoveTodoAsync(1, 1);

        var persisted = await context.JournalEntries.Include(e => e.Todos).FirstOrDefaultAsync(e => e.Id == 1);
        persisted!.Todos.Should().BeEmpty();
    }
}
