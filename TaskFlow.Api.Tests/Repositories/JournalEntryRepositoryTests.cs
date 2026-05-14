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
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    [Fact]
    public async Task AddAndGetByDate_ShouldPersistEntry()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var date = new DateOnly(2026, 5, 10);
        await repo.AddAsync(new JournalEntry { Title = "May 10", Date = date });

        var found = await repo.GetByDateAsync(date);

        found.Should().NotBeNull();
        found!.Title.Should().Be("May 10");
        found.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task GetAll_ShouldReturnDescendingByDate()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        await repo.AddAsync(new JournalEntry { Title = "Older", Date = new DateOnly(2026, 5, 9) });
        await repo.AddAsync(new JournalEntry { Title = "Newer", Date = new DateOnly(2026, 5, 10) });

        var all = (await repo.GetAllAsync()).ToList();

        all.Should().HaveCount(2);
        all[0].Title.Should().Be("Newer");
    }

    [Fact]
    public async Task AddTodoAndRemoveTodo_ShouldManageLinks()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, task.Id);

        (await repo.TodoExistsAsync(entry.Id, task.Id)).Should().BeTrue();
        (await repo.GetTodosAsync(entry.Id)).Should().ContainSingle(t => t.Id == task.Id);

        await repo.RemoveTodoAsync(entry.Id, task.Id);

        (await repo.TodoExistsAsync(entry.Id, task.Id)).Should().BeFalse();
    }

    [Fact]
    public async Task Delete_ShouldRemoveEntry_AndIgnoreMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "Delete", Date = new DateOnly(2026, 5, 10) });

        await repo.DeleteAsync(entry.Id);
        await repo.DeleteAsync(999);

        (await repo.GetByIdAsync(entry.Id)).Should().BeNull();
    }
}
