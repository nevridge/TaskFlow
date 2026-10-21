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

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<NoteResponseDto>>(ok.Value);
        Assert.Equal(2, dtos.Count());
        _mockNoteRepo.Verify(r => r.GetAllByTaskIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.GetAll(99);

        Assert.IsType<NotFoundResult>(result.Result);
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

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<NoteResponseDto>(ok.Value);
        Assert.Equal(5, dto.Id);
        Assert.Equal("My note", dto.Content);
        Assert.Equal(1, dto.TaskItemId);
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Get(99, 1);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenNoteDoesNotExist()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 99)).ReturnsAsync((Note?)null);

        var result = await _controller.Get(1, 99);

        Assert.IsType<NotFoundResult>(result.Result);
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

        var createdResult = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var dto = Assert.IsType<NoteResponseDto>(createdResult.Value);
        Assert.Equal(3, dto.Id);
        Assert.Equal("New note", dto.Content);
        Assert.Equal(1, dto.TaskItemId);
    }

    [Fact]
    public async Task Create_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Create(99, new CreateNoteDto { Content = "Note" });

        Assert.IsType<NotFoundResult>(result.Result);
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

        Assert.IsType<BadRequestObjectResult>(result.Result);
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

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<NoteResponseDto>(ok.Value);
        Assert.Equal("Updated", dto.Content);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Update(99, 1, new UpdateNoteDto { Content = "x" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenNoteDoesNotExist()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 99)).ReturnsAsync((Note?)null);

        var result = await _controller.Update(1, 99, new UpdateNoteDto { Content = "x" });

        Assert.IsType<NotFoundResult>(result.Result);
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

        Assert.IsType<NoContentResult>(result);
        _mockNoteRepo.Verify(r => r.DeleteAsync(1, 5), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockTaskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Delete(99, 1);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenNoteDoesNotExist()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockTaskRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockNoteRepo.Setup(r => r.GetByIdAsync(1, 99)).ReturnsAsync((Note?)null);

        var result = await _controller.Delete(1, 99);

        Assert.IsType<NotFoundResult>(result);
    }
}
