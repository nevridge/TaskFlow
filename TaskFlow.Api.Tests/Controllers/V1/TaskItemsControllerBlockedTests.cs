using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.Data;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Tests for the Blocked status transitions on <c>PUT/PATCH/POST /api/v1/TaskItems</c> (issue #307).
/// Success paths use a real SQLite context, the real repository and the real validator.
/// </summary>
public class TaskItemsControllerBlockedTests
{
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

        public async Task<List<TaskItemEvent>> EventsAsync(int taskId) =>
            await Context.TaskItemEvents.AsNoTracking().Where(e => e.TaskItemId == taskId).OrderBy(e => e.Id).ToListAsync();

        public async Task<TaskItem> ReloadAsync(int id)
        {
            Context.ChangeTracker.Clear();
            return await Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        public async Task<TaskItem> SeedBlockedAsync(string? reason = "Waiting", Status previous = Status.Todo) =>
            await SeedAsync(new TaskItem
            {
                Title = "Blocked task",
                Status = Status.Blocked,
                BlockedReason = reason,
                BlockedAt = new DateTime(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc),
                PreviousStatus = previous
            });

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

    private static string ErrorCode(ActionResult<TaskItemResponseDto> result)
    {
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var value = unprocessable.Value!;
        return (string)value.GetType().GetProperty("code")!.GetValue(value)!;
    }

    private static string ErrorMessage(ActionResult<TaskItemResponseDto> result)
    {
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var value = unprocessable.Value!;
        return (string)value.GetType().GetProperty("message")!.GetValue(value)!;
    }

    // ---- Entering Blocked ----

    [Fact]
    public async Task Patch_ShouldBlockTodoTask_WithReasonTimestampAndPreviousStatus()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto
        {
            Status = Status.Blocked,
            BlockedReason = "  Waiting on Sam  "
        }));

        Assert.Equal("Blocked", dto.Status);
        Assert.Equal("Waiting on Sam", dto.BlockedReason);
        Assert.Equal("Todo", dto.PreviousStatus);
        Assert.NotNull(dto.BlockedAt);
        Assert.Equal(DateTimeKind.Utc, dto.BlockedAt!.Value.Kind);
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal(Status.Blocked, reloaded.Status);
        Assert.Equal(Status.Todo, reloaded.PreviousStatus);
        var blockedEvent = Assert.Single(await stack.EventsAsync(seeded.Id));
        Assert.Equal("Blocked", blockedEvent.EventType);
        Assert.Equal("Blocked: Waiting on Sam.", blockedEvent.ChangeSummary);
    }

    [Fact]
    public async Task Patch_ShouldBlockWithoutReason_AndReturnNullReason()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked }));

        Assert.Equal("Blocked", dto.Status);
        Assert.Null(dto.BlockedReason);
        Assert.NotNull(dto.BlockedAt);
        Assert.Equal("Blocked.", Assert.Single(await stack.EventsAsync(seeded.Id)).ChangeSummary);
    }

    [Fact]
    public async Task Patch_ShouldStoreWhitespaceReasonAsNull_WhenBlocking()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked, BlockedReason = "   " }));

        Assert.Null(dto.BlockedReason);
        Assert.Null((await stack.ReloadAsync(seeded.Id)).BlockedReason);
    }

    [Fact]
    public async Task Patch_ShouldAcceptTwoHundredCharacterReason()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });
        var reason = new string('a', 200);

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked, BlockedReason = $" {reason} " }));

        Assert.Equal(reason, dto.BlockedReason);
    }

    [Fact]
    public async Task Patch_ShouldReturnBadRequest_WhenReasonExceedsTwoHundredCharacters()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto
        {
            Status = Status.Blocked,
            BlockedReason = new string('a', 201)
        });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(Status.Todo, (await stack.ReloadAsync(seeded.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenBlockingDraftTask_AndLeaveTaskUnchanged()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Draft });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked, BlockedReason = "x" });

        Assert.Equal("TASK_BLOCK_DRAFT_NOT_ALLOWED", ErrorCode(result));
        Assert.Equal("Only Todo or In Progress tasks can be blocked.", ErrorMessage(result));
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal(Status.Draft, reloaded.Status);
        Assert.Null(reloaded.BlockedReason);
        Assert.Null(reloaded.BlockedAt);
        Assert.Null(reloaded.PreviousStatus);
        Assert.Empty(await stack.EventsAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenBlockingCompletedTask_Today()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked });

        Assert.Equal("TASK_BLOCK_COMPLETED_NOT_ALLOWED", ErrorCode(result));
        Assert.Equal(Status.Completed, (await stack.ReloadAsync(seeded.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldReturnBlockCompletedError_NotReopenError_WhenCompletedTaskOnPastDay()
    {
        using var stack = new RealStack();
        var entry = new JournalEntry { Title = "Past", Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-3) };
        stack.Context.JournalEntries.Add(entry);
        await stack.Context.SaveChangesAsync();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Completed, CurrentJournalEntryId = entry.Id });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked, TimezoneOffsetMinutes = 0 });

        Assert.Equal("TASK_BLOCK_COMPLETED_NOT_ALLOWED", ErrorCode(result));
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenReasonSentOnTodoTaskWithoutBlocking()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { BlockedReason = "nope" });

        Assert.Equal("TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS", ErrorCode(result));
        Assert.Null((await stack.ReloadAsync(seeded.Id)).BlockedReason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Patch_ShouldIgnoreEmptyReason_WhenTaskIsNotBlocked(string? reason)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { BlockedReason = reason }));

        Assert.Equal("Todo", dto.Status);
        Assert.Null(dto.BlockedReason);
        Assert.Empty(await stack.EventsAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldReturn404_WhenBlockingUnknownTask()
    {
        using var stack = new RealStack();

        var result = await stack.Controller.Patch(999, new PatchTaskItemDto { Status = Status.Blocked });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Put_ShouldBlockTodoTask_WithReason()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto
        {
            Title = "T",
            Status = Status.Blocked,
            BlockedReason = "Vendor"
        }));

        Assert.Equal("Blocked", dto.Status);
        Assert.Equal("Vendor", dto.BlockedReason);
        Assert.Equal("Todo", dto.PreviousStatus);
    }

    // ---- Staying Blocked ----

    [Fact]
    public async Task Patch_ShouldChangeOnlyReason_WhileBlocked_AndWriteBlockedReasonChangedEvent()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Old");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { BlockedReason = "New" }));

        Assert.Equal("New", dto.BlockedReason);
        Assert.Equal("Blocked", dto.Status);
        Assert.Equal("Todo", dto.PreviousStatus);
        Assert.Equal(seeded.BlockedAt, dto.BlockedAt);
        var evt = Assert.Single(await stack.EventsAsync(seeded.Id));
        Assert.Equal("BlockedReasonChanged", evt.EventType);
        Assert.Equal("Blocked reason updated.", evt.ChangeSummary);
    }

    [Fact]
    public async Task Patch_ShouldKeepReason_WhenReasonOmittedWhileBlocked()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Keep");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Title = "Renamed" }));

        Assert.Equal("Keep", dto.BlockedReason);
        Assert.Equal("Blocked", dto.Status);
        Assert.Equal(["TitleChanged"], (await stack.EventsAsync(seeded.Id)).Select(e => e.EventType));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task Patch_ShouldClearReason_WhenPresentNullOrEmptyWhileBlocked(string? reason)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Clear me");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { BlockedReason = reason }));

        Assert.Null(dto.BlockedReason);
        Assert.Equal("Blocked", dto.Status);
        Assert.Equal("BlockedReasonChanged", Assert.Single(await stack.EventsAsync(seeded.Id)).EventType);
    }

    [Fact]
    public async Task Patch_ShouldBeNoOp_WhenStatusBlockedSentAgainWithoutReasonChange()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Same");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked }));

        Assert.Equal("Same", dto.BlockedReason);
        Assert.Equal(seeded.BlockedAt, dto.BlockedAt);
        Assert.Empty(await stack.EventsAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldKeepReason_WhenOnlyStatusToggledWhileStayingBlocked_AndTitleOnly()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Persist");

        OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Title = "A" }));
        stack.Context.ChangeTracker.Clear();
        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Blocked, Title = "B" }));

        Assert.Equal("Persist", dto.BlockedReason);
    }

    [Fact]
    public async Task Put_ShouldKeepReason_WhenBlockedReasonNull()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Keep");

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Blocked task", BlockedReason = null }));

        Assert.Equal("Keep", dto.BlockedReason);
        Assert.Equal("Blocked", dto.Status);
        Assert.Empty(await stack.EventsAsync(seeded.Id));
    }

    [Fact]
    public async Task Put_ShouldClearReason_WhenBlockedReasonEmpty()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Clear");

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Blocked task", BlockedReason = "" }));

        Assert.Null(dto.BlockedReason);
        Assert.Equal("Blocked", dto.Status);
    }

    [Fact]
    public async Task Put_ShouldSetReason_WhenBlockedReasonNonEmptyWhileBlocked()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Old");

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Blocked task", BlockedReason = " Fresh " }));

        Assert.Equal("Fresh", dto.BlockedReason);
    }

    // ---- Leaving Blocked ----

    [Fact]
    public async Task Patch_ShouldRestoreTodoAndClearAllBlockedFields_WhenUnblocked()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Waiting");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal("Todo", dto.Status);
        Assert.Null(dto.BlockedReason);
        Assert.Null(dto.BlockedAt);
        Assert.Null(dto.PreviousStatus);
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Null(reloaded.BlockedReason);
        Assert.Null(reloaded.BlockedAt);
        Assert.Null(reloaded.PreviousStatus);
        var evt = Assert.Single(await stack.EventsAsync(seeded.Id));
        Assert.Equal("Unblocked", evt.EventType);
        Assert.Equal("Unblocked, back to Todo.", evt.ChangeSummary);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(Status.Draft)]
    public async Task Patch_ShouldUnblockToTodo_WhenPreviousStatusNullOrDraft(Status? previous)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Blocked,
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = previous
        });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal("Todo", dto.Status);
        Assert.Null(dto.PreviousStatus);
    }

    [Fact]
    public async Task Patch_ShouldRestoreInProgress_WhenUnblockingTaskBlockedFromInProgress()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Waiting", Status.InProgress);

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal("InProgress", dto.Status);
        Assert.Null(dto.PreviousStatus);
        Assert.Null(dto.BlockedAt);
    }

    [Fact]
    public async Task Patch_ShouldIgnoreReasonSentWithUnblock()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Waiting");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo, BlockedReason = "ignored" }));

        Assert.Equal("Todo", dto.Status);
        Assert.Null(dto.BlockedReason);
    }

    [Fact]
    public async Task Patch_ShouldCompleteBlockedTask_ClearFieldsAndWriteSingleCompletedEvent()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Waiting");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed }));

        Assert.Equal("Completed", dto.Status);
        Assert.Null(dto.BlockedReason);
        Assert.Null(dto.BlockedAt);
        Assert.Null(dto.PreviousStatus);
        var evt = Assert.Single(await stack.EventsAsync(seeded.Id));
        Assert.Equal("Completed", evt.EventType);
        Assert.Equal("Marked complete (was blocked).", evt.ChangeSummary);
    }

    [Fact]
    public async Task Patch_ShouldCompleteBlockedTask_EvenWhenAssignedToPastJournalDay()
    {
        using var stack = new RealStack();
        var entry = new JournalEntry { Title = "Past", Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-3) };
        stack.Context.JournalEntries.Add(entry);
        await stack.Context.SaveChangesAsync();
        var seeded = await stack.SeedAsync(new TaskItem
        {
            Title = "T",
            Status = Status.Blocked,
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo,
            CurrentJournalEntryId = entry.Id
        });

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed, TimezoneOffsetMinutes = 0 });

        Assert.Equal("Completed", OkDto(result).Status);
    }

    [Fact]
    public async Task Patch_ShouldLetExplicitDraftWin_WhenLeavingBlocked()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedBlockedAsync("Waiting");

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Draft }));

        Assert.Equal("Draft", dto.Status);
        Assert.Null(dto.BlockedAt);
        Assert.Null(dto.PreviousStatus);
        Assert.Null(dto.BlockedReason);
        var evt = Assert.Single(await stack.EventsAsync(seeded.Id));
        Assert.Equal("Unblocked", evt.EventType);
        Assert.Equal("Unblocked, back to Draft.", evt.ChangeSummary);
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenCompletingBlockedParentWithOpenChildren()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedBlockedAsync("Waiting");
        await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        var result = await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.Completed });

        Assert.Equal("TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", ErrorCode(result));
        Assert.Equal(Status.Blocked, (await stack.ReloadAsync(parent.Id)).Status);
    }

    // ---- Children and parents ----

    [Fact]
    public async Task Patch_ShouldNotCompleteParent_WhenOnlyRemainingChildIsBlocked()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });
        await stack.SeedAsync(new TaskItem
        {
            Title = "Blocked child",
            Status = Status.Blocked,
            BlockedAt = DateTime.UtcNow,
            PreviousStatus = Status.Todo,
            ParentTaskItemId = parent.Id
        });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto
        {
            Status = Status.Completed,
            AutoCompleteParentWhenChildrenDone = true
        }));

        Assert.Equal(Status.Todo, (await stack.ReloadAsync(parent.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldNotAutoCompleteBlockedParent_AndKeepItsBlockedFields()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedBlockedAsync("Parent waiting");
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto
        {
            Status = Status.Completed,
            AutoCompleteParentWhenChildrenDone = true
        }));

        var reloaded = await stack.ReloadAsync(parent.Id);
        Assert.Equal(Status.Blocked, reloaded.Status);
        Assert.Equal("Parent waiting", reloaded.BlockedReason);
        Assert.Equal(Status.Todo, reloaded.PreviousStatus);
        Assert.NotNull(reloaded.BlockedAt);
    }

    // ---- Create ----

    [Fact]
    public async Task Create_ShouldReturnUnprocessable_WhenStatusBlocked()
    {
        var repo = new Mock<ITaskRepository>();
        var controller = new TaskItemsController(
            repo.Object,
            new Mock<FluentValidation.IValidator<TaskItem>>().Object,
            new Mock<IJournalEntryRepository>().Object,
            new Mock<IProjectRepository>().Object);

        var result = await controller.Create(new CreateTaskItemDto { Title = "T", Status = Status.Blocked });

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var value = unprocessable.Value!;
        Assert.Equal("TASK_CREATE_BLOCKED_NOT_ALLOWED", (string)value.GetType().GetProperty("code")!.GetValue(value)!);
        repo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    // ---- Response mapping and validator wiring (mocked) ----

    [Fact]
    public async Task Get_ShouldReturnBlockedFields_FromMapTaskItemResponse()
    {
        var repo = new Mock<ITaskRepository>();
        var blockedAt = new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);
        repo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem
        {
            Id = 1,
            Title = "T",
            Status = Status.Blocked,
            BlockedReason = "R",
            BlockedAt = blockedAt,
            PreviousStatus = Status.Todo
        });
        repo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([]);
        repo.Setup(r => r.GetHistoryAsync(1)).ReturnsAsync([]);
        var validator = new Mock<FluentValidation.IValidator<TaskItem>>();
        validator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        var controller = new TaskItemsController(repo.Object, validator.Object, new Mock<IJournalEntryRepository>().Object, new Mock<IProjectRepository>().Object);

        var dto = OkDto(await controller.Get(1));

        Assert.Equal("R", dto.BlockedReason);
        Assert.Equal(blockedAt, dto.BlockedAt);
        Assert.Equal("Todo", dto.PreviousStatus);
    }
}
