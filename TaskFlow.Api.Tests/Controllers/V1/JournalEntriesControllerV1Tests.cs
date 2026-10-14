using FluentAssertions;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

public class JournalEntriesControllerV1Tests
{
    private readonly Mock<IJournalEntryRepository> _repo = new();
    private readonly Mock<IValidator<JournalEntry>> _validator = new();
    private readonly JournalEntriesController _controller;

    public JournalEntriesControllerV1Tests()
    {
        _controller = new JournalEntriesController(
            _repo.Object, _validator.Object, new CreateJournalEntryDtoValidator(), new CarryForwardRequestDtoValidator());
    }

    private void SetupCreate(DateOnly date, int id = 9)
    {
        _repo.Setup(r => r.GetByDateAsync(date)).ReturnsAsync((JournalEntry?)null);
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default)).ReturnsAsync(new ValidationResult());
        _repo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>()))
            .ReturnsAsync(new JournalEntry { Id = id, Title = "t", Date = date });
    }

    [Theory]
    [InlineData(1, 300)]
    [InlineData(-1, 300)]
    [InlineData(1, null)]
    [InlineData(0, null)]
    public async Task Create_ShouldNotCarryForward_WhenNotUserTodayOrNoOffset(int dayDelta, int? offset)
    {
        var date = UserDateHelper.GetUserToday(DateTime.UtcNow, offset).AddDays(dayDelta);
        SetupCreate(date);

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = date, TimezoneOffsetMinutes = offset });

        result.Result.Should().BeOfType<CreatedAtRouteResult>();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    public async Task Create_ShouldReturnBadRequest_WhenOffsetOutOfRange(int offset)
    {
        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = new DateOnly(2026, 5, 11), TimezoneOffsetMinutes = offset });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _repo.Verify(r => r.AddAsync(It.IsAny<JournalEntry>()), Times.Never);
    }

    [Theory]
    [InlineData(-720)]
    [InlineData(840)]
    public async Task Create_ShouldAcceptBoundaryOffsets(int offset)
    {
        var date = UserDateHelper.GetUserToday(DateTime.UtcNow, offset).AddDays(1);
        SetupCreate(date);

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = date, TimezoneOffsetMinutes = offset });

        result.Result.Should().BeOfType<CreatedAtRouteResult>();
    }

    [Theory]
    [InlineData(840)]
    [InlineData(-720)]
    public async Task Create_ShouldCarryForwardAndReload_WhenDateIsUserToday(int offset)
    {
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        SetupCreate(today, id: 21);
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(21, today)).ReturnsAsync(2);
        _repo.Setup(r => r.GetByIdAsync(21)).ReturnsAsync(new JournalEntry
        {
            Id = 21,
            Title = "t",
            Date = today,
            Todos = [new TaskItem { Id = 5, Title = "a" }, new TaskItem { Id = 6, Title = "b" }]
        });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = today, TimezoneOffsetMinutes = offset });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        created.Value.Should().BeOfType<JournalEntryResponseDto>().Which.TodoTaskItemIds.Should().BeEquivalentTo([5, 6]);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(21, today), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldNotReload_WhenNothingMoved()
    {
        const int offset = 0;
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        SetupCreate(today, id: 22);
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(22, today)).ReturnsAsync(0);

        await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = today, TimezoneOffsetMinutes = offset });

        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(22, today), Times.Once);
        _repo.Verify(r => r.GetByIdAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnBadRequest_WhenOffsetOutOfRange()
    {
        var result = await _controller.CarryForward(1, new CarryForwardRequestDto { TimezoneOffsetMinutes = 841 });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task CarryForward_ShouldReturnNotFound_WhenEntryMissing()
    {
        _repo.Setup(r => r.GetByIdAsync(5)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.CarryForward(5, new CarryForwardRequestDto { TimezoneOffsetMinutes = 0 });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CarryForward_ShouldReturnZeroWithoutRepoCall_WhenOffsetMissingOrBodyNull(bool nullBody)
    {
        var entry = new JournalEntry { Id = 3, Title = "t", Date = DateOnly.FromDateTime(DateTime.UtcNow) };
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(entry);

        var result = await _controller.CarryForward(3, nullBody ? null : new CarryForwardRequestDto());

        result.Result.Should().BeOfType<OkObjectResult>().Which.Value.Should().BeOfType<CarryForwardResponseDto>()
            .Which.MovedCount.Should().Be(0);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnZeroWithoutRepoCall_WhenEntryIsNotUserToday()
    {
        var entry = new JournalEntry { Id = 3, Title = "t", Date = UserDateHelper.GetUserToday(DateTime.UtcNow, 0).AddDays(1) };
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(entry);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 0 });

        result.Result.Should().BeOfType<OkObjectResult>().Which.Value.Should().BeOfType<CarryForwardResponseDto>()
            .Which.MovedCount.Should().Be(0);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnRepoCount_WhenEntryIsUserToday()
    {
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, 840);
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(new JournalEntry { Id = 3, Title = "t", Date = today });
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(3, today)).ReturnsAsync(4);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 840 });

        result.Result.Should().BeOfType<OkObjectResult>().Which.Value.Should().BeOfType<CarryForwardResponseDto>()
            .Which.MovedCount.Should().Be(4);
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
