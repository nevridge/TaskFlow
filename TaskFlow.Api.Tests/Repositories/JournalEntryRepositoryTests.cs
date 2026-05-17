using FluentAssertions;
using Microsoft.Data.Sqlite;
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
    public async Task AddAndGetByDate_ShouldPersistEntry()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
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

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        await repo.AddAsync(new JournalEntry { Title = "Older", Date = today.AddDays(1) });
        await repo.AddAsync(new JournalEntry { Title = "Newer", Date = today.AddDays(2) });

        var all = (await repo.GetAllAsync()).ToList();

        all.Should().HaveCount(2);
        all[0].Title.Should().Be("Newer");
    }

    [Fact]
    public async Task AddTodoAndRemoveTodo_ShouldManageLinks()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, task.Id);

        (await repo.TodoExistsAsync(entry.Id, task.Id)).Should().BeTrue();
        (await repo.GetTodosAsync(entry.Id)).Should().ContainSingle(t => t.Id == task.Id);

        await repo.RemoveTodoAsync(entry.Id, task.Id);

        (await repo.TodoExistsAsync(entry.Id, task.Id)).Should().BeFalse();
        task.CurrentJournalEntryId.Should().BeNull();
    }

    [Fact]
    public async Task AddTodoAsync_ShouldStampOwnershipMetadata_OnFirstAssignment()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        var result = await repo.AddTodoAsync(entry.Id, task.Id);

        result.Should().Be(AddTodoResult.Success);
        task.CurrentJournalEntryId.Should().Be(entry.Id);
        task.FirstTaggedDate.Should().Be(entry.Date);
        task.MoveCount.Should().Be(0);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldMoveTaskBetweenEntries_AndIncrementMoveCount()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var firstEntry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = today.AddDays(1) });
        var secondEntry = await repo.AddAsync(new JournalEntry { Title = "May 11", Date = today.AddDays(2) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(firstEntry.Id, task.Id);
        var moveResult = await repo.AddTodoAsync(secondEntry.Id, task.Id);

        moveResult.Should().Be(AddTodoResult.Success);
        task.CurrentJournalEntryId.Should().Be(secondEntry.Id);
        task.FirstTaggedDate.Should().Be(firstEntry.Date);
        task.MoveCount.Should().Be(1);
        (await repo.TodoExistsAsync(firstEntry.Id, task.Id)).Should().BeFalse();
        (await repo.TodoExistsAsync(secondEntry.Id, task.Id)).Should().BeTrue();
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnAlreadyLinked_WhenLinkExists()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, task.Id);
        var result = await repo.AddTodoAsync(entry.Id, task.Id);

        result.Should().Be(AddTodoResult.AlreadyLinked);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnEntryNotFound_WhenEntryMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var result = await repo.AddTodoAsync(999, 1);

        result.Should().Be(AddTodoResult.EntryNotFound);
    }

    [Fact]
    public async Task AddTodoAsync_ShouldReturnTaskNotFound_WhenTaskMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var result = await repo.AddTodoAsync(entry.Id, 999);

        result.Should().Be(AddTodoResult.TaskNotFound);
    }

    [Fact]
    public async Task AddAsync_ShouldThrowDuplicateJournalDateException_WhenDateAlreadyExists()
    {
        var (context, connection) = CreateSqliteContext();
        await using var _ = connection;
        await using var __ = context;

        var repo = new JournalEntryRepository(context);
        var date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        await repo.AddAsync(new JournalEntry { Title = "First", Date = date });

        var act = async () => await repo.AddAsync(new JournalEntry { Title = "Duplicate", Date = date });

        await act.Should().ThrowAsync<DuplicateJournalDateException>();
    }

    [Fact]
    public async Task Delete_ShouldRemoveEntry_AndIgnoreMissing()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "Delete", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });

        await repo.DeleteAsync(entry.Id);
        await repo.DeleteAsync(999);

        (await repo.GetByIdAsync(entry.Id)).Should().BeNull();
    }

    [Fact]
    public async Task AddAsync_ShouldAutomaticallyInheritIncompleteTasks_FromPreviousDay()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var previousEntry = await repo.AddAsync(new JournalEntry { Title = "Previous", Date = today.AddDays(1) });
        var openTask = new TaskItem { Title = "Open task", Status = Status.Todo };
        context.TaskItems.Add(openTask);
        await context.SaveChangesAsync();
        await repo.AddTodoAsync(previousEntry.Id, openTask.Id);

        var nextEntry = await repo.AddAsync(new JournalEntry { Title = "Next", Date = today.AddDays(2) });

        (await repo.GetTodosAsync(previousEntry.Id)).Should().BeEmpty();
        (await repo.GetTodosAsync(nextEntry.Id)).Should().ContainSingle(t => t.Id == openTask.Id);
        openTask.CurrentJournalEntryId.Should().Be(nextEntry.Id);
        openTask.MoveCount.Should().Be(1);
        openTask.FirstTaggedDate.Should().Be(previousEntry.Date);
    }

    [Fact]
    public async Task AddAsync_ShouldNotInheritCompletedTasks_FromPreviousDay()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var previousEntry = await repo.AddAsync(new JournalEntry { Title = "Previous", Date = today.AddDays(1) });
        var completedTask = new TaskItem { Title = "Done task", Status = Status.Completed, IsComplete = true };
        context.TaskItems.Add(completedTask);
        await context.SaveChangesAsync();
        await repo.AddTodoAsync(previousEntry.Id, completedTask.Id);

        var nextEntry = await repo.AddAsync(new JournalEntry { Title = "Next", Date = today.AddDays(2) });

        (await repo.GetTodosAsync(previousEntry.Id)).Should().ContainSingle(t => t.Id == completedTask.Id);
        (await repo.GetTodosAsync(nextEntry.Id)).Should().BeEmpty();
        completedTask.CurrentJournalEntryId.Should().Be(previousEntry.Id);
    }

    [Fact]
    public async Task AddTodoAsync_AndRemoveTodoAsync_ShouldWriteTaskHistoryEvents()
    {
        using var context = CreateInMemoryContext();
        var repo = new JournalEntryRepository(context);

        var entry = await repo.AddAsync(new JournalEntry { Title = "May 10", Date = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) });
        var task = new TaskItem { Title = "Task 1", Status = Status.Todo };
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();

        await repo.AddTodoAsync(entry.Id, task.Id);
        await repo.RemoveTodoAsync(entry.Id, task.Id);

        var events = await context.TaskItemEvents
            .Where(e => e.TaskItemId == task.Id)
            .OrderBy(e => e.OccurredAtUtc)
            .ToListAsync();

        events.Should().HaveCount(2);
        events[0].EventType.Should().Be("AssignedToJournalDay");
        events[0].ToJournalEntryId.Should().Be(entry.Id);
        events[1].EventType.Should().Be("RemovedFromJournalDay");
        events[1].FromJournalEntryId.Should().Be(entry.Id);
    }
}
