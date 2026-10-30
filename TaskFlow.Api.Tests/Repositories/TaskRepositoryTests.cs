using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Repositories;

public class TaskRepositoryTests
{
    private static TaskDbContext CreateInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new TaskDbContext(options);
    }

    [Fact]
    public async Task GetAllAsync_ShouldReturnAllTasks()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        var tasks = new List<TaskItem>
        {
            new() { Id = 1, Title = "Task 1", Description = "Description 1", Status = Status.Todo },
            new() { Id = 2, Title = "Task 2", Description = "Description 2", Status = Status.Completed }
        };
        await context.TaskItems.AddRangeAsync(tasks);
        await context.SaveChangesAsync();

        // Act
        var result = await repository.GetAllAsync();

        // Assert
        Assert.Equal(2, result.Count());
        Assert.All(result, t => Assert.Contains(t.Status, new[] { Status.Draft, Status.Todo, Status.Completed }));
    }

    [Fact]
    public async Task GetAllAsync_ShouldReturnEmptyList_WhenNoTasks()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        // Act
        var result = await repository.GetAllAsync();

        // Assert
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnTask_WhenTaskExists()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        var task = new TaskItem
        {
            Id = 1,
            Title = "Task 1",
            Description = "Description 1",
            Status = Status.Todo
        };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();

        // Act
        var result = await repository.GetByIdAsync(1);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(Status.Todo, result.Status);
        Assert.Equal("Task 1", result.Title);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnNull_WhenTaskDoesNotExist()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        // Act
        var result = await repository.GetByIdAsync(999);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task AddAsync_ShouldAddTaskAndReturnIt()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var newTask = new TaskItem { Title = "New Task", Description = "Description" };

        // Act
        var result = await repository.AddAsync(newTask);

        // Assert
        Assert.NotNull(result);
        Assert.InRange(result.Id, 1, int.MaxValue);
        Assert.Equal("New Task", result.Title);

        var savedTask = await context.TaskItems.FindAsync(result.Id);
        Assert.NotNull(savedTask);
        // FindAsync returns the tracked instance AddAsync saved, so this is the same object
        Assert.Same(result, savedTask);

        var createdEvent = await context.TaskItemEvents.SingleAsync(e => e.TaskItemId == result.Id);
        Assert.Equal("TaskCreated", createdEvent.EventType);
    }

    [Fact]
    public async Task AddAsync_ShouldHandleTaskWithNullDescription()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var newTask = new TaskItem { Title = "Task", Description = null };

        // Act
        var result = await repository.AddAsync(newTask);

        // Assert
        Assert.NotNull(result);
        Assert.Null(result.Description);

        var savedTask = await context.TaskItems.FindAsync(result.Id);
        Assert.NotNull(savedTask);
        Assert.Null(savedTask.Description);
    }

    [Fact]
    public async Task AddAsync_ShouldHandleCompletedTask()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var newTask = new TaskItem { Title = "Completed Task", Description = "Done", Status = Status.Completed };

        // Act
        var result = await repository.AddAsync(newTask);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(Status.Completed, result.Status);

        var savedTask = await context.TaskItems.FindAsync(result.Id);
        Assert.NotNull(savedTask);
        Assert.Equal(Status.Completed, savedTask.Status);
    }

    [Fact]
    public async Task UpdateAsync_ShouldUpdateExistingTask()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Original", Description = "Original Description", Status = Status.Todo };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();

        // Modify the task
        task.Title = "Updated";
        task.Description = "Updated Description";
        task.Status = Status.Completed;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var updatedTask = await context.TaskItems.FindAsync(1);
        Assert.NotNull(updatedTask);
        Assert.Equal("Updated", updatedTask.Title);
        Assert.Equal("Updated Description", updatedTask.Description);
        Assert.Equal(Status.Completed, updatedTask.Status);
    }

    [Fact]
    public async Task UpdateAsync_ShouldHandlePartialUpdate()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Original", Description = "Description", Status = Status.Todo };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();

        // Modify only Status
        task.Status = Status.Completed;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var updatedTask = await context.TaskItems.FindAsync(1);
        Assert.NotNull(updatedTask);
        Assert.Equal("Original", updatedTask.Title);
        Assert.Equal("Description", updatedTask.Description);
        Assert.Equal(Status.Completed, updatedTask.Status);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteTitleAndPriorityHistoryEvents_WhenValuesChange()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Original", Description = "Description", Priority = Priority.Low, Status = Status.Todo };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.Title = "Updated";
        tracked.Priority = Priority.High;

        await repository.UpdateAsync(tracked);

        var events = await context.TaskItemEvents
            .Where(e => e.TaskItemId == tracked.Id)
            .OrderBy(e => e.OccurredAtUtc)
            .ToListAsync();

        Assert.Contains(events, e => e.EventType == "TitleChanged");
        Assert.Contains(events, e => e.EventType == "PriorityChanged");
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteCompletedAndReopenedEvents_WhenCompletionStateChanges()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Task", Description = "Description", Status = Status.Todo };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.Status = Status.Completed;
        await repository.UpdateAsync(tracked);

        context.ChangeTracker.Clear();
        tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.Status = Status.Todo;
        await repository.UpdateAsync(tracked);

        var events = await context.TaskItemEvents
            .Where(e => e.TaskItemId == task.Id)
            .OrderBy(e => e.OccurredAtUtc)
            .ToListAsync();

        Assert.Contains(events, e => e.EventType == "Completed");
        Assert.Contains(events, e => e.EventType == "Reopened");
    }

    [Theory]
    [InlineData(Status.Todo, Status.Completed, "Completed")]
    [InlineData(Status.Draft, Status.Completed, "Completed")]
    [InlineData(Status.Completed, Status.Todo, "Reopened")]
    [InlineData(Status.Completed, Status.Draft, "Reopened")]
    [InlineData(Status.Draft, Status.Todo, "StatusChanged")]
    [InlineData(Status.Todo, Status.Draft, "StatusChanged")]
    public async Task UpdateAsync_ShouldWriteStatusOnlyHistoryEvent_WhenStatusChanges(Status from, Status to, string expectedEvent)
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        await context.TaskItems.AddAsync(new TaskItem { Id = 1, Title = "Task", Status = from });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.Status = to;
        await repository.UpdateAsync(tracked);

        var statusEvent = Assert.Single(await context.TaskItemEvents.Where(e => e.TaskItemId == 1).ToListAsync());
        Assert.Equal(expectedEvent, statusEvent.EventType);
    }

    private static async Task<TaskItem> SeedAndTrackAsync(TaskDbContext context, TaskItem seed)
    {
        await context.TaskItems.AddAsync(seed);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var tracked = await context.TaskItems.FindAsync(seed.Id);
        Assert.NotNull(tracked);
        return tracked;
    }

    private static async Task<List<TaskItemEvent>> EventsAsync(TaskDbContext context) =>
        await context.TaskItemEvents.Where(e => e.TaskItemId == 1).ToListAsync();

    [Theory]
    [InlineData("Waiting on Sam", "Blocked: Waiting on Sam.")]
    [InlineData(null, "Blocked.")]
    [InlineData("   ", "Blocked.")]
    public async Task UpdateAsync_ShouldWriteBlockedEvent_WhenEnteringBlocked(string? reason, string expectedSummary)
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var tracked = await SeedAndTrackAsync(context, new TaskItem { Id = 1, Title = "Task", Status = Status.Todo });

        tracked.Status = Status.Blocked;
        tracked.BlockedReason = reason;
        tracked.BlockedAt = DateTime.UtcNow;
        tracked.PreviousStatus = Status.Todo;
        await repository.UpdateAsync(tracked);

        var evt = Assert.Single(await EventsAsync(context));
        Assert.Equal("Blocked", evt.EventType);
        Assert.Equal(expectedSummary, evt.ChangeSummary);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteUnblockedEvent_NeverStatusChanged_WhenLeavingBlocked()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var tracked = await SeedAndTrackAsync(context, new TaskItem
        {
            Id = 1,
            Title = "Task",
            Status = Status.Blocked,
            BlockedReason = "x",
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo
        });

        tracked.Status = Status.Todo;
        tracked.BlockedReason = null;
        tracked.BlockedAt = null;
        tracked.PreviousStatus = null;
        await repository.UpdateAsync(tracked);

        var evt = Assert.Single(await EventsAsync(context));
        Assert.Equal("Unblocked", evt.EventType);
        Assert.Equal("Unblocked, back to Todo.", evt.ChangeSummary);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteSingleCompletedEvent_WhenBlockedTaskCompleted()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var tracked = await SeedAndTrackAsync(context, new TaskItem
        {
            Id = 1,
            Title = "Task",
            Status = Status.Blocked,
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo
        });

        tracked.Status = Status.Completed;
        tracked.BlockedReason = null;
        tracked.BlockedAt = null;
        tracked.PreviousStatus = null;
        await repository.UpdateAsync(tracked);

        var evt = Assert.Single(await EventsAsync(context));
        Assert.Equal("Completed", evt.EventType);
        Assert.Equal("Marked complete (was blocked).", evt.ChangeSummary);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteBlockedReasonChangedEvent_WhenReasonChangesWhileBlocked()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var tracked = await SeedAndTrackAsync(context, new TaskItem
        {
            Id = 1,
            Title = "Task",
            Status = Status.Blocked,
            BlockedReason = "Old",
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo
        });

        tracked.BlockedReason = "New";
        await repository.UpdateAsync(tracked);

        var evt = Assert.Single(await EventsAsync(context));
        Assert.Equal("BlockedReasonChanged", evt.EventType);
        Assert.Equal("Blocked reason updated.", evt.ChangeSummary);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteBlockedReasonChangedEvent_WhenDetachedTaskGainsReason()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var blockedAt = DateTime.UtcNow;
        await context.TaskItems.AddAsync(new TaskItem
        {
            Id = 1,
            Title = "Task",
            Status = Status.Blocked,
            BlockedReason = null,
            BlockedAt = blockedAt,
            PreviousStatus = Status.Todo
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        await repository.UpdateAsync(new TaskItem
        {
            Id = 1,
            Title = "Task",
            Status = Status.Blocked,
            BlockedReason = "Now with reason",
            BlockedAt = blockedAt,
            PreviousStatus = Status.Todo
        });

        var evt = Assert.Single(await EventsAsync(context));
        Assert.Equal("BlockedReasonChanged", evt.EventType);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteNoEvent_WhenBlockedReasonUnchangedOrOnlyWhitespaceDiffers()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var tracked = await SeedAndTrackAsync(context, new TaskItem
        {
            Id = 1,
            Title = "Task",
            Status = Status.Blocked,
            BlockedReason = "Same",
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo
        });

        tracked.BlockedReason = " Same ";
        await repository.UpdateAsync(tracked);

        Assert.Empty(await EventsAsync(context));
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteNoStatusEvent_WhenStatusUnchanged()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        await context.TaskItems.AddAsync(new TaskItem { Id = 1, Title = "Task", Status = Status.Completed });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.Title = "Renamed";
        await repository.UpdateAsync(tracked);

        var events = await context.TaskItemEvents.Where(e => e.TaskItemId == 1).ToListAsync();
        Assert.Equal("TitleChanged", Assert.Single(events).EventType);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteDescriptionAndDueDateHistoryEvents_WhenValuesChange()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var dueDate = new DateTime(2026, 5, 20, 0, 0, 0, DateTimeKind.Utc);
        var task = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Initial description",
            Status = Status.Todo,
            DueDate = dueDate
        };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.Description = "Updated description";
        tracked.DueDate = dueDate.AddDays(3);

        await repository.UpdateAsync(tracked);

        var events = await context.TaskItemEvents
            .Where(e => e.TaskItemId == tracked.Id)
            .OrderBy(e => e.OccurredAtUtc)
            .ToListAsync();

        Assert.Contains(events, e => e.EventType == "DescriptionChanged");
        Assert.Contains(events, e => e.EventType == "DueDateChanged");
    }

    [Fact]
    public async Task DeleteAsync_ShouldRemoveTask_WhenTaskExists()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Task to Delete", Description = "Description" };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();

        // Act
        await repository.DeleteAsync(1);

        // Assert
        var deletedTask = await context.TaskItems.FindAsync(1);
        Assert.Null(deletedTask);
    }

    [Fact]
    public async Task DeleteAsync_ShouldNotThrow_WhenTaskDoesNotExist()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        // Act
        var act = async () => await repository.DeleteAsync(999);

        // Assert
        Assert.Null(await Record.ExceptionAsync(act));
    }

    [Fact]
    public async Task DeleteAsync_ShouldOnlyDeleteSpecifiedTask()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var tasks = new List<TaskItem>
        {
            new() { Id = 1, Title = "Task 1", Description = "Description 1", Status = Status.Todo },
            new() { Id = 2, Title = "Task 2", Description = "Description 2", Status = Status.Completed }
        };
        await context.TaskItems.AddRangeAsync(tasks);
        await context.SaveChangesAsync();

        // Act
        await repository.DeleteAsync(1);

        // Assert
        var remainingTasks = await context.TaskItems.ToListAsync();
        Assert.Single(remainingTasks);
        Assert.Equal(2, remainingTasks.First().Id);
    }

    [Fact]
    public async Task GetChildrenAsync_ShouldReturnOnlyDirectChildren()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        await context.TaskItems.AddRangeAsync(
            new TaskItem { Id = 1, Title = "Parent", Status = Status.Todo },
            new TaskItem { Id = 2, Title = "Open child", Status = Status.Todo, ParentTaskItemId = 1 },
            new TaskItem { Id = 3, Title = "Done child", Status = Status.Completed, ParentTaskItemId = 1 },
            new TaskItem { Id = 4, Title = "Other parent", Status = Status.Todo },
            new TaskItem { Id = 5, Title = "Other child", Status = Status.Todo, ParentTaskItemId = 4 },
            new TaskItem { Id = 6, Title = "Unrelated", Status = Status.Todo });
        await context.SaveChangesAsync();

        // Act
        var children = (await repository.GetChildrenAsync(1)).ToList();

        // Assert
        Assert.Equal([2, 3], children.Select(c => c.Id).Order());
    }

    [Fact]
    public async Task GetChildrenAsync_ShouldReturnEmpty_WhenTaskHasNoChildren()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        await context.TaskItems.AddRangeAsync(
            new TaskItem { Id = 1, Title = "Childless", Status = Status.Todo },
            new TaskItem { Id = 2, Title = "Other parent", Status = Status.Todo },
            new TaskItem { Id = 3, Title = "Other child", Status = Status.Todo, ParentTaskItemId = 2 });
        await context.SaveChangesAsync();

        // Act
        var children = await repository.GetChildrenAsync(1);

        // Assert
        Assert.Empty(children);
    }

    [Fact]
    public async Task GetChildrenAsync_ShouldReturnEmpty_WhenParentDoesNotExist()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);

        // Act
        var children = await repository.GetChildrenAsync(999);

        // Assert
        Assert.Empty(children);
    }
}
