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

public class JournalTodosControllerV1Tests
{
    private readonly Mock<IJournalEntryRepository> _journalRepo = new();
    private readonly Mock<ITaskRepository> _taskRepo = new();
    private readonly Mock<IValidator<AddJournalTodoDto>> _mockValidator = new();
    private readonly JournalTodosController _controller;

    public JournalTodosControllerV1Tests()
    {
        _mockValidator
            .Setup(v => v.ValidateAsync(It.IsAny<AddJournalTodoDto>(), default))
            .ReturnsAsync(new ValidationResult());
        _controller = new JournalTodosController(_journalRepo.Object, _taskRepo.Object, _mockValidator.Object);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryMissing()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(1);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetAll_ShouldReturnOk_WhenEntryExists()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync(
        [
            new TaskItem { Id = 2, Title = "Task", Status = Status.Todo, Priority = Priority.Low }
        ]);

        var result = await _controller.GetAll(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var todos = ok.Value.Should().BeAssignableTo<IEnumerable<TaskItemResponseDto>>().Subject;
        todos.Should().ContainSingle(t => t.Id == 2 && t.Status == "Todo");
    }

    [Fact]
    public async Task AddTodo_ShouldReturnBadRequest_WhenTaskIdInvalid()
    {
        var dto = new AddJournalTodoDto { TaskItemId = 0 };
        _mockValidator
            .Setup(v => v.ValidateAsync(dto, default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("TaskItemId", "TaskItemId must be greater than 0.")]));

        var result = await _controller.AddTodo(1, dto);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task AddTodo_ShouldReturnNotFound_WhenTaskMissing()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _taskRepo.Setup(s => s.GetByIdAsync(9)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 9 });

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task AddTodo_ShouldReturnConflict_WhenAlreadyLinked()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _taskRepo.Setup(s => s.GetByIdAsync(4)).ReturnsAsync(new TaskItem { Id = 4, Title = "Task", Status = Status.Todo });
        _journalRepo.Setup(s => s.TodoExistsAsync(1, 4)).ReturnsAsync(true);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        result.Should().BeOfType<ConflictObjectResult>();
        _journalRepo.Verify(s => s.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnNoContent_WhenValid()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _taskRepo.Setup(s => s.GetByIdAsync(4)).ReturnsAsync(new TaskItem { Id = 4, Title = "Task", Status = Status.Todo });
        _journalRepo.Setup(s => s.TodoExistsAsync(1, 4)).ReturnsAsync(false);
        _journalRepo.Setup(s => s.AddTodoAsync(1, 4)).ReturnsAsync(true);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        result.Should().BeOfType<NoContentResult>();
        _journalRepo.Verify(s => s.AddTodoAsync(1, 4), Times.Once);
    }

    [Fact]
    public async Task RemoveTodo_ShouldReturnNoContent_WhenLinked()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.TodoExistsAsync(1, 4)).ReturnsAsync(true);
        _journalRepo.Setup(s => s.RemoveTodoAsync(1, 4)).ReturnsAsync(true);

        var result = await _controller.RemoveTodo(1, 4);

        result.Should().BeOfType<NoContentResult>();
        _journalRepo.Verify(s => s.RemoveTodoAsync(1, 4), Times.Once);
    }
}

