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

public class NotesControllerV1Tests
{
    private readonly Mock<INoteRepository> _mockNoteRepo;
    private readonly Mock<ITaskRepository> _mockTaskRepo;
    private readonly Mock<IValidator<Note>> _mockValidator;
    private readonly NotesController _controller;

    public NotesControllerV1Tests()
    {
        _mockNoteRepo = new Mock<INoteRepository>();
        _mockTaskRepo = new Mock<ITaskRepository>();
        _mockValidator = new Mock<IValidator<Note>>();
        _controller = new NotesController(_mockNoteRepo.Object, _mockTaskRepo.Object, _mockValidator.Object);
    }

    // --- GET all ---

    [Fact]
    public async Task GetAll_ShouldReturnOkWithNotes_WhenTaskExists()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        var notes = new List<Note>
        {
            new() { Id = 1, Content = "Note 1", TaskItemId = 1, CreatedAt = DateTime.UtcNow },
            new() { Id = 2, Content = "Note 2", TaskItemId = 1, CreatedAt = DateTime.UtcNow }
        };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetAllByTaskIdAsync(1)).ReturnsAsync(notes);

        var result = await _controller.GetAll(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = ok.Value.Should().BeAssignableTo<IEnumerable<NoteResponseDto>>().Subject;
        dtos.Should().HaveCount(2);
        _mockNoteRepo.Verify(r => r.GetAllByTaskIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.GetAll(99);

        result.Result.Should().BeOfType<NotFoundResult>();
        _mockNoteRepo.Verify(r => r.GetAllByTaskIdAsync(It.IsAny<int>()), Times.Never);
    }

    // --- GET single ---

    [Fact]
    public async Task Get_ShouldReturnOkWithNote_WhenNoteExists()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        var note = new Note { Id = 5, Content = "My note", TaskItemId = 1, CreatedAt = DateTime.UtcNow };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 5)).ReturnsAsync(note);

        var result = await _controller.Get(1, 5);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<NoteResponseDto>().Subject;
        dto.Id.Should().Be(5);
        dto.Content.Should().Be("My note");
        dto.TaskItemId.Should().Be(1);
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Get(99, 1);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenNoteDoesNotExist()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 99)).ReturnsAsync((Note?)null);

        var result = await _controller.Get(1, 99);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    // --- POST ---

    [Fact]
    public async Task Create_ShouldReturnCreated_WhenValid()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        var createDto = new CreateNoteDto { Content = "New note" };
        var created = new Note { Id = 3, Content = "New note", TaskItemId = 1, CreatedAt = DateTime.UtcNow };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Note>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockNoteRepo.Setup(r => r.AddAsync(It.IsAny<Note>())).ReturnsAsync(created);

        var result = await _controller.Create(1, createDto);

        var createdResult = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var dto = createdResult.Value.Should().BeOfType<NoteResponseDto>().Subject;
        dto.Id.Should().Be(3);
        dto.Content.Should().Be("New note");
        dto.TaskItemId.Should().Be(1);
    }

    [Fact]
    public async Task Create_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Create(99, new CreateNoteDto { Content = "Note" });

        result.Result.Should().BeOfType<NotFoundResult>();
        _mockNoteRepo.Verify(r => r.AddAsync(It.IsAny<Note>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Note>(), default))
            .ReturnsAsync(new ValidationResult(
                [new ValidationFailure("Content", "Content is required.")]));

        var result = await _controller.Create(1, new CreateNoteDto { Content = string.Empty });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _mockNoteRepo.Verify(r => r.AddAsync(It.IsAny<Note>()), Times.Never);
    }

    // --- PUT ---

    [Fact]
    public async Task Update_ShouldReturnOk_WhenValid()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        var existing = new Note { Id = 5, Content = "Old", TaskItemId = 1, CreatedAt = DateTime.UtcNow };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 5)).ReturnsAsync(existing);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Note>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockNoteRepo.Setup(r => r.UpdateAsync(It.IsAny<Note>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(1, 5, new UpdateNoteDto { Content = "Updated" });

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<NoteResponseDto>().Subject;
        dto.Content.Should().Be("Updated");
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Update(99, 1, new UpdateNoteDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenNoteDoesNotExist()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 99)).ReturnsAsync((Note?)null);

        var result = await _controller.Update(1, 99, new UpdateNoteDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    // --- DELETE ---

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenNoteExists()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        var note = new Note { Id = 5, Content = "Note", TaskItemId = 1 };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 5)).ReturnsAsync(note);
        _mockNoteRepo.Setup(r => r.DeleteAsync(1, 5)).Returns(Task.CompletedTask);

        var result = await _controller.Delete(1, 5);

        result.Should().BeOfType<NoContentResult>();
        _mockNoteRepo.Verify(r => r.DeleteAsync(1, 5), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Delete(99, 1);

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenNoteDoesNotExist()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 99)).ReturnsAsync((Note?)null);

        var result = await _controller.Delete(1, 99);

        result.Should().BeOfType<NotFoundResult>();
    }
}
