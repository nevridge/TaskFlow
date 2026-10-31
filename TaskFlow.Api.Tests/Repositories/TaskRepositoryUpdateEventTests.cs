using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class TaskRepositoryUpdateEventTests
{
    private static TaskDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    private static async Task<TaskItem> SeedTrackedAsync(TaskDbContext context, TaskItem seed)
    {
        context.TaskItems.Add(seed);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        return (await context.TaskItems.FindAsync(seed.Id))!;
    }

    private static Task<List<TaskItemEvent>> GetEventsAsync(TaskDbContext context) =>
        context.TaskItemEvents.AsNoTracking().OrderBy(e => e.Id).ToListAsync();

    [Fact]
    public async Task UpdateAsync_TitleOnlyChange_WritesSingleTitleChangedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "Old", Status = Status.Todo });
        task.Title = "New";
        var before = DateTime.UtcNow.AddSeconds(-5);

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("TitleChanged", evt.EventType);
        Assert.Equal("Title changed from 'Old' to 'New'.", evt.ChangeSummary);
        Assert.Equal(1, evt.TaskItemId);
        Assert.Equal(DateTimeKind.Utc, evt.OccurredAtUtc.Kind);
        Assert.InRange(evt.OccurredAtUtc, before, DateTime.UtcNow.AddSeconds(5));
    }

    [Fact]
    public async Task UpdateAsync_PriorityOnlyChange_WritesSinglePriorityChangedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "T", Priority = Priority.Low, Status = Status.Todo });
        task.Priority = Priority.High;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("PriorityChanged", evt.EventType);
        Assert.Equal("Priority changed from Low to High.", evt.ChangeSummary);
        Assert.Equal(1, evt.TaskItemId);
    }

    [Fact]
    public async Task UpdateAsync_DescriptionOnlyChange_WritesSingleDescriptionChangedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "T", Description = "a", Status = Status.Todo });
        task.Description = "b";

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("DescriptionChanged", evt.EventType);
        Assert.Equal("Description updated.", evt.ChangeSummary);
        Assert.Equal(1, evt.TaskItemId);
    }

    [Theory]
    [InlineData(null, "2026-01-15", "Due date changed from none to 2026-01-15.")]
    [InlineData("2026-01-15", null, "Due date changed from 2026-01-15 to none.")]
    [InlineData("2026-01-15", "2026-02-01", "Due date changed from 2026-01-15 to 2026-02-01.")]
    public async Task UpdateAsync_DueDateOnlyChange_WritesSingleDueDateChangedEvent(string? from, string? to, string expectedSummary)
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "T",
            Status = Status.Todo,
            DueDate = from is null ? null : DateOnly.Parse(from)
        });
        task.DueDate = to is null ? null : DateOnly.Parse(to);

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("DueDateChanged", evt.EventType);
        Assert.Equal(expectedSummary, evt.ChangeSummary);
        Assert.Equal(1, evt.TaskItemId);
    }

    [Fact]
    public async Task UpdateAsync_AllFieldsChange_WritesFourEventsInOrder()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "Old",
            Description = "a",
            Priority = Priority.Low,
            Status = Status.Todo,
            DueDate = new DateOnly(2026, 1, 15)
        });
        task.Title = "New";
        task.Priority = Priority.High;
        task.Description = "b";
        task.DueDate = new DateOnly(2026, 2, 1);

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var events = await GetEventsAsync(context);
        Assert.Equal(
            ["TitleChanged", "PriorityChanged", "DescriptionChanged", "DueDateChanged"],
            events.Select(e => e.EventType));
    }

    [Fact]
    public async Task UpdateAsync_AllFieldsChange_EveryEventHasTaskIdUtcTimestampAndSummary()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 7,
            Title = "Old",
            Description = "a",
            Priority = Priority.Low,
            Status = Status.Todo,
            DueDate = new DateOnly(2026, 1, 15)
        });
        task.Title = "New";
        task.Priority = Priority.High;
        task.Description = "b";
        task.DueDate = new DateOnly(2026, 2, 1);
        var before = DateTime.UtcNow.AddSeconds(-5);

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var events = await GetEventsAsync(context);
        Assert.Equal(4, events.Count);
        Assert.All(events, e =>
        {
            Assert.Equal(7, e.TaskItemId);
            Assert.Equal(DateTimeKind.Utc, e.OccurredAtUtc.Kind);
            Assert.InRange(e.OccurredAtUtc, before, DateTime.UtcNow.AddSeconds(5));
            Assert.False(string.IsNullOrWhiteSpace(e.ChangeSummary));
        });
    }

    [Fact]
    public async Task UpdateAsync_TitleAndStatusChange_WritesFieldEventBeforeStatusEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "Old", Status = Status.Todo });
        task.Title = "New";
        task.Status = Status.Completed;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var events = await GetEventsAsync(context);
        Assert.Equal(["TitleChanged", "Completed"], events.Select(e => e.EventType));
    }

    [Fact]
    public async Task UpdateAsync_NoFieldChanged_WritesNoEvents()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "T",
            Description = "d",
            Priority = Priority.Medium,
            Status = Status.Todo,
            DueDate = new DateOnly(2026, 1, 15)
        });

        // Act
        await repository.UpdateAsync(task);

        // Assert
        Assert.Empty(await GetEventsAsync(context));
    }

    [Fact]
    public async Task UpdateAsync_CaseOnlyTitleChange_WritesTitleChangedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "abc", Status = Status.Todo });
        task.Title = "ABC";

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("TitleChanged", evt.EventType);
        Assert.Equal("Title changed from 'abc' to 'ABC'.", evt.ChangeSummary);
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("", null)]
    public async Task UpdateAsync_DescriptionNullEmptySwap_WritesDescriptionChangedEvent(string? from, string? to)
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "T", Description = from, Status = Status.Todo });
        task.Description = to;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("DescriptionChanged", evt.EventType);
    }

    [Theory]
    [InlineData("notes", "Notes")]
    [InlineData("notes", "notes ")]
    public async Task UpdateAsync_DescriptionOrdinalOnlyDifference_WritesSingleDescriptionChangedEvent(string from, string to)
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "T", Description = from, Status = Status.Todo });
        task.Description = to;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("DescriptionChanged", evt.EventType);
        Assert.Equal("Description updated.", evt.ChangeSummary);
    }

    [Fact]
    public async Task UpdateAsync_SamePriorityAndDueDate_WritesNoEvents()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "T",
            Priority = Priority.High,
            Status = Status.Todo,
            DueDate = new DateOnly(2026, 1, 15)
        });
        task.Priority = Priority.High;
        task.DueDate = new DateOnly(2026, 1, 15);

        // Act
        await repository.UpdateAsync(task);

        // Assert
        Assert.Empty(await GetEventsAsync(context));
    }

    [Fact]
    public async Task UpdateAsync_SameDueDateValueReassigned_WritesNoEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "T",
            Status = Status.Todo,
            DueDate = new DateOnly(2026, 1, 15)
        });
        task.DueDate = DateOnly.ParseExact("2026-01-15", "yyyy-MM-dd");

        // Act
        await repository.UpdateAsync(task);

        // Assert
        Assert.Empty(await GetEventsAsync(context));
    }

    [Fact]
    public async Task UpdateAsync_InProgressStatusChangeOnly_WritesSingleGenericStatusChangedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "T", Status = Status.Todo });
        task.Status = Status.InProgress;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("StatusChanged", evt.EventType);
        Assert.Equal("Status changed from Todo to InProgress.", evt.ChangeSummary);
    }

    [Fact]
    public async Task UpdateAsync_DetachedTaskWithTitleChange_WritesSingleTitleChangedEventWithPersistedTitle()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        // Description is held equal to the persisted row so only the Title change produces an event.
        context.TaskItems.Add(new TaskItem { Id = 1, Title = "Old", Description = "d", Status = Status.Todo });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var detached = new TaskItem { Id = 1, Title = "New", Description = "d", Status = Status.Todo };
        Assert.Equal(EntityState.Detached, context.Entry(detached).State);

        // Act
        await repository.UpdateAsync(detached);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("TitleChanged", evt.EventType);
        Assert.Equal("Title changed from 'Old' to 'New'.", evt.ChangeSummary);
    }

    [Fact]
    public async Task UpdateAsync_DetachedTaskWithPriorityChange_WritesPriorityChangedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        context.TaskItems.Add(new TaskItem { Id = 1, Title = "T", Description = "d", Priority = Priority.Low, Status = Status.Todo });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var detached = new TaskItem { Id = 1, Title = "T", Description = "d", Priority = Priority.High, Status = Status.Todo };
        Assert.Equal(EntityState.Detached, context.Entry(detached).State);

        // Act
        await repository.UpdateAsync(detached);

        // Assert
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("PriorityChanged", evt.EventType);
        Assert.Equal("Priority changed from Low to High.", evt.ChangeSummary);
    }
}
