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

public class JournalEntriesControllerV1Tests
{
    private readonly Mock<IJournalEntryService> _mockService;
    private readonly Mock<IValidator<JournalEntry>> _mockValidator;
    private readonly JournalEntriesController _controller;

    public JournalEntriesControllerV1Tests()
    {
        _mockService = new Mock<IJournalEntryService>();
        _mockValidator = new Mock<IValidator<JournalEntry>>();
        _controller = new JournalEntriesController(_mockService.Object, _mockValidator.Object);
    }

    // --- GET all ---

    [Fact]
    public async Task GetAll_ShouldReturnOkWithEntries()
    {
        var entries = new List<JournalEntry>
        {
            new() { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1), CreatedAt = DateTime.UtcNow },
            new() { Id = 2, Title = "Day 2", Date = new DateOnly(2026, 5, 2), CreatedAt = DateTime.UtcNow }
        };
        _mockService.Setup(s => s.GetAllAsync()).ReturnsAsync(entries);

        var result = await _controller.GetAll();

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = ok.Value.Should().BeAssignableTo<IEnumerable<JournalEntryResponseDto>>().Subject;
        dtos.Should().HaveCount(2);
        _mockService.Verify(s => s.GetAllAsync(), Times.Once);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOkWithEmptyList_WhenNoEntries()
    {
        _mockService.Setup(s => s.GetAllAsync()).ReturnsAsync([]);

        var result = await _controller.GetAll();

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = ok.Value.Should().BeAssignableTo<IEnumerable<JournalEntryResponseDto>>().Subject;
        dtos.Should().BeEmpty();
    }

    // --- GET single ---

    [Fact]
    public async Task Get_ShouldReturnOkWithEntry_WhenExists()
    {
        var entry = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 1), CreatedAt = DateTime.UtcNow };
        _mockService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);

        var result = await _controller.Get(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        dto.Id.Should().Be(1);
        dto.Title.Should().Be("Day 1");
        dto.Date.Should().Be(new DateOnly(2026, 5, 1));
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenNotExists()
    {
        _mockService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Get(99);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    // --- POST ---

    [Fact]
    public async Task Create_ShouldReturnCreated_WhenValid()
    {
        var createDto = new CreateJournalEntryDto { Title = "Day 1", Date = new DateOnly(2026, 5, 7) };
        var created = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 7), CreatedAt = DateTime.UtcNow };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockService.Setup(s => s.GetByDateAsync(createDto.Date)).ReturnsAsync((JournalEntry?)null);
        _mockService.Setup(s => s.CreateAsync(It.IsAny<JournalEntry>())).ReturnsAsync(created);

        var result = await _controller.Create(createDto);

        var createdResult = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var dto = createdResult.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        dto.Id.Should().Be(1);
        dto.Title.Should().Be("Day 1");
    }

    [Fact]
    public async Task Create_ShouldReturnConflict_WhenDateAlreadyExists()
    {
        var createDto = new CreateJournalEntryDto { Title = "Day 1", Date = new DateOnly(2026, 5, 7) };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockService.Setup(s => s.GetByDateAsync(createDto.Date))
            .ReturnsAsync(new JournalEntry { Id = 7, Title = "Existing", Date = createDto.Date });

        var result = await _controller.Create(createDto);

        var conflict = result.Result.Should().BeOfType<ConflictObjectResult>().Subject;
        conflict.Value.Should().BeOfType<ProblemDetails>()
            .Which.Detail.Should().Be("A journal entry already exists for 2026-05-07.");
        _mockService.Verify(s => s.CreateAsync(It.IsAny<JournalEntry>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Title", "Title is required.")]));

        var result = await _controller.Create(new CreateJournalEntryDto { Title = string.Empty, Date = new DateOnly(2026, 5, 7) });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _mockService.Verify(s => s.CreateAsync(It.IsAny<JournalEntry>()), Times.Never);
    }

    // --- PUT ---

    [Fact]
    public async Task Update_ShouldReturnOkWithUpdatedEntry_WhenValid()
    {
        var existing = new JournalEntry { Id = 1, Title = "Old Title", Date = new DateOnly(2026, 5, 7), CreatedAt = DateTime.UtcNow };
        _mockService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockService.Setup(s => s.UpdateAsync(It.IsAny<JournalEntry>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(1, new UpdateJournalEntryDto { Title = "New Title" });

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        dto.Title.Should().Be("New Title");
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenEntryNotExists()
    {
        _mockService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Update(99, new UpdateJournalEntryDto { Title = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_ShouldReturnBadRequest_WhenValidationFails()
    {
        var existing = new JournalEntry { Id = 1, Title = "Title", Date = new DateOnly(2026, 5, 7), CreatedAt = DateTime.UtcNow };
        _mockService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Title", "Title is required.")]));

        var result = await _controller.Update(1, new UpdateJournalEntryDto { Title = string.Empty });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _mockService.Verify(s => s.UpdateAsync(It.IsAny<JournalEntry>()), Times.Never);
    }

    // --- DELETE ---

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenEntryExists()
    {
        var existing = new JournalEntry { Id = 1, Title = "Day 1", Date = new DateOnly(2026, 5, 7) };
        _mockService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockService.Setup(s => s.DeleteAsync(1)).Returns(Task.CompletedTask);

        var result = await _controller.Delete(1);

        result.Should().BeOfType<NoContentResult>();
        _mockService.Verify(s => s.DeleteAsync(1), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenEntryNotExists()
    {
        _mockService.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Delete(99);

        result.Should().BeOfType<NotFoundResult>();
        _mockService.Verify(s => s.DeleteAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Get_ShouldReturnOrderedLogEntries()
    {
        var entry = new JournalEntry
        {
            Id = 1,
            Title = "Day 1",
            Date = new DateOnly(2026, 5, 1),
            LogEntries =
            [
                new JournalLogEntry { Id = 2, Content = "Later", JournalEntryId = 1, CreatedAt = new DateTime(2026, 5, 1, 9, 0, 0, DateTimeKind.Utc) },
                new JournalLogEntry { Id = 1, Content = "Earlier", JournalEntryId = 1, CreatedAt = new DateTime(2026, 5, 1, 8, 0, 0, DateTimeKind.Utc) }
            ]
        };
        _mockService.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(entry);

        var result = await _controller.Get(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        dto.LogEntries.Select(log => log.Id).Should().ContainInOrder(1, 2);
    }
}
