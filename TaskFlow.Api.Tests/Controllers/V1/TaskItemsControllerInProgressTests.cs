using System.Text.Json;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Providers;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Tests for the InProgress status and server-owned StartedAt (issue #239) on
/// <c>POST/PUT/PATCH /api/v1/TaskItems</c>. Uses real SQLite, the real repository and the real validator.
/// </summary>
public class TaskItemsControllerInProgressTests
{
    private static readonly DateTime Original = new(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc);

    private sealed class RealStack : IDisposable
    {
        private readonly SqliteConnection _connection;

        public RealStack()
        {
            _connection = new SqliteConnection("DataSource=:memory:");
            _connection.Open();
            Context = new TaskDbContext(new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(_connection).Options);
            Context.Database.EnsureCreated();
            Controller = new TaskItemsController(
                new TaskRepository(Context),
                new TaskItemValidator(),
                new JournalEntryRepository(Context),
                new Mock<IProjectRepository>().Object);
        }

        public TaskDbContext Context { get; }
        public TaskItemsController Controller { get; }

        public async Task<TaskItem> SeedAsync(TaskItem item)
        {
            Context.TaskItems.Add(item);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return item;
        }

        public Task<TaskItem> SeedStartedAsync() =>
            SeedAsync(new TaskItem { Title = "Started", Status = Status.InProgress, StartedAt = Original });

        public async Task<TaskItem> ReloadAsync(int id)
        {
            Context.ChangeTracker.Clear();
            return await Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        public void Dispose()
        {
            Context.Dispose();
            _connection.Dispose();
        }
    }

    private static TaskItemResponseDto OkDto(ActionResult<TaskItemResponseDto> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<TaskItemResponseDto>(ok.Value);
    }

    private static TaskItemResponseDto CreatedDto(ActionResult<TaskItemResponseDto> result)
    {
        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        return Assert.IsType<TaskItemResponseDto>(created.Value);
    }

    private static object ErrorBody(ActionResult<TaskItemResponseDto> result) =>
        Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;

    private static T Prop<T>(object value, string name) => (T)value.GetType().GetProperty(name)!.GetValue(value)!;

    private static void AssertStartNotAllowed(ActionResult<TaskItemResponseDto> result, Status existing)
    {
        var body = ErrorBody(result);
        Assert.Equal("TASK_START_NOT_ALLOWED", Prop<string>(body, "code"));
        Assert.Equal("Only Todo tasks can be moved to In Progress.", Prop<string>(body, "message"));
        var details = Prop<object>(body, "details");
        Assert.Equal(existing.ToString(), Prop<string>(details, "status"));
    }

    private static IEnumerable<string> ValidationMessages(ActionResult<TaskItemResponseDto> result)
    {
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        return Assert.IsAssignableFrom<IEnumerable<ValidationFailure>>(bad.Value).Select(e => e.ErrorMessage);
    }

    // ---- Todo -> InProgress ----

    [Fact]
    public async Task Patch_ShouldStartTodoTask_AndSetStartedAtUtc()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });
        var before = DateTime.UtcNow;

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        Assert.Equal("InProgress", dto.Status);
        Assert.NotNull(dto.StartedAt);
        Assert.Equal(DateTimeKind.Utc, dto.StartedAt!.Value.Kind);
        Assert.True(dto.StartedAt.Value >= before);
        Assert.EndsWith("Z\"", JsonSerializer.Serialize(dto.StartedAt, JsonSerializerOptionsProvider.Default));
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal(Status.InProgress, reloaded.Status);
        Assert.Equal(DateTimeKind.Utc, reloaded.StartedAt!.Value.Kind);
    }

    [Fact]
    public async Task Put_ShouldStartTodoTask_AndSetStartedAtUtc()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "T", Status = Status.InProgress }));

        Assert.Equal("InProgress", dto.Status);
        Assert.NotNull(dto.StartedAt);
        Assert.Equal(DateTimeKind.Utc, dto.StartedAt!.Value.Kind);
        Assert.NotNull((await stack.ReloadAsync(seeded.Id)).StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldWriteSingleStatusChangedEvent_WhenStarting()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        var events = await stack.Context.TaskItemEvents.AsNoTracking().Where(e => e.TaskItemId == seeded.Id).ToListAsync();
        Assert.Equal("StatusChanged", Assert.Single(events).EventType);
    }

    [Fact]
    public async Task Patch_ShouldKeepStartedAtNull_WhenTodoCompletedDirectly()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed }));

        Assert.Equal("Completed", dto.Status);
        Assert.Null(dto.StartedAt);
    }

    // ---- Create ----

    [Fact]
    public async Task Create_ShouldSetStartedAt_WhenCreatedAsInProgress()
    {
        using var stack = new RealStack();

        var dto = CreatedDto(await stack.Controller.Create(new CreateTaskItemDto { Title = "T", Status = Status.InProgress }));

        Assert.Equal("InProgress", dto.Status);
        Assert.NotNull(dto.StartedAt);
        Assert.Equal(DateTimeKind.Utc, dto.StartedAt!.Value.Kind);
        Assert.NotNull((await stack.ReloadAsync(dto.Id)).StartedAt);
    }

    [Theory]
    [InlineData(Status.Todo)]
    [InlineData(Status.Draft)]
    [InlineData(Status.Completed)]
    public async Task Create_ShouldLeaveStartedAtNull_WhenNotInProgress(Status status)
    {
        using var stack = new RealStack();

        var dto = CreatedDto(await stack.Controller.Create(new CreateTaskItemDto { Title = "T", Status = status }));

        Assert.Null(dto.StartedAt);
    }

    [Fact]
    public async Task Create_ShouldIgnoreClientSentStartedAt()
    {
        using var stack = new RealStack();
        var createDto = JsonSerializer.Deserialize<CreateTaskItemDto>(
            """{"title":"T","status":"todo","startedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = CreatedDto(await stack.Controller.Create(createDto));

        Assert.Null(dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldIgnoreClientSentStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });
        var patchDto = JsonSerializer.Deserialize<PatchTaskItemDto>(
            """{"title":"Renamed","startedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, patchDto));

        Assert.Null(dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldNotChangeStartedAt_WhenClientSendsStartedAtOnStartedTask()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();
        var patchDto = JsonSerializer.Deserialize<PatchTaskItemDto>(
            """{"title":"Renamed","startedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, patchDto));

        Assert.Equal(Original, dto.StartedAt);
    }

    // ---- Leaving and re-entering InProgress ----

    [Theory]
    [InlineData(Status.Todo)]
    [InlineData(Status.Completed)]
    [InlineData(Status.Draft)]
    public async Task Patch_ShouldKeepStartedAt_WhenLeavingInProgress(Status next)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = next }));

        Assert.Equal(next.ToString(), dto.Status);
        Assert.Equal(Original, dto.StartedAt);
        Assert.Equal(Original, (await stack.ReloadAsync(seeded.Id)).StartedAt);
    }

    [Fact]
    public async Task Put_ShouldKeepStartedAt_WhenLeavingInProgress()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Started", Status = Status.Todo }));

        Assert.Equal("Todo", dto.Status);
        Assert.Equal(Original, dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldKeepOriginalStartedAt_WhenReenteringInProgress()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();

        OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));
        stack.Context.ChangeTracker.Clear();
        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        Assert.Equal("InProgress", dto.Status);
        Assert.Equal(Original, dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldKeepStartedAt_WhenInProgressSentAgain()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        Assert.Equal(Original, dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldSetStartedAt_WhenInProgressTaskHasNullStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "Legacy", Status = Status.InProgress });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        Assert.NotNull(dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldReopenCompletedStartedTask_AndKeepStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, StartedAt = Original });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal("Todo", dto.Status);
        Assert.Equal(Original, dto.StartedAt);
    }

    // ---- Rejected starts ----

    [Theory]
    [InlineData(Status.Draft)]
    [InlineData(Status.Completed)]
    public async Task Patch_ShouldReturnUnprocessable_WhenStartingDraftOrCompleted_AndLeaveTaskUnchanged(Status existing)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = existing });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress, Title = "Changed" });

        AssertStartNotAllowed(result, existing);
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal(existing, reloaded.Status);
        Assert.Equal("T", reloaded.Title);
        Assert.Null(reloaded.StartedAt);
        Assert.Empty(await stack.Context.TaskItemEvents.AsNoTracking().Where(e => e.TaskItemId == seeded.Id).ToListAsync());
    }

    [Theory]
    [InlineData(Status.Draft)]
    [InlineData(Status.Completed)]
    public async Task Put_ShouldReturnUnprocessable_WhenStartingDraftOrCompleted_AndLeaveTaskUnchanged(Status existing)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = existing });

        var result = await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Changed", Status = Status.InProgress });

        AssertStartNotAllowed(result, existing);
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal(existing, reloaded.Status);
        Assert.Equal("T", reloaded.Title);
        Assert.Null(reloaded.StartedAt);
    }

    // ---- Block / unblock ----

    [Fact]
    public async Task Patch_ShouldBlockInProgressTask_StorePreviousStatusInProgress_AndKeepStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked, BlockedReason = "Waiting" }));

        Assert.Equal("Blocked", dto.Status);
        Assert.Equal("InProgress", dto.PreviousStatus);
        Assert.Equal(Original, dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldUnblockToInProgress_AndKeepStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();
        OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked }));
        stack.Context.ChangeTracker.Clear();

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal("InProgress", dto.Status);
        Assert.Null(dto.PreviousStatus);
        Assert.Null(dto.BlockedAt);
        Assert.Equal(Original, dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldAllowExplicitInProgress_WhenBlocked_AndSetStartedAtIfNull()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Blocked,
            BlockedAt = Original,
            PreviousStatus = Status.Todo
        });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        Assert.Equal("InProgress", dto.Status);
        Assert.NotNull(dto.StartedAt);
        Assert.Null(dto.BlockedAt);
        Assert.Null(dto.PreviousStatus);
    }

    [Fact]
    public async Task Patch_ShouldAllowExplicitInProgress_WhenBlocked_AndKeepExistingStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Blocked,
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.InProgress,
            StartedAt = Original
        });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        Assert.Equal("InProgress", dto.Status);
        Assert.Equal(Original, dto.StartedAt);
    }

    // ---- Validation ----

    [Fact]
    public async Task Create_ShouldListInProgress_WhenStatusInvalid()
    {
        using var stack = new RealStack();

        var result = await stack.Controller.Create(new CreateTaskItemDto { Title = "T", Status = (Status)99 });

        Assert.Contains("Status must be a valid value (Draft, Todo, InProgress, Blocked, or Completed).", ValidationMessages(result));
    }

    [Fact]
    public async Task Patch_ShouldListInProgress_WhenStatusInvalid()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = (Status)99 });

        Assert.Contains("Status must be a valid value (Draft, Todo, InProgress, Blocked, or Completed).", ValidationMessages(result));
    }

    [Fact]
    public async Task Put_ShouldListInProgress_WhenStatusInvalid()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var result = await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "T", Status = (Status)99 });

        Assert.Contains("Status must be a valid value (Draft, Todo, InProgress, Blocked, or Completed).", ValidationMessages(result));
    }

    // ---- Response mapping ----

    [Fact]
    public async Task Get_ShouldReturnStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();

        var ok = Assert.IsType<OkObjectResult>((await stack.Controller.Get(seeded.Id)).Result);
        var dto = Assert.IsType<TaskItemResponseDto>(ok.Value);

        Assert.Equal("InProgress", dto.Status);
        Assert.Equal(Original, dto.StartedAt);
    }

    [Fact]
    public async Task GetAll_ShouldReturnStartedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedStartedAsync();

        var ok = Assert.IsType<OkObjectResult>((await stack.Controller.GetAll()).Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value);

        Assert.Equal(Original, dtos.Single(d => d.Id == seeded.Id).StartedAt);
    }

    // ---- Parents and children ----

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenCompletingInProgressParentWithOpenChildren()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedStartedAsync();
        await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.InProgress, StartedAt = Original, ParentTaskItemId = parent.Id });

        var result = await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.Completed });

        Assert.Equal("TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", Prop<string>(ErrorBody(result), "code"));
        Assert.Equal(Status.InProgress, (await stack.ReloadAsync(parent.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldNotAutoCompleteParent_WhenAnotherSubtaskIsInProgress()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });
        await stack.SeedAsync(new TaskItem { Title = "Other", Status = Status.InProgress, StartedAt = Original, ParentTaskItemId = parent.Id });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { Status = Status.Completed, AutoCompleteParentWhenChildrenDone = true }));

        Assert.Equal(Status.Todo, (await stack.ReloadAsync(parent.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldAutoCompleteInProgressParent_WhenLastSubtaskCompleted_AndKeepStartedAt()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedStartedAsync();
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.InProgress, StartedAt = Original, ParentTaskItemId = parent.Id });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { Status = Status.Completed, AutoCompleteParentWhenChildrenDone = true }));

        var reloaded = await stack.ReloadAsync(parent.Id);
        Assert.Equal(Status.Completed, reloaded.Status);
        Assert.Equal(Original, reloaded.StartedAt);
    }

    // ---- Past-day journal days ----

    private static async Task<JournalEntry> SeedPastEntryAsync(RealStack stack)
    {
        var entry = new JournalEntry { Title = "Past", Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-3) };
        stack.Context.JournalEntries.Add(entry);
        await stack.Context.SaveChangesAsync();
        return entry;
    }

    [Fact]
    public async Task Patch_ShouldCompleteInProgressTask_OnPastJournalDay_WithoutReopenRejection()
    {
        using var stack = new RealStack();
        var entry = await SeedPastEntryAsync(stack);
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.InProgress,
            StartedAt = Original,
            CurrentJournalEntryId = entry.Id
        });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed, TimezoneOffsetMinutes = 0 }));

        Assert.Equal("Completed", dto.Status);
        Assert.Equal(Original, dto.StartedAt);
    }

    [Fact]
    public async Task Patch_ShouldStillRejectReopeningCompletedTask_OnPastJournalDay()
    {
        using var stack = new RealStack();
        var entry = await SeedPastEntryAsync(stack);
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Completed,
            StartedAt = Original,
            CurrentJournalEntryId = entry.Id
        });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 });

        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", Prop<string>(ErrorBody(result), "code"));
        Assert.Equal(Status.Completed, (await stack.ReloadAsync(seeded.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldRejectStartingCompletedTask_OnPastJournalDay_WithStartError()
    {
        using var stack = new RealStack();
        var entry = await SeedPastEntryAsync(stack);
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CurrentJournalEntryId = entry.Id });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.InProgress, TimezoneOffsetMinutes = 0 });

        AssertStartNotAllowed(result, Status.Completed);
    }
}
