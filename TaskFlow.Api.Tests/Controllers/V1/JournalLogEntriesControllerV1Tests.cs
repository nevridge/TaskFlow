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

public class JournalLogEntriesControllerV1Tests
{
    private readonly Mock<IJournalEntryRepository> _entryRepo = new();
    private readonly Mock<IJournalLogEntryRepository> _logRepo = new();
    private readonly Mock<IValidator<JournalLogEntry>> _validator = new();
    private readonly Mock<ITaskRepository> _taskRepo = new();
    private readonly JournalLogEntriesController _controller;

    public JournalLogEntriesControllerV1Tests()
    {
        _controller = new JournalLogEntriesController(
            _entryRepo.Object, _logRepo.Object, _validator.Object, _taskRepo.Object);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static JournalEntry MakeEntry(int id = 1) =>
        new() { Id = id, Title = "May 10", Date = new DateOnly(2026, 5, 10) };

    private static TaskItem MakeTask(int id = 10, string title = "My Task") =>
        new() { Id = id, Title = title };

    private void SetupValidationSuccess() =>
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default))
            .ReturnsAsync(new ValidationResult());

    // ── GET ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(99);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Get_ShouldReturnOk_WhenFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 2))
            .ReturnsAsync(new JournalLogEntry { Id = 2, JournalEntryId = 1, Content = "Started", CreatedAt = DateTime.UtcNow });

        var result = await _controller.Get(1, 2);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.Id.Should().Be(2);
        dto.JournalEntryId.Should().Be(1);
    }

    // ── CREATE ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Content", "required")]));

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = string.Empty });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _logRepo.Verify(s => s.AddAsync(It.IsAny<JournalLogEntry>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnCreated_WhenValid()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        SetupValidationSuccess();
        _logRepo.Setup(s => s.AddAsync(It.IsAny<JournalLogEntry>()))
            .ReturnsAsync(new JournalLogEntry { Id = 3, JournalEntryId = 1, Content = "Done", CreatedAt = DateTime.UtcNow });

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Done" });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        created.RouteName.Should().Be("GetJournalLogEntryV1");
        created.RouteValues.Should().ContainKey("id").WhoseValue.Should().Be(3);
    }

    [Fact]
    public async Task Create_ShouldSucceed_WhenTaskItemIdOmitted()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        SetupValidationSuccess();
        _logRepo.Setup(s => s.AddAsync(It.IsAny<JournalLogEntry>()))
            .ReturnsAsync(new JournalLogEntry { Id = 5, JournalEntryId = 1, Content = "Note", CreatedAt = DateTime.UtcNow });

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Note" });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var dto = created.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.TaskItemId.Should().BeNull();
        dto.LinkedTaskDeleted.Should().BeFalse();
        _taskRepo.Verify(r => r.GetByIdAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldLinkTask_WhenTaskItemIdValid()
    {
        var task = MakeTask(id: 10, title: "Build feature");
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        SetupValidationSuccess();
        _taskRepo.Setup(r => r.GetByIdAsync(10)).ReturnsAsync(task);
        _logRepo.Setup(s => s.AddAsync(It.IsAny<JournalLogEntry>()))
            .ReturnsAsync((JournalLogEntry l) =>
            {
                l.Id = 7;
                l.CreatedAt = DateTime.UtcNow;
                l.TaskItem = task;
                return l;
            });

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Did work", TaskItemId = 10 });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var dto = created.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.TaskItemId.Should().Be(10);
        dto.LinkedTaskTitle.Should().Be("Build feature");
        dto.LinkedTaskDeleted.Should().BeFalse();
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenTaskItemIdNotFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        SetupValidationSuccess();
        _taskRepo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Work", TaskItemId = 99 });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _logRepo.Verify(s => s.AddAsync(It.IsAny<JournalLogEntry>()), Times.Never);
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenLogMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 22)).ReturnsAsync((JournalLogEntry?)null);

        var result = await _controller.Update(1, 22, new UpdateJournalLogEntryDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_ShouldReturnBadRequest_WhenTaskItemIdNotFound()
    {
        var existing = new JournalLogEntry { Id = 3, JournalEntryId = 1, Content = "Old" };
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 3)).ReturnsAsync(existing);
        SetupValidationSuccess();
        _taskRepo.Setup(r => r.GetByIdAsync(42)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Update(1, 3, new UpdateJournalLogEntryDto { Content = "New", TaskItemId = 42 });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _logRepo.Verify(r => r.UpdateAsync(It.IsAny<JournalLogEntry>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldChangeLink_WhenTaskItemIdValid()
    {
        var task = MakeTask(id: 20, title: "New Task");
        var existing = new JournalLogEntry { Id = 3, JournalEntryId = 1, Content = "Old" };
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 3)).ReturnsAsync(existing);
        SetupValidationSuccess();
        _taskRepo.Setup(r => r.GetByIdAsync(20)).ReturnsAsync(task);

        var result = await _controller.Update(1, 3, new UpdateJournalLogEntryDto { Content = "Updated", TaskItemId = 20 });

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.TaskItemId.Should().Be(20);
        dto.LinkedTaskTitle.Should().Be("New Task");
        dto.LinkedTaskDeleted.Should().BeFalse();
        _logRepo.Verify(r => r.UpdateAsync(existing), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldClearLink_WhenTaskItemIdIsNull()
    {
        var existing = new JournalLogEntry
        {
            Id = 3,
            JournalEntryId = 1,
            Content = "Old",
            TaskItemId = 10,
            LinkedTaskTitleSnapshot = "Old Task",
        };
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 3)).ReturnsAsync(existing);
        SetupValidationSuccess();

        var result = await _controller.Update(1, 3, new UpdateJournalLogEntryDto { Content = "Updated" });

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.TaskItemId.Should().BeNull();
        dto.LinkedTaskTitle.Should().BeNull();
        dto.LinkedTaskDeleted.Should().BeFalse();
        _taskRepo.Verify(r => r.GetByIdAsync(It.IsAny<int>()), Times.Never);
    }

    // ── DELETE ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 4))
            .ReturnsAsync(new JournalLogEntry { Id = 4, JournalEntryId = 1, Content = "x" });

        var result = await _controller.Delete(1, 4);

        result.Should().BeOfType<NoContentResult>();
        _logRepo.Verify(s => s.DeleteAsync(1, 4), Times.Once);
    }
}
