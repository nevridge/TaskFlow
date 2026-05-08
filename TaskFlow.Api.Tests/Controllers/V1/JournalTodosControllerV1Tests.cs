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
    private readonly Mock<IJournalEntryService> _mockJournalService;
    private readonly Mock<ITaskService> _mockTaskService;
    private readonly JournalTodosController _controller;

    public JournalTodosControllerV1Tests()
    {
        _mockJournalService = new Mock<IJournalEntryService>();
        _mockTaskService = new Mock<ITaskService>();
        _controller = new JournalTodosController(_mockJournalService.Object, _mockTaskService.Object);
    }

    // --- GET all ---

    [Fact]
    public async Task GetAll_ShouldReturnOkWithTodos_WhenEntryExists()
    {
        var todos = new List<TaskItem>
        {
            new() { Id = 1, Title = "Task 1", Status = Status.Draft, Priority = Priority.Low },
            new() { Id = 2, Title = "Task 2", Status = Status.Completed, Priority = Priority.High }
        };
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1), Todos = todos };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);

        var result = await _controller.GetAll(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = ok.Value.Should().BeAssignableTo<IEnumerable<TaskItemResponseDto>>().Subject.ToList();
        dtos.Should().HaveCount(2);
        dtos[0].Status.Should().Be("draft");
        dtos[1].Priority.Should().Be("high");
        _mockJournalService.Verify(s => s.GetTodosAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(99);

        result.Result.Should().BeOfType<NotFoundResult>();
        _mockJournalService.Verify(s => s.GetTodosAsync(It.IsAny<int>()), Times.Never);
    }

    // --- POST ---

    [Fact]
    public async Task Add_ShouldReturnNoContent_WhenSuccessful()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var task = new TaskItem { Id = 5, Title = "Task 5" };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockTaskService.Setup(s => s.GetTaskAsync(5)).ReturnsAsync(task);
        _mockJournalService.Setup(s => s.GetTodoAsync(1, 5)).ReturnsAsync((TaskItem?)null);
        _mockJournalService.Setup(s => s.AddTodoAsync(1, 5)).Returns(Task.CompletedTask);

        var result = await _controller.Add(1, new AddJournalTodoDto { TaskItemId = 5 });

        result.Should().BeOfType<NoContentResult>();
        _mockJournalService.Verify(s => s.AddTodoAsync(1, 5), Times.Once);
    }

    [Fact]
    public async Task Add_ShouldReturnBadRequest_WhenTaskItemIdIsInvalid()
    {
        var result = await _controller.Add(1, new AddJournalTodoDto { TaskItemId = 0 });

        var badRequest = result.Should().BeOfType<BadRequestObjectResult>().Subject;
        badRequest.Value.Should().BeOfType<ValidationProblemDetails>()
            .Which.Errors.Should().ContainKey("TaskItemId");
        _mockJournalService.Verify(s => s.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
        _mockTaskService.Verify(s => s.GetTaskAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Add_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Add(99, new AddJournalTodoDto { TaskItemId = 1 });

        result.Should().BeOfType<NotFoundResult>();
        _mockJournalService.Verify(s => s.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Add_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockTaskService.Setup(s => s.GetTaskAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Add(1, new AddJournalTodoDto { TaskItemId = 99 });

        result.Should().BeOfType<NotFoundResult>();
        _mockJournalService.Verify(s => s.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Add_ShouldReturnConflict_WhenTaskAlreadyLinked()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var task = new TaskItem { Id = 5, Title = "Task 5" };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockTaskService.Setup(s => s.GetTaskAsync(5)).ReturnsAsync(task);
        _mockJournalService.Setup(s => s.GetTodoAsync(1, 5)).ReturnsAsync(task);

        var result = await _controller.Add(1, new AddJournalTodoDto { TaskItemId = 5 });

        result.Should().BeOfType<ConflictResult>();
        _mockJournalService.Verify(s => s.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    // --- DELETE ---

    [Fact]
    public async Task Remove_ShouldReturnNoContent_WhenSuccessful()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var task = new TaskItem { Id = 5, Title = "Task 5" };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockJournalService.Setup(s => s.GetTodoAsync(1, 5)).ReturnsAsync(task);
        _mockJournalService.Setup(s => s.RemoveTodoAsync(1, 5)).Returns(Task.CompletedTask);

        var result = await _controller.Remove(1, 5);

        result.Should().BeOfType<NoContentResult>();
        _mockJournalService.Verify(s => s.RemoveTodoAsync(1, 5), Times.Once);
    }

    [Fact]
    public async Task Remove_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Remove(99, 5);

        result.Should().BeOfType<NotFoundResult>();
        _mockJournalService.Verify(s => s.RemoveTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Remove_ShouldReturnNotFound_WhenTaskNotLinked()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockJournalService.Setup(s => s.GetTodoAsync(1, 99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Remove(1, 99);

        result.Should().BeOfType<NotFoundResult>();
        _mockJournalService.Verify(s => s.RemoveTodoAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }
}
