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

public class JournalNotesControllerV1Tests
{
    private readonly Mock<IJournalEntryRepository> _entryRepo = new();
    private readonly Mock<IJournalNoteRepository> _noteRepo = new();
    private readonly Mock<IValidator<JournalNote>> _validator = new();
    private readonly JournalNotesController _controller;

    private static JournalEntry MakeEntry(int id = 1) =>
        new() { Id = id, Title = "May 27", Date = new DateOnly(2026, 5, 27) };

    private static JournalNote MakeNote(int id = 1, int entryId = 1) =>
        new() { Id = id, JournalEntryId = entryId, Content = "A note", CreatedAt = DateTime.UtcNow };

    public JournalNotesControllerV1Tests()
    {
        _controller = new JournalNotesController(_entryRepo.Object, _noteRepo.Object, _validator.Object);
    }

    // ── GetAll ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAll_ShouldReturn200_WithNotes_WhenEntryExists()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetAllByEntryIdAsync(1))
            .ReturnsAsync([MakeNote(1), MakeNote(2)]);

        var result = await _controller.GetAll(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = ok.Value.Should().BeAssignableTo<IEnumerable<JournalNoteResponseDto>>().Subject;
        dtos.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetAll_ShouldReturn404_WhenEntryMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(99);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    // ── GetById ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetById_ShouldReturn200_WhenFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetByIdAsync(1, 5)).ReturnsAsync(MakeNote(5));

        var result = await _controller.Get(1, 5);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalNoteResponseDto>().Subject;
        dto.Id.Should().Be(5);
        dto.JournalEntryId.Should().Be(1);
    }

    [Fact]
    public async Task GetById_ShouldReturn404_WhenNoteMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetByIdAsync(1, 99)).ReturnsAsync((JournalNote?)null);

        var result = await _controller.Get(1, 99);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetById_ShouldReturn404_WhenEntryMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Get(99, 1);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    // ── Create ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ShouldReturn201_WhenValid()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalNote>(), default))
            .ReturnsAsync(new ValidationResult());
        _noteRepo.Setup(s => s.AddAsync(It.IsAny<JournalNote>()))
            .ReturnsAsync(MakeNote(7));

        var result = await _controller.Create(1, new CreateJournalNoteDto { Content = "A note" });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        created.RouteName.Should().Be("GetJournalNoteV1");
        created.RouteValues.Should().ContainKey("id").WhoseValue.Should().Be(7);
    }

    [Fact]
    public async Task Create_ShouldReturn404_WhenEntryMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Create(99, new CreateJournalNoteDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
        _noteRepo.Verify(s => s.AddAsync(It.IsAny<JournalNote>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturn400_WhenContentIsEmpty()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalNote>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Content", "Content is required.")]));

        var result = await _controller.Create(1, new CreateJournalNoteDto { Content = string.Empty });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _noteRepo.Verify(s => s.AddAsync(It.IsAny<JournalNote>()), Times.Never);
    }

    // ── Update ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_ShouldReturn200_WhenValid()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetByIdAsync(1, 3)).ReturnsAsync(MakeNote(3));
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalNote>(), default))
            .ReturnsAsync(new ValidationResult());

        var result = await _controller.Update(1, 3, new UpdateJournalNoteDto { Content = "Updated" });

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeOfType<JournalNoteResponseDto>().Subject;
        dto.Content.Should().Be("Updated");
        _noteRepo.Verify(s => s.UpdateAsync(It.IsAny<JournalNote>()), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldReturn404_WhenEntryMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Update(99, 1, new UpdateJournalNoteDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_ShouldReturn404_WhenNoteMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetByIdAsync(1, 99)).ReturnsAsync((JournalNote?)null);

        var result = await _controller.Update(1, 99, new UpdateJournalNoteDto { Content = "x" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_ShouldReturn400_WhenContentIsEmpty()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetByIdAsync(1, 3)).ReturnsAsync(MakeNote(3));
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalNote>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Content", "Content is required.")]));

        var result = await _controller.Update(1, 3, new UpdateJournalNoteDto { Content = string.Empty });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _noteRepo.Verify(s => s.UpdateAsync(It.IsAny<JournalNote>()), Times.Never);
    }

    // ── Delete ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_ShouldReturn204_WhenFound()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetByIdAsync(1, 4)).ReturnsAsync(MakeNote(4));

        var result = await _controller.Delete(1, 4);

        result.Should().BeOfType<NoContentResult>();
        _noteRepo.Verify(s => s.DeleteAsync(1, 4), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturn404_WhenEntryMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(99)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Delete(99, 1);

        result.Should().BeOfType<NotFoundResult>();
        _noteRepo.Verify(s => s.DeleteAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Delete_ShouldReturn404_WhenNoteMissing()
    {
        _entryRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(MakeEntry());
        _noteRepo.Setup(s => s.GetByIdAsync(1, 99)).ReturnsAsync((JournalNote?)null);

        var result = await _controller.Delete(1, 99);

        result.Should().BeOfType<NotFoundResult>();
        _noteRepo.Verify(s => s.DeleteAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }
}
