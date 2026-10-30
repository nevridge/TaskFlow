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

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetAll_ShouldReturnMappedLinkFields_WhenLogsHaveLinkedAndDeletedTasks()
    {
        var created1 = new DateTime(2026, 5, 10, 8, 0, 0, DateTimeKind.Utc);
        var created2 = new DateTime(2026, 5, 10, 9, 0, 0, DateTimeKind.Utc);
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetAllByEntryIdAsync(1)).ReturnsAsync(
        [
            new JournalLogEntry
            {
                Id = 1,
                JournalEntryId = 1,
                Content = "Linked log",
                CreatedAt = created1,
                TaskItemId = 10,
                TaskItem = MakeTask(10, "Live Title"),
                LinkedTaskTitleSnapshot = "Old Snapshot",
            },
            new JournalLogEntry
            {
                Id = 2,
                JournalEntryId = 1,
                Content = "Orphan log",
                CreatedAt = created2,
                TaskItemId = null,
                LinkedTaskTitleSnapshot = "Deleted Task",
            },
        ]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<JournalLogEntryResponseDto>>(ok.Value).ToList();
        Assert.Equal(2, dtos.Count);

        Assert.Equal("Linked log", dtos[0].Content);
        Assert.Equal(created1, dtos[0].CreatedAt);
        Assert.Equal(10, dtos[0].TaskItemId);
        Assert.Equal("Live Title", dtos[0].LinkedTaskTitle);
        Assert.False(dtos[0].LinkedTaskDeleted);

        Assert.Equal("Orphan log", dtos[1].Content);
        Assert.Equal(created2, dtos[1].CreatedAt);
        Assert.Null(dtos[1].TaskItemId);
        Assert.Equal("Deleted Task", dtos[1].LinkedTaskTitle);
        Assert.True(dtos[1].LinkedTaskDeleted);
    }

    [Fact]
    public async Task Get_ShouldReturnOk_WhenFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdNoTrackingAsync(1, 2))
            .ReturnsAsync(new JournalLogEntry { Id = 2, JournalEntryId = 1, Content = "Started", CreatedAt = DateTime.UtcNow });

        var result = await _controller.Get(1, 2);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<JournalLogEntryResponseDto>(ok.Value);
        Assert.Equal(2, dto.Id);
        Assert.Equal(1, dto.JournalEntryId);
    }

    // ── CREATE ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Content", "required")]));

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = string.Empty });

        Assert.IsType<BadRequestObjectResult>(result.Result);
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

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        Assert.Equal("GetJournalLogEntryV1", created.RouteName);
        Assert.True(created.RouteValues!.TryGetValue("id", out var createdId));
        Assert.Equal(3, createdId);
    }

    [Fact]
    public async Task Create_ShouldSucceed_WhenTaskItemIdOmitted()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        SetupValidationSuccess();
        _logRepo.Setup(s => s.AddAsync(It.IsAny<JournalLogEntry>()))
            .ReturnsAsync(new JournalLogEntry { Id = 5, JournalEntryId = 1, Content = "Note", CreatedAt = DateTime.UtcNow });

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Note" });

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var dto = Assert.IsType<JournalLogEntryResponseDto>(created.Value);
        Assert.Null(dto.TaskItemId);
        Assert.False(dto.LinkedTaskDeleted);
        _taskRepo.Verify(r => r.GetByIdNoTrackingAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldLinkTask_WhenTaskItemIdValid()
    {
        var task = MakeTask(id: 10, title: "Build feature");
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        SetupValidationSuccess();
        _taskRepo.Setup(r => r.GetByIdNoTrackingAsync(10)).ReturnsAsync(task);
        _logRepo.Setup(s => s.AddAsync(It.IsAny<JournalLogEntry>()))
            .ReturnsAsync((JournalLogEntry l) =>
            {
                l.Id = 7;
                l.CreatedAt = DateTime.UtcNow;
                l.TaskItem = task;
                return l;
            });

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Did work", TaskItemId = 10 });

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var dto = Assert.IsType<JournalLogEntryResponseDto>(created.Value);
        Assert.Equal(10, dto.TaskItemId);
        Assert.Equal("Build feature", dto.LinkedTaskTitle);
        Assert.False(dto.LinkedTaskDeleted);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenTaskItemIdNotFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        SetupValidationSuccess();
        _taskRepo.Setup(r => r.GetByIdNoTrackingAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Work", TaskItemId = 99 });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        _logRepo.Verify(s => s.AddAsync(It.IsAny<JournalLogEntry>()), Times.Never);
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenEntryMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Update(99, 1, new UpdateJournalLogEntryDto { Content = "x" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenLogMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 22)).ReturnsAsync((JournalLogEntry?)null);

        var result = await _controller.Update(1, 22, new UpdateJournalLogEntryDto { Content = "x" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Update_ShouldReturnBadRequest_WhenTaskItemIdNotFound()
    {
        var existing = new JournalLogEntry { Id = 3, JournalEntryId = 1, Content = "Old" };
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdAsync(1, 3)).ReturnsAsync(existing);
        SetupValidationSuccess();
        _taskRepo.Setup(r => r.GetByIdNoTrackingAsync(42)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Update(1, 3, new UpdateJournalLogEntryDto { Content = "New", TaskItemId = 42 });

        Assert.IsType<BadRequestObjectResult>(result.Result);
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
        _taskRepo.Setup(r => r.GetByIdNoTrackingAsync(20)).ReturnsAsync(task);

        var result = await _controller.Update(1, 3, new UpdateJournalLogEntryDto { Content = "Updated", TaskItemId = 20 });

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<JournalLogEntryResponseDto>(ok.Value);
        Assert.Equal(20, dto.TaskItemId);
        Assert.Equal("New Task", dto.LinkedTaskTitle);
        Assert.False(dto.LinkedTaskDeleted);
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

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<JournalLogEntryResponseDto>(ok.Value);
        Assert.Null(dto.TaskItemId);
        Assert.Null(dto.LinkedTaskTitle);
        Assert.False(dto.LinkedTaskDeleted);
        _taskRepo.Verify(r => r.GetByIdNoTrackingAsync(It.IsAny<int>()), Times.Never);
    }

    // ── DELETE ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _logRepo.Setup(s => s.GetByIdNoTrackingAsync(1, 4))
            .ReturnsAsync(new JournalLogEntry { Id = 4, JournalEntryId = 1, Content = "x" });

        var result = await _controller.Delete(1, 4);

        Assert.IsType<NoContentResult>(result);
        _logRepo.Verify(s => s.DeleteAsync(1, 4), Times.Once);
    }
}
