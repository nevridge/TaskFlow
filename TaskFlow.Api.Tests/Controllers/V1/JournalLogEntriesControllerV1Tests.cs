using FluentAssertions;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Tests.Controllers.V1;

public class JournalLogEntriesControllerV1Tests
{
    private readonly Mock<IJournalLogEntryService> _mockLogService;
    private readonly Mock<IJournalEntryService> _mockJournalService;
    private readonly Mock<IValidator<JournalLogEntry>> _mockValidator;
    private readonly JournalLogEntriesController _controller;

    public JournalLogEntriesControllerV1Tests()
    {
        _mockLogService = new Mock<IJournalLogEntryService>();
        _mockJournalService = new Mock<IJournalEntryService>();
        _mockValidator = new Mock<IValidator<JournalLogEntry>>();
        _controller = new JournalLogEntriesController(_mockLogService.Object, _mockJournalService.Object, _mockValidator.Object);
    }

    // --- GET all ---

    [Fact]
    public async Task GetAll_ShouldReturnOkWithLogs_WhenEntryExists()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var logs = new List<JournalLogEntry>
        {
            new() { Id = 1, Content = "Log 1", JournalEntryId = 1, CreatedAt = DateTime.UtcNow },
            new() { Id = 2, Content = "Log 2", JournalEntryId = 1, CreatedAt = DateTime.UtcNow }
        };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockLogService.Setup(s => s.GetAllByEntryIdAsync(1)).ReturnsAsync(logs);

        var result = await _controller.GetAll(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = ok.Value.Should().BeAssignableTo<IEnumerable<JournalLogEntryResponseDto>>().Subject;
        dtos.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(99);

        result.Result.Should().BeOfType<NotFoundResult>();
        _mockLogService.Verify(s => s.GetAllByEntryIdAsync(It.IsAny<int>()), Times.Never);
    }

    // --- GET single ---

    [Fact]
    public async Task Get_ShouldReturnOkWithLog_WhenExists()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var log = new JournalLogEntry { Id = 5, Content = "My log", JournalEntryId = 1, CreatedAt = DateTime.UtcNow };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockLogService.Setup(s => s.GetByIdAsync(1, 5)).ReturnsAsync(log);

        var result = await _controller.Get(1, 5);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.Id.Should().Be(5);
        dto.Content.Should().Be("My log");
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Get(99, 1);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenLogDoesNotExist()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockLogService.Setup(s => s.GetByIdAsync(1, 99)).ReturnsAsync((JournalLogEntry?)null);

        var result = await _controller.Get(1, 99);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    // --- POST ---

    [Fact]
    public async Task Create_ShouldReturnCreated_WhenValid()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var created = new JournalLogEntry { Id = 3, Content = "New log", JournalEntryId = 1, CreatedAt = DateTime.UtcNow };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockLogService.Setup(s => s.CreateAsync(It.IsAny<JournalLogEntry>())).ReturnsAsync(created);

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "New log" });

        var createdResult = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var dto = createdResult.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.Id.Should().Be(3);
        dto.Content.Should().Be("New log");
        dto.JournalEntryId.Should().Be(1);
    }

    [Fact]
    public async Task Create_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Create(99, new CreateJournalLogEntryDto { Content = "Log" });

        result.Result.Should().BeOfType<NotFoundResult>();
        _mockLogService.Verify(s => s.CreateAsync(It.IsAny<JournalLogEntry>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Content", "Content is required.")]));

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = string.Empty });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _mockLogService.Verify(s => s.CreateAsync(It.IsAny<JournalLogEntry>()), Times.Never);
    }

    // --- PUT ---

    [Fact]
    public async Task Update_ShouldReturnOkWithUpdatedLog_WhenValid()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var existing = new JournalLogEntry { Id = 5, Content = "Old", JournalEntryId = 1, CreatedAt = DateTime.UtcNow };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockLogService.Setup(s => s.GetByIdAsync(1, 5)).ReturnsAsync(existing);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockLogService.Setup(s => s.UpdateAsync(It.IsAny<JournalLogEntry>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(1, 5, new UpdateJournalLogEntryDto { Content = "Updated" });

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.Content.Should().Be("Updated");
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Update(99, 1, new UpdateJournalLogEntryDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenLogDoesNotExist()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockLogService.Setup(s => s.GetByIdAsync(1, 99)).ReturnsAsync((JournalLogEntry?)null);

        var result = await _controller.Update(1, 99, new UpdateJournalLogEntryDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    // --- DELETE ---

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenLogExists()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        var log = new JournalLogEntry { Id = 5, Content = "Log", JournalEntryId = 1 };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockLogService.Setup(s => s.GetByIdAsync(1, 5)).ReturnsAsync(log);
        _mockLogService.Setup(s => s.DeleteAsync(1, 5)).Returns(Task.CompletedTask);

        var result = await _controller.Delete(1, 5);

        result.Should().BeOfType<NoContentResult>();
        _mockLogService.Verify(s => s.DeleteAsync(1, 5), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenEntryDoesNotExist()
    {
        _mockJournalService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Delete(99, 1);

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenLogDoesNotExist()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1) };
        _mockJournalService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);
        _mockLogService.Setup(s => s.GetByIdAsync(1, 99)).ReturnsAsync((JournalLogEntry?)null);

        var result = await _controller.Delete(1, 99);

        result.Should().BeOfType<NotFoundResult>();
    }
}
