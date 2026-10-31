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

    [Theory]
    [InlineData(Status.Todo)]
    [InlineData(Status.InProgress)]
    [InlineData(Status.Draft)]
    public async Task UpdateAsync_CompletingTask_SetsCompletedAtToNow(Status from)
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "T", Status = from });
        task.Status = Status.Completed;
        var before = DateTime.UtcNow.AddSeconds(-5);

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var stored = await context.TaskItems.AsNoTracking().SingleAsync();
        Assert.NotNull(stored.CompletedAt);
        Assert.Equal(DateTimeKind.Utc, stored.CompletedAt!.Value.Kind);
        Assert.InRange(stored.CompletedAt.Value, before, DateTime.UtcNow.AddSeconds(5));
        Assert.Equal("Completed", Assert.Single(await GetEventsAsync(context)).EventType);
    }

    [Fact]
    public async Task UpdateAsync_BlockedToCompleted_SetsCompletedAtAndWritesSingleCompletedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "T",
            Status = Status.Blocked,
            PreviousStatus = Status.Todo,
            BlockedAt = DateTime.UtcNow.AddHours(-1)
        });
        task.Status = Status.Completed;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var stored = await context.TaskItems.AsNoTracking().SingleAsync();
        Assert.NotNull(stored.CompletedAt);
        var evt = Assert.Single(await GetEventsAsync(context));
        Assert.Equal("Completed", evt.EventType);
    }

    [Fact]
    public async Task UpdateAsync_ReopeningCompletedTask_ClearsCompletedAtAndWritesReopenedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "T",
            Status = Status.Completed,
            CompletedAt = DateTime.UtcNow.AddHours(-1)
        });
        task.Status = Status.Todo;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        Assert.Null((await context.TaskItems.AsNoTracking().SingleAsync()).CompletedAt);
        Assert.Equal("Reopened", Assert.Single(await GetEventsAsync(context)).EventType);
    }

    [Fact]
    public async Task UpdateAsync_RecompletingAfterReopen_SetsLaterCompletedAtAndKeepsBothEvents()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var firstCompletion = DateTime.UtcNow.AddDays(-1);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "T",
            Status = Status.Completed,
            CompletedAt = firstCompletion
        });
        task.Status = Status.Todo;
        await repository.UpdateAsync(task);

        // Act
        task.Status = Status.Completed;
        await repository.UpdateAsync(task);

        // Assert
        var stored = await context.TaskItems.AsNoTracking().SingleAsync();
        Assert.True(stored.CompletedAt > firstCompletion);
        var types = (await GetEventsAsync(context)).Select(e => e.EventType).ToList();
        Assert.Equal(["Reopened", "Completed"], types);
    }

    [Fact]
    public async Task UpdateAsync_CompletedTaskStaysCompleted_KeepsStoredCompletedAt()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var completedAt = new DateTime(2026, 6, 1, 10, 0, 0, DateTimeKind.Utc);
        var task = await SeedTrackedAsync(context, new TaskItem
        {
            Id = 1,
            Title = "Old",
            Status = Status.Completed,
            CompletedAt = completedAt
        });
        task.Title = "New";

        // Act
        await repository.UpdateAsync(task);

        // Assert
        Assert.Equal(completedAt, (await context.TaskItems.AsNoTracking().SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task UpdateAsync_LegacyCompletedTaskWithNullCompletedAt_StaysNullWhenOtherFieldChanges()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = await SeedTrackedAsync(context, new TaskItem { Id = 1, Title = "Old", Status = Status.Completed });
        task.Title = "New";

        // Act
        await repository.UpdateAsync(task);

        // Assert
        Assert.Null((await context.TaskItems.AsNoTracking().SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task UpdateAsync_DetachedTaskIgnoresCallerSuppliedCompletedAt_WhenNotCompleting()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        context.TaskItems.Add(new TaskItem { Id = 1, Title = "T", Description = "d", Status = Status.Todo });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var detached = new TaskItem
        {
            Id = 1,
            Title = "T",
            Description = "d",
            Status = Status.Todo,
            CompletedAt = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        };

        // Act
        await repository.UpdateAsync(detached);

        // Assert
        Assert.Null((await context.TaskItems.AsNoTracking().SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task UpdateAsync_DetachedTaskIgnoresCallerSuppliedCompletedAt_WhenCompleting()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        context.TaskItems.Add(new TaskItem { Id = 1, Title = "T", Description = "d", Status = Status.Todo });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var forged = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var detached = new TaskItem { Id = 1, Title = "T", Description = "d", Status = Status.Completed, CompletedAt = forged };

        // Act
        await repository.UpdateAsync(detached);

        // Assert
        var stored = await context.TaskItems.AsNoTracking().SingleAsync();
        Assert.NotEqual(forged, stored.CompletedAt);
        Assert.InRange(stored.CompletedAt!.Value, DateTime.UtcNow.AddSeconds(-5), DateTime.UtcNow.AddSeconds(5));
    }

    [Fact]
    public async Task UpdateAsync_DetachedCompletedTaskKeepsPersistedCompletedAt_WhenCallerSendsDifferentValue()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var persisted = new DateTime(2026, 6, 1, 10, 0, 0, DateTimeKind.Utc);
        context.TaskItems.Add(new TaskItem { Id = 1, Title = "T", Description = "d", Status = Status.Completed, CompletedAt = persisted });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var detached = new TaskItem
        {
            Id = 1,
            Title = "T2",
            Description = "d",
            Status = Status.Completed,
            CompletedAt = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        };

        // Act
        await repository.UpdateAsync(detached);

        // Assert
        Assert.Equal(persisted, (await context.TaskItems.AsNoTracking().SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task AddAsync_CompletedTask_SetsCompletedAtAndWritesNoCompletedEvent()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        // Act
        var created = await repository.AddAsync(new TaskItem { Title = "T", Status = Status.Completed });

        // Assert
        Assert.NotNull(created.CompletedAt);
        Assert.InRange(created.CompletedAt!.Value, DateTime.UtcNow.AddSeconds(-5), DateTime.UtcNow.AddSeconds(5));
        Assert.Equal("TaskCreated", Assert.Single(await GetEventsAsync(context)).EventType);
    }

    [Theory]
    [InlineData(Status.Draft)]
    [InlineData(Status.Todo)]
    [InlineData(Status.InProgress)]
    public async Task AddAsync_NonCompletedTask_LeavesCompletedAtNull_EvenWhenCallerSetsIt(Status status)
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        // Act
        var created = await repository.AddAsync(new TaskItem
        {
            Title = "T",
            Status = status,
            CompletedAt = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        });

        // Assert
        Assert.Null(created.CompletedAt);
    }
}
