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
    private readonly Mock<IJournalEntryService> _entryService = new();
    private readonly Mock<IJournalLogEntryService> _logService = new();
    private readonly Mock<IValidator<JournalLogEntry>> _validator = new();
    private readonly JournalLogEntriesController _controller;

    public JournalLogEntriesControllerV1Tests()
    {
        _controller = new JournalLogEntriesController(_entryService.Object, _logService.Object, _validator.Object);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryMissing()
    {
        _entryService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(99);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Get_ShouldReturnOk_WhenFound()
    {
        _entryService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _logService.Setup(s => s.GetByIdAsync(1, 2))
            .ReturnsAsync(new JournalLogEntry { Id = 2, JournalEntryId = 1, Content = "Started", CreatedAt = DateTime.UtcNow });

        var result = await _controller.Get(1, 2);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalLogEntryResponseDto>().Subject;
        dto.Id.Should().Be(2);
        dto.JournalEntryId.Should().Be(1);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        _entryService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Content", "required")]));

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = string.Empty });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _logService.Verify(s => s.CreateAsync(It.IsAny<JournalLogEntry>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnCreated_WhenValid()
    {
        _entryService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalLogEntry>(), default)).ReturnsAsync(new ValidationResult());
        _logService.Setup(s => s.CreateAsync(It.IsAny<JournalLogEntry>()))
            .ReturnsAsync(new JournalLogEntry { Id = 3, JournalEntryId = 1, Content = "Done", CreatedAt = DateTime.UtcNow });

        var result = await _controller.Create(1, new CreateJournalLogEntryDto { Content = "Done" });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        created.RouteName.Should().Be("GetJournalLogEntryV1");
        created.RouteValues.Should().ContainKey("id").WhoseValue.Should().Be(3);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenLogMissing()
    {
        _entryService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _logService.Setup(s => s.GetByIdAsync(1, 22)).ReturnsAsync((JournalLogEntry?)null);

        var result = await _controller.Update(1, 22, new UpdateJournalLogEntryDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenFound()
    {
        _entryService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _logService.Setup(s => s.GetByIdAsync(1, 4))
            .ReturnsAsync(new JournalLogEntry { Id = 4, JournalEntryId = 1, Content = "x" });

        var result = await _controller.Delete(1, 4);

        result.Should().BeOfType<NoContentResult>();
        _logService.Verify(s => s.DeleteAsync(1, 4), Times.Once);
    }
}
