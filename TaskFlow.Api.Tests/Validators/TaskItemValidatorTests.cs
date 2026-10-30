using TaskFlow.Api.Models;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Validators;

public class TaskItemValidatorTests
{
    private readonly TaskItemValidator _validator;

    public TaskItemValidatorTests()
    {
        _validator = new TaskItemValidator();
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTaskIsValid()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Valid Task",
            Description = "Valid Description",
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenDescriptionIsNull()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Valid Task",
            Description = null,
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTaskIsComplete()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Completed Task",
            Description = "Completed",
            Status = Status.Completed
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenTitleIsEmpty()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = string.Empty,
            Description = "Description",
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.False(result.IsValid);
        Assert.Single(result.Errors);
        Assert.Equal("Title", result.Errors[0].PropertyName);
        Assert.Equal("Title is required.", result.Errors[0].ErrorMessage);
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenTitleExceedsMaxLength()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = new string('a', 101), // 101 characters
            Description = "Description",
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.False(result.IsValid);
        Assert.Single(result.Errors);
        Assert.Equal("Title", result.Errors[0].PropertyName);
        Assert.Equal("Title must not exceed 100 characters.", result.Errors[0].ErrorMessage);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTitleIsExactly100Characters()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = new string('a', 100), // Exactly 100 characters
            Description = "Description",
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenTitleIs1Character()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "A",
            Description = "Description",
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenDescriptionIsEmpty()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Valid Task",
            Description = string.Empty,
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenDescriptionIsVeryLong()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Valid Task",
            Description = new string('a', 10000),
            Status = Status.Todo
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenStatusIsDraft()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Draft Task",
            Description = "Description",
            Status = Status.Draft
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenStatusIsCompleted()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Completed Task",
            Description = "Description",
            Status = Status.Completed
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenStatusIsOutOfRange()
    {
        // Arrange
        var task = new TaskItem
        {
            Title = "Task",
            Description = "Description",
            Status = (Status)999
        };

        // Act
        var result = await _validator.ValidateAsync(task);

        // Assert
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e =>
            e.PropertyName == "Status" &&
            e.ErrorMessage == "Status must be a valid value (Draft, Todo, InProgress, Blocked, or Completed).");
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenBlockedWithAllBlockedFields()
    {
        var task = new TaskItem
        {
            Title = "Blocked",
            Status = Status.Blocked,
            BlockedReason = new string('a', 200),
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo
        };

        var result = await _validator.ValidateAsync(task);

        Assert.True(result.IsValid);
    }

    [Fact]
    public async Task Validate_ShouldFail_WhenBlockedReasonExceeds200Characters()
    {
        var task = new TaskItem
        {
            Title = "Blocked",
            Status = Status.Blocked,
            BlockedReason = new string('a', 201),
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo
        };

        var result = await _validator.ValidateAsync(task);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e =>
            e.PropertyName == "BlockedReason" &&
            e.ErrorMessage == "Blocked reason must not exceed 200 characters.");
    }

    [Theory]
    [InlineData(Status.Draft)]
    [InlineData(Status.Todo)]
    [InlineData(Status.InProgress)]
    [InlineData(Status.Completed)]
    public async Task Validate_ShouldFail_WhenNonBlockedTaskHasBlockedFields(Status status)
    {
        var reason = new TaskItem { Title = "T", Status = status, BlockedReason = "x" };
        var at = new TaskItem { Title = "T", Status = status, BlockedAt = DateTime.UtcNow };
        var previous = new TaskItem { Title = "T", Status = status, PreviousStatus = Status.Todo };

        foreach (var task in new[] { reason, at, previous })
        {
            var result = await _validator.ValidateAsync(task);

            Assert.False(result.IsValid);
            Assert.Contains(result.Errors, e => e.ErrorMessage == "Blocked details can only be set while the task is Blocked.");
        }
    }

    [Fact]
    public async Task Validate_ShouldPass_WhenNonBlockedTaskHasNoBlockedFields()
    {
        var result = await _validator.ValidateAsync(new TaskItem { Title = "T", Status = Status.Todo });

        Assert.True(result.IsValid);
    }
}
