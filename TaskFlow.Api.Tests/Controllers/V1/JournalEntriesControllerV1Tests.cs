using FluentAssertions;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
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
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(21, today)).ReturnsAsync([3, 5]);
        _repo.Setup(r => r.GetByIdAsync(21)).ReturnsAsync(new JournalEntry
        {
            Id = 21,
            Title = "t",
            Date = today,
            Todos = [new TaskItem { Id = 5, Title = "a" }, new TaskItem { Id = 6, Title = "b" }]
        });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = today, TimezoneOffsetMinutes = offset });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var body = created.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.TodoTaskItemIds.Should().BeEquivalentTo([5, 6]);
        body.MovedCount.Should().Be(2);
        body.MovedTaskItemIds.Should().Equal(3, 5);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(21, today), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldReturnPersistedTodos_WhenCarryForwardMovedNothing()
    {
        const int offset = 0;
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        // The entry returned by AddAsync still carries unsaved moves, as after a lost carry-forward race.
        _repo.Setup(r => r.GetByDateAsync(today)).ReturnsAsync((JournalEntry?)null);
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default)).ReturnsAsync(new ValidationResult());
        _repo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>()))
            .ReturnsAsync(new JournalEntry { Id = 22, Title = "t", Date = today, Todos = [new TaskItem { Id = 99, Title = "unsaved" }] });
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(22, today)).ReturnsAsync([]);
        _repo.Setup(r => r.GetByIdAsync(22)).ReturnsAsync(new JournalEntry { Id = 22, Title = "t", Date = today });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = today, TimezoneOffsetMinutes = offset });

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        var body = created.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.TodoTaskItemIds.Should().BeEmpty();
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(22, today), Times.Once);
    }

    [Theory]
    [InlineData(1, 300)]
    [InlineData(-1, 300)]
    [InlineData(0, null)]
    public async Task Create_ShouldReturnZeroAndEmptyIds_WhenCarryForwardNotAttempted(int dayDelta, int? offset)
    {
        var date = UserDateHelper.GetUserToday(DateTime.UtcNow, offset).AddDays(dayDelta);
        SetupCreate(date);

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = date, TimezoneOffsetMinutes = offset });

        var body = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject.Value
            .Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnConflictWithZeroMoved_WhenEntryAlreadyExists()
    {
        var date = UserDateHelper.GetUserToday(DateTime.UtcNow, 0);
        _repo.Setup(r => r.GetByDateAsync(date)).ReturnsAsync(new JournalEntry { Id = 4, Title = "t", Date = date });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = date, TimezoneOffsetMinutes = 0 });

        var conflict = result.Result.Should().BeOfType<ConflictObjectResult>().Subject;
        var existing = conflict.Value!.GetType().GetProperty("existingEntry")!.GetValue(conflict.Value)
            .Should().BeOfType<JournalEntryResponseDto>().Subject;
        existing.MovedCount.Should().Be(0);
        existing.MovedTaskItemIds.Should().BeEmpty();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnConflict_WhenDuplicateDateRaceOccurs()
    {
        var date = UserDateHelper.GetUserToday(DateTime.UtcNow, 0);
        _repo.SetupSequence(r => r.GetByDateAsync(date))
            .ReturnsAsync((JournalEntry?)null)
            .ReturnsAsync(new JournalEntry { Id = 4, Title = "t", Date = date });
        _validator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default)).ReturnsAsync(new ValidationResult());
        _repo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>())).ThrowsAsync(new DuplicateJournalDateException(date));

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = date, TimezoneOffsetMinutes = 0 });

        var conflict = result.Result.Should().BeOfType<ConflictObjectResult>().Subject;
        var existing = conflict.Value!.GetType().GetProperty("existingEntry")!.GetValue(conflict.Value)
            .Should().BeOfType<JournalEntryResponseDto>().Subject;
        existing.MovedCount.Should().Be(0);
        existing.MovedTaskItemIds.Should().BeEmpty();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnZeroMoved_WhenCarryForwardLosesRaceAndReturnsEmpty()
    {
        const int offset = 300;
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        SetupCreate(today, id: 23);
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(23, today)).ReturnsAsync(new List<int>());
        _repo.Setup(r => r.GetByIdAsync(23)).ReturnsAsync(new JournalEntry { Id = 23, Title = "t", Date = today });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = today, TimezoneOffsetMinutes = offset });

        var body = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject.Value
            .Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(23, today), Times.Once);
    }

    [Fact]
    public void ResponseDtos_ShouldSerializeMovedFields_WhenEmpty()
    {
        var entryJson = System.Text.Json.JsonSerializer.Serialize(new JournalEntryResponseDto { Title = "t" });
        var carryJson = System.Text.Json.JsonSerializer.Serialize(new CarryForwardResponseDto());

        entryJson.Should().Contain("\"MovedCount\":0").And.Contain("\"MovedTaskItemIds\":[]");
        carryJson.Should().Contain("\"MovedCount\":0").And.Contain("\"MovedTaskItemIds\":[]");
    }

    [Fact]
    public async Task CarryForward_ShouldReturnZeroAndEmpty_WhenInlineCarryForwardAlreadyMovedTasks()
    {
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, 0);
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(new JournalEntry { Id = 3, Title = "t", Date = today });
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(3, today)).ReturnsAsync([]);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 0 });

        var body = result.Result.Should().BeOfType<OkObjectResult>().Subject.Value.Should().BeOfType<CarryForwardResponseDto>().Subject;
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
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

        var body = result.Result.Should().BeOfType<OkObjectResult>().Subject.Value.Should().BeOfType<CarryForwardResponseDto>().Subject;
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnZeroWithoutRepoCall_WhenEntryIsNotUserToday()
    {
        var entry = new JournalEntry { Id = 3, Title = "t", Date = UserDateHelper.GetUserToday(DateTime.UtcNow, 0).AddDays(1) };
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(entry);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 0 });

        var body = result.Result.Should().BeOfType<OkObjectResult>().Subject.Value.Should().BeOfType<CarryForwardResponseDto>().Subject;
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnRepoCount_WhenEntryIsUserToday()
    {
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, 840);
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(new JournalEntry { Id = 3, Title = "t", Date = today });
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(3, today)).ReturnsAsync([7, 8, 9, 12]);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 840 });

        var body = result.Result.Should().BeOfType<OkObjectResult>().Subject.Value.Should().BeOfType<CarryForwardResponseDto>().Subject;
        body.MovedCount.Should().Be(4);
        body.MovedTaskItemIds.Should().Equal(7, 8, 9, 12);
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

    // ---- End-to-end (real repository on SQLite) tests for carry-forward ----

    private sealed class RealRepoHarness : IAsyncDisposable
    {
        private readonly SqliteConnection _connection = new("DataSource=:memory:");
        public TaskDbContext Context { get; }
        public JournalEntryRepository Repo { get; }
        public JournalEntriesController Controller { get; }

        public RealRepoHarness()
        {
            _connection.Open();
            Context = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);
            Context.Database.EnsureCreated();
            Repo = new JournalEntryRepository(Context);
            var entryValidator = new Mock<IValidator<JournalEntry>>();
            entryValidator.Setup(v => v.ValidateAsync(It.IsAny<JournalEntry>(), default)).ReturnsAsync(new ValidationResult());
            Controller = new JournalEntriesController(
                Repo, entryValidator.Object, new CreateJournalEntryDtoValidator(), new CarryForwardRequestDtoValidator());
        }

        public async Task<(JournalEntry entry, TaskItem open, TaskItem done)> SeedOldEntryAsync(DateOnly date)
        {
            var entry = new JournalEntry { Title = "Old", Date = date, CreatedAt = DateTime.UtcNow };
            var open = new TaskItem { Title = "Open", Status = Status.Todo };
            var done = new TaskItem { Title = "Done", Status = Status.Completed, IsComplete = true };
            Context.JournalEntries.Add(entry);
            Context.TaskItems.AddRange(open, done);
            await Context.SaveChangesAsync();
            open.CurrentJournalEntryId = entry.Id;
            done.CurrentJournalEntryId = entry.Id;
            entry.Todos.Add(open);
            entry.Todos.Add(done);
            await Context.SaveChangesAsync();
            return (entry, open, done);
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await _connection.DisposeAsync();
        }
    }

    // Picks an offset whose local date differs from the UTC date right now (840 and -720 are 26h apart, so one always differs).
    private static int OffsetWhereUserDateDiffersFromUtc()
    {
        var utc = DateTime.UtcNow;
        return UserDateHelper.GetUserToday(utc, 840) != DateOnly.FromDateTime(utc) ? 840 : -720;
    }

    [Fact]
    public async Task Create_EndToEnd_ShouldCarryIncompleteTasksUsingClientOffsetNotUtcDate()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        var (old, open, done) = await h.SeedOldEntryAsync(userToday.AddDays(-3));

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = userToday, TimezoneOffsetMinutes = offset });

        var body = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.TodoTaskItemIds.Should().BeEquivalentTo([open.Id]);
        var reloaded = await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id);
        reloaded.MoveCount.Should().Be(1);
        reloaded.CurrentJournalEntryId.Should().Be(body.Id);
        (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == done.Id)).CurrentJournalEntryId.Should().Be(old.Id);
        (await h.Context.TaskItemEvents.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Create_EndToEnd_ShouldNotMoveTasks_WhenDateIsUtcTodayButNotUserToday()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var utcDate = DateOnly.FromDateTime(DateTime.UtcNow);
        var (_, open, _) = await h.SeedOldEntryAsync(utcDate.AddDays(-3));

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = utcDate, TimezoneOffsetMinutes = offset });

        result.Result.Should().BeOfType<CreatedAtRouteResult>();
        (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id)).MoveCount.Should().Be(0);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(-1, true)]
    public async Task Create_EndToEnd_ShouldNotMoveTasks_WhenOffsetMissingOrDateNotToday(int dayDelta, bool withOffset)
    {
        await using var h = new RealRepoHarness();
        var utcDate = DateOnly.FromDateTime(DateTime.UtcNow);
        var (_, open, _) = await h.SeedOldEntryAsync(utcDate.AddDays(-10));
        int? offset = withOffset ? 0 : null;

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = utcDate.AddDays(dayDelta), TimezoneOffsetMinutes = offset });

        var body = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.TodoTaskItemIds.Should().BeEmpty();
        (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id)).MoveCount.Should().Be(0);
        (await h.Context.TaskItemEvents.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task CarryForward_EndToEnd_ShouldMoveOnceThenReportZero_WhenCalledTwiceForToday()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        var (_, open, _) = await h.SeedOldEntryAsync(userToday.AddDays(-2));
        var todayEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Today", Date = userToday });

        var first = await h.Controller.CarryForward(todayEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });
        var second = await h.Controller.CarryForward(todayEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });

        first.Result.Should().BeOfType<OkObjectResult>().Which.Value.Should().BeOfType<CarryForwardResponseDto>().Which.MovedCount.Should().Be(1);
        second.Result.Should().BeOfType<OkObjectResult>().Which.Value.Should().BeOfType<CarryForwardResponseDto>().Which.MovedCount.Should().Be(0);
        var reloaded = await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id);
        reloaded.MoveCount.Should().Be(1);
        reloaded.CurrentJournalEntryId.Should().Be(todayEntry.Id);
        (await h.Context.TaskItemEvents.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Create_EndToEnd_ShouldReportExactMovedTasks_WhenCreatingUserToday()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        var (_, open, done) = await h.SeedOldEntryAsync(userToday.AddDays(-3));

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = userToday, TimezoneOffsetMinutes = offset });

        var body = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.MovedCount.Should().Be(1);
        body.MovedTaskItemIds.Should().Equal(open.Id);
        body.MovedTaskItemIds.Should().NotContain(done.Id);
        body.TodoTaskItemIds.Should().Contain(body.MovedTaskItemIds);
        var history = await h.Context.TaskItemEvents.AsNoTracking().SingleAsync(e => e.TaskItemId == open.Id);
        history.ChangeSummary.Should().Be("Automatically moved forward to the next journal day.");
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(-1, true)]
    public async Task Create_EndToEnd_ShouldReportZeroMovedAndEmptyIds_WhenOffsetMissingOrDateNotToday(int dayDelta, bool withOffset)
    {
        await using var h = new RealRepoHarness();
        var utcDate = DateOnly.FromDateTime(DateTime.UtcNow);
        await h.SeedOldEntryAsync(utcDate.AddDays(-10));
        int? offset = withOffset ? 0 : null;

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = utcDate.AddDays(dayDelta), TimezoneOffsetMinutes = offset });

        var body = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
    }

    [Fact]
    public async Task Create_EndToEnd_ShouldReportZeroMovedAndEmptyIds_WhenNoIncompleteEarlierTasks()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = userToday, TimezoneOffsetMinutes = offset });

        var body = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject.Value.Should().BeOfType<JournalEntryResponseDto>().Subject;
        body.MovedCount.Should().Be(0);
        body.MovedTaskItemIds.Should().BeEmpty();
    }

    [Fact]
    public async Task CarryForward_EndToEnd_ShouldReturnMovedIdsThenEmpty_WhenCalledTwiceForToday()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        var (_, open, _) = await h.SeedOldEntryAsync(userToday.AddDays(-2));
        var todayEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Today", Date = userToday });

        var first = await h.Controller.CarryForward(todayEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });
        var second = await h.Controller.CarryForward(todayEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });

        var firstBody = first.Result.Should().BeOfType<OkObjectResult>().Subject.Value.Should().BeOfType<CarryForwardResponseDto>().Subject;
        firstBody.MovedCount.Should().Be(1);
        firstBody.MovedTaskItemIds.Should().Equal(open.Id);
        var secondBody = second.Result.Should().BeOfType<OkObjectResult>().Subject.Value.Should().BeOfType<CarryForwardResponseDto>().Subject;
        secondBody.MovedCount.Should().Be(0);
        secondBody.MovedTaskItemIds.Should().BeEmpty();
    }

    [Fact]
    public async Task CarryForward_EndToEnd_ShouldMoveNothing_WhenNoOffsetOrEntryNotUserToday()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        var utcDate = DateOnly.FromDateTime(DateTime.UtcNow);
        // userToday is utcDate +/- 1 (never equal), so offsets of -2, +5 from userToday cannot hit userToday or utcDate at any hour.
        var oldDate = userToday.AddDays(-2);
        var futureDate = userToday.AddDays(5);
        new[] { oldDate, userToday, futureDate, utcDate }.Distinct().Should().HaveCount(4);
        var (_, open, _) = await h.SeedOldEntryAsync(oldDate);
        var todayEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Today", Date = userToday });
        var tomorrowEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Future", Date = futureDate });
        var utcEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Utc", Date = utcDate });

        var noOffset = await h.Controller.CarryForward(todayEntry.Id, new CarryForwardRequestDto());
        var tomorrow = await h.Controller.CarryForward(tomorrowEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });
        var utcOnly = await h.Controller.CarryForward(utcEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });

        foreach (var r in new[] { noOffset, tomorrow, utcOnly })
        {
            r.Result.Should().BeOfType<OkObjectResult>().Which.Value.Should().BeOfType<CarryForwardResponseDto>().Which.MovedCount.Should().Be(0);
        }

        (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id)).MoveCount.Should().Be(0);
    }
}
