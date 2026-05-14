using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Tests.Controllers.V1;

public class JournalTodosControllerV1Tests
{
    private readonly Mock<IJournalEntryService> _journalService = new();
    private readonly Mock<ITaskService> _taskService = new();
    private readonly JournalTodosController _controller;

    public JournalTodosControllerV1Tests()
    {
        _controller = new JournalTodosController(_journalService.Object, _taskService.Object);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryMissing()
    {
        _journalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(1);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetAll_ShouldReturnOk_WhenEntryExists()
    {
        _journalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _journalService.Setup(s => s.GetTodosAsync(1)).ReturnsAsync(
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
        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 0 });

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task AddTodo_ShouldReturnNotFound_WhenTaskMissing()
    {
        _journalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _taskService.Setup(s => s.GetTaskAsync(9)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 9 });

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task AddTodo_ShouldReturnConflict_WhenAlreadyLinked()
    {
        _journalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _taskService.Setup(s => s.GetTaskAsync(4)).ReturnsAsync(new TaskItem { Id = 4, Title = "Task", Status = Status.Todo });
        _journalService.Setup(s => s.TodoExistsAsync(1, 4)).ReturnsAsync(true);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        result.Should().BeOfType<ConflictObjectResult>();
        _journalService.Verify(s => s.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnNoContent_WhenValid()
    {
        _journalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _taskService.Setup(s => s.GetTaskAsync(4)).ReturnsAsync(new TaskItem { Id = 4, Title = "Task", Status = Status.Todo });
        _journalService.Setup(s => s.TodoExistsAsync(1, 4)).ReturnsAsync(false);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        result.Should().BeOfType<NoContentResult>();
        _journalService.Verify(s => s.AddTodoAsync(1, 4), Times.Once);
    }

    [Fact]
    public async Task RemoveTodo_ShouldReturnNoContent_WhenLinked()
    {
        _journalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _journalService.Setup(s => s.TodoExistsAsync(1, 4)).ReturnsAsync(true);

        var result = await _controller.RemoveTodo(1, 4);

        result.Should().BeOfType<NoContentResult>();
        _journalService.Verify(s => s.RemoveTodoAsync(1, 4), Times.Once);
    }
}
