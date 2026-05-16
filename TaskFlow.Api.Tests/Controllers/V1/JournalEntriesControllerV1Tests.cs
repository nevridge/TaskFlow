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

public class JournalEntriesControllerV1Tests
{
    private readonly Mock<IJournalEntryRepository> _repo = new();
    private readonly Mock<IValidator<JournalEntry>> _validator = new();
    private readonly JournalEntriesController _controller;

    public JournalEntriesControllerV1Tests()
    {
        _controller = new JournalEntriesController(_repo.Object, _validator.Object);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOk()
    {
        var entries = new List<JournalEntry>
        {
            new() { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) }
        };
        _repo.Setup(r => r.GetAllAsync()).ReturnsAsync(entries);

        var result = await _controller.GetAll();

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dtos = ok.Value.Should().BeAssignableTo<IEnumerable<JournalEntryResponseDto>>().Subject;
        dtos.Should().ContainSingle(d => d.Id == 1 && d.Date == new DateOnly(2026, 5, 10));
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenMissing()
    {
        _repo.Setup(r => r.GetByIdAsync(123)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Get(123);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Create_ShouldReturnConflict_WhenDateAlreadyExists()
    {
        var date = new DateOnly(2026, 5, 10);
        _repo.Setup(r => r.GetByDateAsync(date))
            .ReturnsAsync(new JournalEntry { Id = 55, Title = "Existing", Date = date });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "New", Date = date });

        result.Result.Should().BeOfType<ConflictObjectResult>();
        _repo.Verify(r => r.AddAsync(It.IsAny<JournalEntry>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        var date = new DateOnly(2026, 5, 10);
        _repo.Setup(r => r.GetByDateAsync(date)).ReturnsAsync((JournalEntry?)null);
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Title", "Title is required.")]));

        var result = await _controller.Create(new CreateJournalEntryDto { Title = string.Empty, Date = date });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _repo.Verify(r => r.AddAsync(It.IsAny<JournalEntry>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnCreated_WhenValid()
    {
        var date = new DateOnly(2026, 5, 11);
        _repo.Setup(r => r.GetByDateAsync(date)).ReturnsAsync((JournalEntry?)null);
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default))
            .ReturnsAsync(new ValidationResult());
        _repo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>()))
            .ReturnsAsync(new JournalEntry { Id = 9, Title = "May 11", Date = date });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "May 11", Date = date });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        created.RouteName.Should().Be("GetJournalEntryV1");
        created.RouteValues.Should().ContainKey("id").WhoseValue.Should().Be(9);
    }

    [Fact]
    public async Task Create_ShouldReturnConflict_WhenUniqueRaceOccurs()
    {
        var date = new DateOnly(2026, 5, 12);
        _repo.SetupSequence(r => r.GetByDateAsync(date))
            .ReturnsAsync((JournalEntry?)null)
            .ReturnsAsync(new JournalEntry { Id = 12, Title = "Existing", Date = date });
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default)).ReturnsAsync(new ValidationResult());
        _repo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>()))
            .ThrowsAsync(new DuplicateJournalDateException(date));

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "May 12", Date = date });

        result.Result.Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenMissing()
    {
        _repo.Setup(r => r.GetByIdAsync(44)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Update(44, new UpdateJournalEntryDto { Title = "x", Summary = "s" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenFound()
    {
        _repo.Setup(r => r.GetByIdAsync(7)).ReturnsAsync(new JournalEntry { Id = 7, Title = "a", Date = new DateOnly(2026, 5, 10) });

        var result = await _controller.Delete(7);

        result.Should().BeOfType<NoContentResult>();
        _repo.Verify(r => r.DeleteAsync(7), Times.Once);
    }
}
