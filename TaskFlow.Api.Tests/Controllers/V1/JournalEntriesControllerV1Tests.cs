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

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    public async Task Create_ShouldReturnBadRequest_WhenOffsetOutOfRange(int offset)
    {
        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = new DateOnly(2026, 5, 11), TimezoneOffsetMinutes = offset });

        Assert.IsType<BadRequestObjectResult>(result.Result);
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

        Assert.IsType<CreatedAtRouteResult>(result.Result);
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

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var body = Assert.IsType<JournalEntryResponseDto>(created.Value);
        Assert.Equal(new[] { 5, 6 }, body.TodoTaskItemIds.Order());
        Assert.Equal(2, body.MovedCount);
        Assert.Equal(new[] { 3, 5 }, body.MovedTaskItemIds);
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

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var body = Assert.IsType<JournalEntryResponseDto>(created.Value);
        Assert.Empty(body.TodoTaskItemIds);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
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

        var body = Assert.IsType<JournalEntryResponseDto>(Assert.IsType<CreatedAtRouteResult>(result.Result).Value);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnConflictWithZeroMoved_WhenEntryAlreadyExists()
    {
        var date = UserDateHelper.GetUserToday(DateTime.UtcNow, 0);
        _repo.Setup(r => r.GetByDateAsync(date)).ReturnsAsync(new JournalEntry { Id = 4, Title = "t", Date = date });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "t", Date = date, TimezoneOffsetMinutes = 0 });

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var existing = Assert.IsType<JournalEntryResponseDto>(conflict.Value!.GetType().GetProperty("existingEntry")!.GetValue(conflict.Value));
        Assert.Equal(0, existing.MovedCount);
        Assert.Empty(existing.MovedTaskItemIds);
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

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var existing = Assert.IsType<JournalEntryResponseDto>(conflict.Value!.GetType().GetProperty("existingEntry")!.GetValue(conflict.Value));
        Assert.Equal(0, existing.MovedCount);
        Assert.Empty(existing.MovedTaskItemIds);
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

        var body = Assert.IsType<JournalEntryResponseDto>(Assert.IsType<CreatedAtRouteResult>(result.Result).Value);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(23, today), Times.Once);
    }

    [Fact]
    public void ResponseDtos_ShouldSerializeMovedFields_WhenEmpty()
    {
        var entryJson = System.Text.Json.JsonSerializer.Serialize(new JournalEntryResponseDto { Title = "t" });
        var carryJson = System.Text.Json.JsonSerializer.Serialize(new CarryForwardResponseDto());

        Assert.Contains("\"MovedCount\":0", entryJson);
        Assert.Contains("\"MovedTaskItemIds\":[]", entryJson);
        Assert.Contains("\"MovedCount\":0", carryJson);
        Assert.Contains("\"MovedTaskItemIds\":[]", carryJson);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnZeroAndEmpty_WhenInlineCarryForwardAlreadyMovedTasks()
    {
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, 0);
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(new JournalEntry { Id = 3, Title = "t", Date = today });
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(3, today)).ReturnsAsync([]);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 0 });

        var body = Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnBadRequest_WhenOffsetOutOfRange()
    {
        var result = await _controller.CarryForward(1, new CarryForwardRequestDto { TimezoneOffsetMinutes = 841 });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnNotFound_WhenEntryMissing()
    {
        _repo.Setup(r => r.GetByIdAsync(5)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.CarryForward(5, new CarryForwardRequestDto { TimezoneOffsetMinutes = 0 });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CarryForward_ShouldReturnZeroWithoutRepoCall_WhenOffsetMissingOrBodyNull(bool nullBody)
    {
        var entry = new JournalEntry { Id = 3, Title = "t", Date = DateOnly.FromDateTime(DateTime.UtcNow) };
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(entry);

        var result = await _controller.CarryForward(3, nullBody ? null : new CarryForwardRequestDto());

        var body = Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnZeroWithoutRepoCall_WhenEntryIsNotUserToday()
    {
        var entry = new JournalEntry { Id = 3, Title = "t", Date = UserDateHelper.GetUserToday(DateTime.UtcNow, 0).AddDays(1) };
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(entry);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 0 });

        var body = Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
        _repo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task CarryForward_ShouldReturnRepoCount_WhenEntryIsUserToday()
    {
        var today = UserDateHelper.GetUserToday(DateTime.UtcNow, 840);
        _repo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(new JournalEntry { Id = 3, Title = "t", Date = today });
        _repo.Setup(r => r.CarryForwardIncompleteTasksAsync(3, today)).ReturnsAsync([7, 8, 9, 12]);

        var result = await _controller.CarryForward(3, new CarryForwardRequestDto { TimezoneOffsetMinutes = 840 });

        var body = Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(4, body.MovedCount);
        Assert.Equal(new[] { 7, 8, 9, 12 }, body.MovedTaskItemIds);
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

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<JournalEntryResponseDto>>(ok.Value);
        Assert.Single(dtos, d => d.Id == 1 && d.Date == new DateOnly(2026, 5, 10));
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenMissing()
    {
        _repo.Setup(r => r.GetByIdAsync(123)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Get(123);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Create_ShouldReturnConflict_WhenDateAlreadyExists()
    {
        var date = new DateOnly(2026, 5, 10);
        _repo.Setup(r => r.GetByDateAsync(date))
            .ReturnsAsync(new JournalEntry { Id = 55, Title = "Existing", Date = date });

        var result = await _controller.Create(new CreateJournalEntryDto { Title = "New", Date = date });

        Assert.IsType<ConflictObjectResult>(result.Result);
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

        Assert.IsType<BadRequestObjectResult>(result.Result);
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

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        Assert.Equal("GetJournalEntryV1", created.RouteName);
        Assert.True(created.RouteValues!.TryGetValue("id", out var createdId));
        Assert.Equal(9, createdId);
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

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenMissing()
    {
        _repo.Setup(r => r.GetByIdAsync(44)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.Update(44, new UpdateJournalEntryDto { Title = "x", Summary = "s" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenFound()
    {
        _repo.Setup(r => r.GetByIdAsync(7)).ReturnsAsync(new JournalEntry { Id = 7, Title = "a", Date = new DateOnly(2026, 5, 10) });

        var result = await _controller.Delete(7);

        Assert.IsType<NoContentResult>(result);
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
            var done = new TaskItem { Title = "Done", Status = Status.Completed };
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

        var body = Assert.IsType<JournalEntryResponseDto>(Assert.IsType<CreatedAtRouteResult>(result.Result).Value);
        Assert.Equal(new[] { open.Id }, body.TodoTaskItemIds.Order());
        var reloaded = await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id);
        Assert.Equal(1, reloaded.MoveCount);
        Assert.Equal(body.Id, reloaded.CurrentJournalEntryId);
        Assert.Equal(old.Id, (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == done.Id)).CurrentJournalEntryId);
        Assert.Equal(1, (await h.Context.TaskItemEvents.CountAsync()));
    }

    [Fact]
    public async Task Create_EndToEnd_ShouldNotMoveTasks_WhenDateIsUtcTodayButNotUserToday()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var utcDate = DateOnly.FromDateTime(DateTime.UtcNow);
        var (_, open, _) = await h.SeedOldEntryAsync(utcDate.AddDays(-3));

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = utcDate, TimezoneOffsetMinutes = offset });

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        Assert.Equal(0, (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id)).MoveCount);
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

        var body = Assert.IsType<JournalEntryResponseDto>(Assert.IsType<CreatedAtRouteResult>(result.Result).Value);
        Assert.Empty(body.TodoTaskItemIds);
        Assert.Equal(0, (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id)).MoveCount);
        Assert.Equal(0, (await h.Context.TaskItemEvents.CountAsync()));
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

        Assert.Equal(1, Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(first.Result).Value).MovedCount);
        Assert.Equal(0, Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(second.Result).Value).MovedCount);
        var reloaded = await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id);
        Assert.Equal(1, reloaded.MoveCount);
        Assert.Equal(todayEntry.Id, reloaded.CurrentJournalEntryId);
        Assert.Equal(1, (await h.Context.TaskItemEvents.CountAsync()));
    }

    [Fact]
    public async Task Create_EndToEnd_ShouldReportExactMovedTasks_WhenCreatingUserToday()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);
        var (_, open, done) = await h.SeedOldEntryAsync(userToday.AddDays(-3));

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = userToday, TimezoneOffsetMinutes = offset });

        var body = Assert.IsType<JournalEntryResponseDto>(Assert.IsType<CreatedAtRouteResult>(result.Result).Value);
        Assert.Equal(1, body.MovedCount);
        Assert.Equal(new[] { open.Id }, body.MovedTaskItemIds);
        Assert.DoesNotContain(done.Id, body.MovedTaskItemIds);
        Assert.All(body.MovedTaskItemIds, movedId => Assert.Contains(movedId, body.TodoTaskItemIds));
        var history = await h.Context.TaskItemEvents.AsNoTracking().SingleAsync(e => e.TaskItemId == open.Id);
        Assert.Equal("Automatically moved forward to the next journal day.", history.ChangeSummary);
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

        var body = Assert.IsType<JournalEntryResponseDto>(Assert.IsType<CreatedAtRouteResult>(result.Result).Value);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
    }

    [Fact]
    public async Task Create_EndToEnd_ShouldReportZeroMovedAndEmptyIds_WhenNoIncompleteEarlierTasks()
    {
        await using var h = new RealRepoHarness();
        var offset = OffsetWhereUserDateDiffersFromUtc();
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);

        var result = await h.Controller.Create(new CreateJournalEntryDto { Title = "t", Date = userToday, TimezoneOffsetMinutes = offset });

        var body = Assert.IsType<JournalEntryResponseDto>(Assert.IsType<CreatedAtRouteResult>(result.Result).Value);
        Assert.Equal(0, body.MovedCount);
        Assert.Empty(body.MovedTaskItemIds);
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

        var firstBody = Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(first.Result).Value);
        Assert.Equal(1, firstBody.MovedCount);
        Assert.Equal(new[] { open.Id }, firstBody.MovedTaskItemIds);
        var secondBody = Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(second.Result).Value);
        Assert.Equal(0, secondBody.MovedCount);
        Assert.Empty(secondBody.MovedTaskItemIds);
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
        Assert.Equal(4, new[] { oldDate, userToday, futureDate, utcDate }.Distinct().Count());
        var (_, open, _) = await h.SeedOldEntryAsync(oldDate);
        var todayEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Today", Date = userToday });
        var tomorrowEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Future", Date = futureDate });
        var utcEntry = await h.Repo.AddAsync(new JournalEntry { Title = "Utc", Date = utcDate });

        var noOffset = await h.Controller.CarryForward(todayEntry.Id, new CarryForwardRequestDto());
        var tomorrow = await h.Controller.CarryForward(tomorrowEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });
        var utcOnly = await h.Controller.CarryForward(utcEntry.Id, new CarryForwardRequestDto { TimezoneOffsetMinutes = offset });

        foreach (var r in new[] { noOffset, tomorrow, utcOnly })
        {
            Assert.Equal(0, Assert.IsType<CarryForwardResponseDto>(Assert.IsType<OkObjectResult>(r.Result).Value).MovedCount);
        }

        Assert.Equal(0, (await h.Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == open.Id)).MoveCount);
    }
}
