using System.Text.Json;
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
/// Real-stack (SQLite, real repositories and validators) tests for the server-owned <c>CompletedAt</c> (issue #350):
/// stamping on every completion path, clearing on reopen, ignoring client values, the reopen guard definition
/// and the rule that a completed task cannot be planned onto a different day.
/// </summary>
public class TaskItemsControllerCompletedAtTests
{
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

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
                new Mock<IProjectRepository>().Object,
                new CreateTaskItemDtoValidator(),
                new UpdateTaskItemDtoValidator(),
                new PatchTaskItemDtoValidator());
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

        public async Task<JournalEntry> SeedEntryAsync(DateOnly date)
        {
            var entry = new JournalEntry { Title = $"J {date}", Date = date };
            Context.JournalEntries.Add(entry);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return entry;
        }

        public async Task<TaskItem> ReloadAsync(int id)
        {
            Context.ChangeTracker.Clear();
            return await Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        public async Task<List<string>> EventTypesAsync(int taskId) =>
            await Context.TaskItemEvents.Where(e => e.TaskItemId == taskId).OrderBy(e => e.Id).Select(e => e.EventType).ToListAsync();

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

    private static string ErrorCode(ActionResult<TaskItemResponseDto> result)
    {
        var value = Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;
        return (string)value.GetType().GetProperty("code")!.GetValue(value)!;
    }

    private static void AssertJustNow(DateTime? value)
    {
        Assert.NotNull(value);
        Assert.Equal(DateTimeKind.Utc, value!.Value.Kind);
        Assert.InRange(value.Value, DateTime.UtcNow.AddSeconds(-10), DateTime.UtcNow.AddSeconds(10));
    }

    // ---- Stamping ----

    [Theory]
    [InlineData(Status.Todo)]
    [InlineData(Status.InProgress)]
    public async Task Patch_ShouldSetCompletedAt_WhenCompleting(Status from)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = from });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed }));

        AssertJustNow(dto.CompletedAt);
        Assert.Equal(dto.CompletedAt, (await stack.ReloadAsync(seeded.Id)).CompletedAt);
    }

    [Fact]
    public async Task Put_ShouldSetCompletedAt_WhenCompleting()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "T", Status = Status.Completed }));

        AssertJustNow(dto.CompletedAt);
        AssertJustNow((await stack.ReloadAsync(seeded.Id)).CompletedAt);
    }

    [Fact]
    public async Task Patch_ShouldSetCompletedAt_WhenCompletingBlockedTask()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Blocked,
            PreviousStatus = Status.Todo,
            BlockedAt = DateTime.UtcNow.AddHours(-1)
        });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed }));

        AssertJustNow(dto.CompletedAt);
        Assert.Equal(["Completed"], await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Create_ShouldSetCompletedAtAndWriteNoCompletedEvent_WhenCreatedAsCompleted()
    {
        using var stack = new RealStack();

        var dto = CreatedDto(await stack.Controller.Create(new CreateTaskItemDto { Title = "T", Status = Status.Completed }));

        AssertJustNow(dto.CompletedAt);
        Assert.Equal(["TaskCreated"], await stack.EventTypesAsync(dto.Id));
    }

    [Theory]
    [InlineData(Status.Draft)]
    [InlineData(Status.Todo)]
    [InlineData(Status.InProgress)]
    public async Task Create_ShouldLeaveCompletedAtNull_WhenNotCompleted(Status status)
    {
        using var stack = new RealStack();

        var dto = CreatedDto(await stack.Controller.Create(new CreateTaskItemDto { Title = "T", Status = status }));

        Assert.Null(dto.CompletedAt);
    }

    [Fact]
    public async Task Patch_ShouldStampParentCompletedAt_WhenLastChildAutoCompletesIt()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        var childDto = OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { Status = Status.Completed, AutoCompleteParentWhenChildrenDone = true }));

        var reloadedParent = await stack.ReloadAsync(parent.Id);
        Assert.Equal(Status.Completed, reloadedParent.Status);
        AssertJustNow(reloadedParent.CompletedAt);
        Assert.True(reloadedParent.CompletedAt >= childDto.CompletedAt);
    }

    // ---- Reopen ----

    [Fact]
    public async Task Patch_ShouldClearCompletedAtOnReopen_AndSetLaterValueOnRecomplete()
    {
        using var stack = new RealStack();
        var firstCompletion = DateTime.UtcNow.AddMinutes(-30);
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = firstCompletion });

        var reopened = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));
        Assert.Null(reopened.CompletedAt);
        Assert.Null((await stack.ReloadAsync(seeded.Id)).CompletedAt);

        var recompleted = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed }));
        Assert.True(recompleted.CompletedAt > firstCompletion);
        Assert.Equal(["Reopened", "Completed"], await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Put_ShouldClearCompletedAtOnReopen()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = DateTime.UtcNow });

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "T", Status = Status.Todo }));

        Assert.Null(dto.CompletedAt);
        Assert.Null((await stack.ReloadAsync(seeded.Id)).CompletedAt);
    }

    [Fact]
    public async Task Patch_ReopeningChild_ShouldNotReopenCompletedParent()
    {
        using var stack = new RealStack();
        var parentCompletedAt = DateTime.UtcNow.AddMinutes(-5);
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Completed, CompletedAt = parentCompletedAt });
        var child = await stack.SeedAsync(new TaskItem
        {
            Title = "Child",
            Status = Status.Completed,
            CompletedAt = DateTime.UtcNow.AddMinutes(-6),
            ParentTaskItemId = parent.Id
        });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { Status = Status.Todo }));

        var reloadedParent = await stack.ReloadAsync(parent.Id);
        Assert.Equal(Status.Completed, reloadedParent.Status);
        Assert.Equal(parentCompletedAt, reloadedParent.CompletedAt);
        Assert.Equal(Status.Todo, (await stack.ReloadAsync(child.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldRejectReopen_WhenCompletedYesterdayEvenIfLinkedToToday()
    {
        using var stack = new RealStack();
        var entry = await stack.SeedEntryAsync(Today);
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Completed,
            CompletedAt = DateTime.UtcNow.AddDays(-1),
            CurrentJournalEntryId = entry.Id
        });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 });

        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", ErrorCode(result));
        Assert.Equal(Status.Completed, (await stack.ReloadAsync(seeded.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldAllowReopen_WhenCompletedTodayEvenIfLinkedToPastDay()
    {
        using var stack = new RealStack();
        var entry = await stack.SeedEntryAsync(Today.AddDays(-4));
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Completed,
            CompletedAt = DateTime.UtcNow,
            CurrentJournalEntryId = entry.Id
        });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 }));

        Assert.Equal("Todo", dto.Status);
        Assert.Null(dto.CompletedAt);
    }

    [Fact]
    public async Task Patch_ShouldAllowReopen_WhenLegacyCompletedTaskHasNoJournalDay()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal("Todo", dto.Status);
    }

    // ---- Client-sent values are ignored ----

    [Fact]
    public async Task Create_ShouldIgnoreClientSentCompletedAt()
    {
        using var stack = new RealStack();
        var createDto = JsonSerializer.Deserialize<CreateTaskItemDto>(
            """{"title":"T","status":"todo","completedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = CreatedDto(await stack.Controller.Create(createDto));

        Assert.Null(dto.CompletedAt);
    }

    [Fact]
    public async Task Create_ShouldStampServerTime_WhenClientSendsCompletedAtOnCompletedTask()
    {
        using var stack = new RealStack();
        var createDto = JsonSerializer.Deserialize<CreateTaskItemDto>(
            """{"title":"T","status":"completed","completedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = CreatedDto(await stack.Controller.Create(createDto));

        AssertJustNow(dto.CompletedAt);
    }

    [Fact]
    public async Task Put_ShouldIgnoreClientSentCompletedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });
        var updateDto = JsonSerializer.Deserialize<UpdateTaskItemDto>(
            """{"title":"Renamed","status":"completed","completedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = OkDto(await stack.Controller.Update(seeded.Id, updateDto));

        AssertJustNow(dto.CompletedAt);
        AssertJustNow((await stack.ReloadAsync(seeded.Id)).CompletedAt);
    }

    [Fact]
    public async Task Patch_ShouldIgnoreClientSentCompletedAt_WhenCompleting()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });
        var patchDto = JsonSerializer.Deserialize<PatchTaskItemDto>(
            """{"status":"completed","completedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, patchDto));

        AssertJustNow(dto.CompletedAt);
    }

    [Fact]
    public async Task Patch_ShouldNotChangeCompletedAt_WhenClientSendsDifferentValueOnCompletedTask()
    {
        using var stack = new RealStack();
        var stored = DateTime.UtcNow.AddMinutes(-20);
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = stored });
        var patchDto = JsonSerializer.Deserialize<PatchTaskItemDto>(
            """{"title":"Renamed","completedAt":"2020-01-01T00:00:00Z"}""",
            JsonSerializerOptionsProvider.Default)!;

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, patchDto));

        Assert.Equal(stored, dto.CompletedAt);
    }

    // ---- Planning a completed task ----

    [Fact]
    public async Task Put_ShouldReturnPlanCompletedError_AndChangeNothing_WhenJournalDateDiffersOnCompletedAtTask()
    {
        using var stack = new RealStack();
        var entry = await stack.SeedEntryAsync(Today);
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Completed,
            CompletedAt = DateTime.UtcNow,
            CurrentJournalEntryId = entry.Id
        });

        var result = await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto
        {
            Title = "Renamed",
            Status = Status.Completed,
            JournalDate = Today.AddDays(2),
            TimezoneOffsetMinutes = 0
        });

        Assert.Equal("TASK_PLAN_COMPLETED_NOT_ALLOWED", ErrorCode(result));
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal("T", reloaded.Title);
        Assert.Equal(entry.Id, reloaded.CurrentJournalEntryId);
        Assert.Empty(await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldReturnPlanCompletedError_AndChangeNothing_WhenJournalDateDiffersOnCompletedAtTask()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = DateTime.UtcNow });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Title = "Renamed", JournalDate = Today.AddDays(2), TimezoneOffsetMinutes = 0 });

        Assert.Equal("TASK_PLAN_COMPLETED_NOT_ALLOWED", ErrorCode(result));
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal("T", reloaded.Title);
        Assert.Null(reloaded.CurrentJournalEntryId);
    }

    [Fact]
    public async Task Patch_ShouldAcceptJournalDateEqualToCurrentLink_OnCompletedAtTask_EvenForPastDay()
    {
        using var stack = new RealStack();
        var entry = await stack.SeedEntryAsync(Today.AddDays(-3));
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Completed,
            CompletedAt = DateTime.UtcNow.AddDays(-3),
            CurrentJournalEntryId = entry.Id
        });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Title = "Renamed", JournalDate = Today.AddDays(-3), TimezoneOffsetMinutes = 0 }));

        Assert.Equal("Renamed", dto.Title);
        Assert.Equal(entry.Id, dto.CurrentJournalEntryId);
    }

    [Fact]
    public async Task Put_ShouldAcceptNullJournalDate_OnCompletedAtTask()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = DateTime.UtcNow });

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Renamed", Status = Status.Completed }));

        Assert.Equal("Renamed", dto.Title);
    }

    [Fact]
    public async Task Put_ShouldStillPlanLegacyCompletedTask_WithNullCompletedAt()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed });
        var target = Today.AddDays(2);

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto
        {
            Title = "T",
            Status = Status.Completed,
            JournalDate = target,
            TimezoneOffsetMinutes = 0
        }));

        Assert.Equal(target, dto.CurrentJournalDate);
        Assert.Null(dto.CompletedAt);
    }

    [Fact]
    public async Task Put_ShouldReturnPlanCompletedError_WhenReopeningAndReplanningInOneRequest()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = DateTime.UtcNow });

        var result = await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto
        {
            Title = "T",
            Status = Status.Todo,
            JournalDate = Today.AddDays(2),
            TimezoneOffsetMinutes = 0
        });

        Assert.Equal("TASK_PLAN_COMPLETED_NOT_ALLOWED", ErrorCode(result));
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal(Status.Completed, reloaded.Status);
        Assert.NotNull(reloaded.CompletedAt);
    }

    [Fact]
    public async Task Patch_ShouldReturnReopenError_NotPlanError_WhenBothApply()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = DateTime.UtcNow.AddDays(-2) });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto
        {
            Status = Status.Todo,
            JournalDate = Today.AddDays(2),
            TimezoneOffsetMinutes = 0
        });

        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", ErrorCode(result));
    }

    // ---- OpenAPI contract ----

    [Theory]
    [InlineData(nameof(TaskItemsController.Update))]
    [InlineData(nameof(TaskItemsController.Patch))]
    public void UpdateAndPatch_ShouldDeclare422ResponseWithRuleErrorBody(string actionName)
    {
        var method = typeof(TaskItemsController).GetMethod(actionName)!;

        var attributes = method.GetCustomAttributes(typeof(ProducesResponseTypeAttribute), inherit: true)
            .Cast<ProducesResponseTypeAttribute>()
            .Where(a => a.StatusCode == 422)
            .ToList();

        var declared = Assert.Single(attributes);
        Assert.Equal(typeof(TaskRuleErrorResponseDto), declared.Type);
    }

    // ---- Read paths ----

    [Fact]
    public async Task Get_ShouldReturnCompletedAt()
    {
        using var stack = new RealStack();
        var completedAt = DateTime.UtcNow.AddMinutes(-3);
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CompletedAt = completedAt });

        var ok = Assert.IsType<OkObjectResult>((await stack.Controller.Get(seeded.Id)).Result);

        Assert.Equal(completedAt, Assert.IsType<TaskItemResponseDto>(ok.Value).CompletedAt);
    }
}
