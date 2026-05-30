using FluentAssertions;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Controllers.V1;

public class TaskItemsControllerV1Tests
{
    private readonly Mock<ITaskRepository> _mockRepo;
    private readonly Mock<IValidator<TaskItem>> _mockValidator;
    private readonly Mock<IJournalEntryRepository> _mockJournalRepo;
    private readonly TaskItemsController _controller;

    public TaskItemsControllerV1Tests()
    {
        _mockRepo = new Mock<ITaskRepository>();
        _mockValidator = new Mock<IValidator<TaskItem>>();
        _mockJournalRepo = new Mock<IJournalEntryRepository>();
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(It.IsAny<int>())).ReturnsAsync((DateOnly?)null);
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([]);
        _mockRepo.Setup(r => r.GetHistoryAsync(It.IsAny<int>())).ReturnsAsync([]);
        _controller = new TaskItemsController(_mockRepo.Object, _mockValidator.Object, _mockJournalRepo.Object);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOkWithAllTasks()
    {
        // Arrange
        var dueDate = new DateTime(2025, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        var tasks = new List<TaskItem>
        {
            new() { Id = 1, Title = "Task 1", Description = "Description 1", IsComplete = false, Status = Status.Todo, Priority = Priority.Low, DueDate = dueDate },
            new() { Id = 2, Title = "Task 2", Description = "Description 2", IsComplete = true, Status = Status.Completed, Priority = Priority.High }
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync(tasks);

        // Act
        var result = await _controller.GetAll();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = okResult.Value.Should().BeAssignableTo<IEnumerable<TaskItemResponseDto>>().Subject;
        dtos.Should().HaveCount(2);
        dtos.Should().Contain(d => d.Id == 1 && d.Title == "Task 1" && d.Status == "Todo" && d.Priority == "Low" && d.DueDate == dueDate);
        dtos.Should().Contain(d => d.Id == 2 && d.Title == "Task 2" && d.Status == "Completed" && d.Priority == "High" && d.DueDate == null);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Once);
    }

    [Fact]
    public async Task Get_ShouldReturnOkWithTask_WhenTaskExists()
    {
        // Arrange
        var dueDate = new DateTime(2025, 6, 15, 0, 0, 0, DateTimeKind.Utc);
        var task = new TaskItem
        {
            Id = 1,
            Title = "Task 1",
            Description = "Description",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Medium,
            DueDate = dueDate
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);

        // Act
        var result = await _controller.Get(1);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = okResult.Value.Should().BeOfType<TaskItemResponseDto>().Subject;
        dto.Id.Should().Be(1);
        dto.Title.Should().Be("Task 1");
        dto.Description.Should().Be("Description");
        dto.IsComplete.Should().BeFalse();
        dto.Status.Should().Be("Todo");
        dto.Priority.Should().Be("Medium");
        dto.DueDate.Should().Be(dueDate);
        _mockRepo.Verify(r => r.GetByIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        // Arrange
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync((TaskItem?)null);

        // Act
        var result = await _controller.Get(1);

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
        _mockRepo.Verify(r => r.GetByIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldReturnCreatedAtRoute_WhenValid()
    {
        // Arrange
        var dueDate = new DateTime(2025, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        var createDto = new CreateTaskItemDto
        {
            Title = "New Task",
            Description = "New Description",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.High,
            DueDate = dueDate
        };
        var createdTask = new TaskItem
        {
            Id = 1,
            Title = createDto.Title,
            Description = createDto.Description,
            IsComplete = createDto.IsComplete,
            Status = createDto.Status,
            Priority = createDto.Priority,
            DueDate = createDto.DueDate
        };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>()))
            .ReturnsAsync(createdTask);

        // Act
        var result = await _controller.Create(createDto);

        // Assert
        var createdResult = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        createdResult.RouteName.Should().Be("GetTaskV1");
        createdResult.RouteValues.Should().ContainKey("version").WhoseValue.Should().Be("1.0");
        createdResult.RouteValues.Should().ContainKey("id").WhoseValue.Should().Be(1);

        // Controller now returns TaskItemResponseDto, not TaskItem
        var responseDto = createdResult.Value.Should().BeOfType<TaskItemResponseDto>().Subject;
        responseDto.Id.Should().Be(1);
        responseDto.Title.Should().Be("New Task");
        responseDto.Description.Should().Be("New Description");
        responseDto.IsComplete.Should().BeFalse();
        responseDto.Status.Should().Be("Todo");
        responseDto.Priority.Should().Be("High");
        responseDto.DueDate.Should().Be(dueDate);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenParentTaskDoesNotExist()
    {
        var createDto = new CreateTaskItemDto
        {
            Title = "New Task",
            Description = "Desc",
            ParentTaskItemId = 999
        };

        _mockRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Create(createDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenJournalDateIsPast()
    {
        var createDto = new CreateTaskItemDto
        {
            Title = "Task",
            JournalDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1))
        };

        var result = await _controller.Create(createDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenJournalDateIsYesterdayInUserTimezone()
    {
        // timezoneOffsetMinutes uses UTC-offset convention (negative = west of UTC)
        // User's "today" = utcNow + offset; a negative offset shifts the date earlier
        const int offsetMinutes = -300; // UTC-5 (e.g. CDT)
        var userYesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(offsetMinutes).AddDays(-1));

        var createDto = new CreateTaskItemDto
        {
            Title = "Task",
            JournalDate = userYesterday,
            TimezoneOffsetMinutes = offsetMinutes
        };

        var result = await _controller.Create(createDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldAssignToJournalDate_WhenJournalDateIsProvided()
    {
        var targetDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        var createDto = new CreateTaskItemDto
        {
            Title = "Scheduled task",
            JournalDate = targetDate
        };

        var createdTask = new TaskItem
        {
            Id = 77,
            Title = "Scheduled task",
            Status = Status.Todo
        };
        var entry = new JournalEntry { Id = 12, Date = targetDate, Title = "Journal" };

        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);
        _mockRepo.Setup(r => r.GetByIdAsync(77)).ReturnsAsync(createdTask);
        _mockJournalRepo.Setup(r => r.GetByDateAsync(targetDate)).ReturnsAsync(entry);
        _mockJournalRepo.Setup(r => r.AddTodoAsync(entry.Id, createdTask.Id)).ReturnsAsync(AddTodoResult.Success);

        var result = await _controller.Create(createDto);

        result.Result.Should().BeOfType<CreatedAtRouteResult>();
        _mockJournalRepo.Verify(r => r.AddTodoAsync(entry.Id, createdTask.Id), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenParentWouldExceedOneLevelDepth()
    {
        var createDto = new CreateTaskItemDto
        {
            Title = "New Task",
            Description = "Desc",
            ParentTaskItemId = 5
        };

        _mockRepo.Setup(r => r.GetByIdAsync(5)).ReturnsAsync(new TaskItem
        {
            Id = 5,
            Title = "Existing Child",
            ParentTaskItemId = 1
        });

        var result = await _controller.Create(createDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnOkWithUpdatedTask_WhenValid()
    {
        // Arrange
        var dueDate = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Updated Task",
            Description = "Updated Description",
            IsComplete = true,
            Status = Status.Completed,
            Priority = Priority.Medium,
            DueDate = dueDate
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Old Task",
            Description = "Old",
            IsComplete = false,
            Status = Status.Completed,
            Priority = Priority.Low
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        // Controller now returns 200 OK with TaskItemResponseDto instead of 204 NoContent
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var responseDto = okResult.Value.Should().BeOfType<TaskItemResponseDto>().Subject;
        responseDto.Id.Should().Be(1);
        responseDto.Title.Should().Be("Updated Task");
        responseDto.Description.Should().Be("Updated Description");
        responseDto.IsComplete.Should().BeTrue();
        responseDto.Status.Should().Be("Completed");
        responseDto.Priority.Should().Be("Medium");
        responseDto.DueDate.Should().Be(dueDate);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenTaskExists()
    {
        // Arrange
        var task = new TaskItem { Id = 1, Title = "Task 1", Description = "Description", IsComplete = false, Status = Status.Todo };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockRepo.Setup(r => r.DeleteAsync(1)).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Delete(1);

        // Assert
        result.Should().BeOfType<NoContentResult>();
        _mockRepo.Verify(r => r.DeleteAsync(1), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        // Arrange
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync((TaskItem?)null);

        // Act
        var result = await _controller.Delete(1);

        // Assert
        result.Should().BeOfType<NotFoundResult>();
        _mockRepo.Verify(r => r.DeleteAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOkWithEmptyList_WhenNoTasks()
    {
        // Arrange
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([]);

        // Act
        var result = await _controller.GetAll();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = okResult.Value.Should().BeAssignableTo<IEnumerable<TaskItemResponseDto>>().Subject;
        dtos.Should().BeEmpty();
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        // Arrange
        var createDto = new CreateTaskItemDto { Title = "", Description = "Description", IsComplete = false };
        var validationFailures = new List<ValidationFailure>
        {
            new("Title", "Title is required.")
        };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult(validationFailures));

        // Act
        var result = await _controller.Create(createDto);

        // Assert
        var badRequestResult = result.Result.Should().BeOfType<BadRequestObjectResult>().Subject;
        badRequestResult.Value.Should().BeEquivalentTo(validationFailures);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldHandleTaskWithNullDescription()
    {
        // Arrange
        var createDto = new CreateTaskItemDto { Title = "Task", Description = null, IsComplete = false };
        var createdTask = new TaskItem { Id = 1, Title = "Task", Description = null, IsComplete = false };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);

        // Act
        var result = await _controller.Create(createDto);

        // Assert
        var createdResult = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var dto = createdResult.Value.Should().BeOfType<TaskItemResponseDto>().Subject;
        dto.Title.Should().Be("Task");
        dto.Description.Should().BeNull();
        dto.IsComplete.Should().BeFalse();
        dto.Status.Should().Be("Draft");
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto { Title = "Updated Task", Description = "Updated Description", IsComplete = true };
        _mockRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((TaskItem?)null);

        // Act
        var result = await _controller.Update(999, updateDto);

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
        _mockRepo.Verify(r => r.GetByIdAsync(999), Times.Once);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnBadRequest_WhenValidationFails()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto { Title = "", Description = "Description", IsComplete = true };
        var existingTask = new TaskItem { Id = 1, Title = "Old Task", Description = "Old Description", IsComplete = false };
        var validationFailures = new List<ValidationFailure>
        {
            new("Title", "Title is required.")
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult(validationFailures));

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        var badRequestResult = result.Result.Should().BeOfType<BadRequestObjectResult>().Subject;
        badRequestResult.Value.Should().BeEquivalentTo(validationFailures);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldPreserveExistingPriority_WhenPriorityOmitted()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Updated Task",
            Description = "Updated Description",
            IsComplete = true,
            Status = Status.Completed,
            Priority = null // omitted — should preserve existing priority
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Old Task",
            Description = "Old",
            IsComplete = false,
            Status = Status.Completed,
            Priority = Priority.High
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var responseDto = okResult.Value.Should().BeOfType<TaskItemResponseDto>().Subject;
        responseDto.Priority.Should().Be("High"); // Priority preserved from existing task
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenReopeningTaskAssignedToPastDay()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            IsComplete = true,
            Status = Status.Completed,
            Priority = Priority.Low
        };

        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(yesterday);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        var unprocessable = result.Result.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        unprocessable.Value.Should().NotBeNull();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldAllowReopeningTaskAssignedToToday()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            IsComplete = true,
            Status = Status.Completed,
            Priority = Priority.Low
        };

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(today);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        result.Result.Should().BeOfType<OkObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenParentTaskMatchesSelf()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 1
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);

        var result = await _controller.Update(1, updateDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenParentTaskDoesNotExist()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 12
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Update(1, updateDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenParentWouldExceedOneLevelDepth()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 12
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync(new TaskItem
        {
            Id = 12,
            Title = "Existing Child",
            ParentTaskItemId = 4
        });

        var result = await _controller.Update(1, updateDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenTaskWithChildrenIsAssignedParent()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Existing Parent",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 12
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Existing Parent",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };

        var parentCandidate = new TaskItem
        {
            Id = 12,
            Title = "New Parent",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };

        var existingChild = new TaskItem
        {
            Id = 2,
            Title = "Child",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 1
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync(parentCandidate);
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([existingTask, parentCandidate, existingChild]);

        var result = await _controller.Update(1, updateDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenCompletingParentWithOpenChildren()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Parent",
            Description = "Desc",
            IsComplete = true,
            Status = Status.Completed,
            Priority = Priority.Low,
            ParentTaskItemId = null
        };

        var parentTask = new TaskItem
        {
            Id = 1,
            Title = "Parent",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };

        var childTask = new TaskItem
        {
            Id = 2,
            Title = "Child",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            ParentTaskItemId = 1
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(parentTask);
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([parentTask, childTask]);

        var result = await _controller.Update(1, updateDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenParentAssignmentWouldCreateCycle()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Root",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 3
        };

        var root = new TaskItem { Id = 1, Title = "Root", Status = Status.Todo };
        var child = new TaskItem { Id = 2, Title = "Child", Status = Status.Todo, ParentTaskItemId = 1 };
        var grandchild = new TaskItem { Id = 3, Title = "Grandchild", Status = Status.Todo, ParentTaskItemId = 2 };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(root);
        _mockRepo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(grandchild);
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([root, child, grandchild]);

        var result = await _controller.Update(1, updateDto);

        result.Result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task GetHistory_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(7)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.GetHistory(7);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetHistory_ShouldReturnOk_WhenTaskExists()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "Task" });
        _mockRepo.Setup(r => r.GetHistoryAsync(1)).ReturnsAsync([
            new TaskItemEvent
            {
                Id = 10,
                TaskItemId = 1,
                EventType = "AssignedToJournalDay",
                OccurredAtUtc = DateTime.UtcNow,
                ToJournalEntryId = 3,
                ToJournalDate = DateOnly.FromDateTime(DateTime.UtcNow),
                ChangeSummary = "Task was assigned to a journal day."
            }
        ]);

        var result = await _controller.GetHistory(1);

        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var history = okResult.Value.Should().BeAssignableTo<IEnumerable<TaskItemEventResponseDto>>().Subject;
        history.Should().ContainSingle(e => e.Id == 10 && e.EventType == "AssignedToJournalDay");
    }

    [Fact]
    public async Task Delete_ShouldReturnUnprocessableEntity_WhenTaskHasChildren()
    {
        var parent = new TaskItem { Id = 1, Title = "Parent" };
        var child = new TaskItem { Id = 2, Title = "Child", ParentTaskItemId = 1 };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(parent);
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([parent, child]);

        var result = await _controller.Delete(1);

        result.Should().BeOfType<UnprocessableEntityObjectResult>();
        _mockRepo.Verify(r => r.DeleteAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldAutoCompleteParent_WhenEnabledAndLastChildCompletes()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Child",
            Description = "Desc",
            IsComplete = true,
            Status = Status.Completed,
            Priority = Priority.Low,
            ParentTaskItemId = 10,
            AutoCompleteParentWhenChildrenDone = true
        };

        var child = new TaskItem
        {
            Id = 2,
            Title = "Child",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 10
        };
        var parent = new TaskItem
        {
            Id = 10,
            Title = "Parent",
            Description = "Desc",
            IsComplete = false,
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(2)).ReturnsAsync(child);
        _mockRepo.Setup(r => r.GetByIdAsync(10)).ReturnsAsync(parent);
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([
            parent,
            new TaskItem { Id = 2, Title = "Child", IsComplete = true, Status = Status.Completed, ParentTaskItemId = 10 }
        ]);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(2, updateDto);

        result.Result.Should().BeOfType<OkObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.Is<TaskItem>(t => t.Id == 2)), Times.Once);
        _mockRepo.Verify(r => r.UpdateAsync(It.Is<TaskItem>(t => t.Id == 10 && t.IsComplete && t.Status == Status.Completed)), Times.Once);
    }
}
