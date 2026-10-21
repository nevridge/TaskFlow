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
            new() { Id = 1, Title = "Task 1", Description = "Description 1", IsComplete = false, Status = Status.Todo },
            new() { Id = 2, Title = "Task 2", Description = "Description 2", IsComplete = true, Status = Status.Completed }
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
            IsComplete = false,
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
        var newTask = new TaskItem { Title = "New Task", Description = "Description", IsComplete = false };

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
        var newTask = new TaskItem { Title = "Task", Description = null, IsComplete = false };

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
        var newTask = new TaskItem { Title = "Completed Task", Description = "Done", IsComplete = true };

        // Act
        var result = await repository.AddAsync(newTask);

        // Assert
        Assert.NotNull(result);
        Assert.True(result.IsComplete);

        var savedTask = await context.TaskItems.FindAsync(result.Id);
        Assert.NotNull(savedTask);
        Assert.True(savedTask.IsComplete);
    }

    [Fact]
    public async Task UpdateAsync_ShouldUpdateExistingTask()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Original", Description = "Original Description", IsComplete = false };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();

        // Modify the task
        task.Title = "Updated";
        task.Description = "Updated Description";
        task.IsComplete = true;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var updatedTask = await context.TaskItems.FindAsync(1);
        Assert.NotNull(updatedTask);
        Assert.Equal("Updated", updatedTask.Title);
        Assert.Equal("Updated Description", updatedTask.Description);
        Assert.True(updatedTask.IsComplete);
    }

    [Fact]
    public async Task UpdateAsync_ShouldHandlePartialUpdate()
    {
        // Arrange
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Original", Description = "Description", IsComplete = false };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();

        // Modify only IsComplete
        task.IsComplete = true;

        // Act
        await repository.UpdateAsync(task);

        // Assert
        var updatedTask = await context.TaskItems.FindAsync(1);
        Assert.NotNull(updatedTask);
        Assert.Equal("Original", updatedTask.Title);
        Assert.Equal("Description", updatedTask.Description);
        Assert.True(updatedTask.IsComplete);
    }

    [Fact]
    public async Task UpdateAsync_ShouldWriteTitleAndPriorityHistoryEvents_WhenValuesChange()
    {
        using var context = CreateInMemoryContext();
        var repository = new TaskRepository(context);
        var task = new TaskItem { Id = 1, Title = "Original", Description = "Description", IsComplete = false, Priority = Priority.Low, Status = Status.Todo };
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
        var task = new TaskItem { Id = 1, Title = "Task", Description = "Description", IsComplete = false, Status = Status.Todo };
        await context.TaskItems.AddAsync(task);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.IsComplete = true;
        tracked.Status = Status.Completed;
        await repository.UpdateAsync(tracked);

        context.ChangeTracker.Clear();
        tracked = await context.TaskItems.FindAsync(1);
        Assert.NotNull(tracked);
        tracked.IsComplete = false;
        tracked.Status = Status.Todo;
        await repository.UpdateAsync(tracked);

        var events = await context.TaskItemEvents
            .Where(e => e.TaskItemId == task.Id)
            .OrderBy(e => e.OccurredAtUtc)
            .ToListAsync();

        Assert.Contains(events, e => e.EventType == "Completed");
        Assert.Contains(events, e => e.EventType == "Reopened");
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
            IsComplete = false,
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
        var task = new TaskItem { Id = 1, Title = "Task to Delete", Description = "Description", IsComplete = false };
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
            new() { Id = 1, Title = "Task 1", Description = "Description 1", IsComplete = false },
            new() { Id = 2, Title = "Task 2", Description = "Description 2", IsComplete = true }
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
}
