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
/// Tests for the TASK_PARENT_STATUS_DERIVED guard (issue #385): a parent with an open child cannot have its
/// stored status changed through PUT/PATCH. Mocked tests cover the branching; real-stack tests use SQLite.
/// </summary>
public class TaskItemsControllerParentStatusDerivedTests
{
    private const string DerivedCode = "TASK_PARENT_STATUS_DERIVED";

    private readonly Mock<ITaskRepository> _repo = new();
    private readonly Mock<FluentValidation.IValidator<TaskItem>> _validator = new();
    private readonly Mock<FluentValidation.IValidator<UpdateTaskItemDto>> _updateValidator = new();
    private readonly Mock<FluentValidation.IValidator<PatchTaskItemDto>> _patchValidator = new();
    private readonly Mock<FluentValidation.IValidator<CreateTaskItemDto>> _createValidator = new();
    private readonly TaskItemsController _controller;

    public TaskItemsControllerParentStatusDerivedTests()
    {
        _repo.Setup(r => r.GetAssignedJournalDateAsync(It.IsAny<int>())).ReturnsAsync((DateOnly?)null);
        _repo.Setup(r => r.GetAssignedJournalDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly>());
        _repo.Setup(r => r.GetLastMovedDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly>());
        _repo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);
        _validator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _updateValidator.Setup(v => v.ValidateAsync(It.IsAny<UpdateTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _patchValidator.Setup(v => v.ValidateAsync(It.IsAny<PatchTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _controller = new TaskItemsController(
            _repo.Object,
            _validator.Object,
            new Mock<IJournalEntryRepository>().Object,
            new Mock<IProjectRepository>().Object,
            _createValidator.Object,
            _updateValidator.Object,
            _patchValidator.Object);
    }

    private void SetupParent(Status status, params Status[] childStatuses)
    {
        var parent = new TaskItem
        {
            Id = 1,
            Title = "Parent",
            Status = status,
            BlockedReason = status == Status.Blocked ? "Waiting" : null,
            BlockedAt = status == Status.Blocked ? DateTime.UtcNow : null,
            PreviousStatus = status == Status.Blocked ? Status.Todo : null,
            CompletedAt = status == Status.Completed ? DateTime.UtcNow : null
        };
        _repo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(parent);
        _repo.Setup(r => r.GetByIdNoTrackingAsync(1)).ReturnsAsync(parent);
        _repo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync(
            childStatuses.Select((s, i) => new TaskItem { Id = 10 + i, Title = "Child", Status = s, ParentTaskItemId = 1 }).ToList());
    }

    private static string Code(ActionResult<TaskItemResponseDto> result)
    {
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var value = unprocessable.Value!;
        return (string)value.GetType().GetProperty("code")!.GetValue(value)!;
    }

    private static string Message(ActionResult<TaskItemResponseDto> result)
    {
        var value = Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;
        return (string)value.GetType().GetProperty("message")!.GetValue(value)!;
    }

    private static void AssertOk(ActionResult<TaskItemResponseDto> result) => Assert.IsType<OkObjectResult>(result.Result);

    // ---- Mocked: allowed ----

    [Fact]
    public async Task Update_SameStatusWithOtherFieldsChanged_OnParentWithOpenChild_Succeeds()
    {
        SetupParent(Status.Todo, Status.Todo);

        var result = await _controller.Update(1, new UpdateTaskItemDto { Title = "Renamed", Status = Status.Todo });

        AssertOk(result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Update_NoStatusSent_OnParentWithOpenChild_Succeeds()
    {
        SetupParent(Status.InProgress, Status.Todo);

        AssertOk(await _controller.Update(1, new UpdateTaskItemDto { Title = "Renamed" }));
    }

    [Fact]
    public async Task Patch_NonStatusFieldOnly_OnParentWithOpenChild_Succeeds()
    {
        SetupParent(Status.Todo, Status.Todo);

        AssertOk(await _controller.Patch(1, new PatchTaskItemDto { Title = "Renamed" }));
    }

    [Fact]
    public async Task Patch_ReasonOnly_OnBlockedParentWithOpenChild_Succeeds()
    {
        SetupParent(Status.Blocked, Status.Todo);

        AssertOk(await _controller.Patch(1, new PatchTaskItemDto { BlockedReason = "New reason" }));
    }

    [Theory]
    [InlineData(Status.Todo, Status.InProgress)]
    [InlineData(Status.InProgress, Status.Todo)]
    [InlineData(Status.Draft, Status.Todo)]
    public async Task Patch_StatusChange_WhenAllChildrenCompleted_IsAccepted(Status from, Status to)
    {
        SetupParent(from, Status.Completed, Status.Completed);

        AssertOk(await _controller.Patch(1, new PatchTaskItemDto { Status = to }));
    }

    [Fact]
    public async Task Patch_StatusChange_WhenNoChildren_IsAccepted()
    {
        SetupParent(Status.Todo);

        AssertOk(await _controller.Patch(1, new PatchTaskItemDto { Status = Status.InProgress }));
    }

    // ---- Mocked: rejected ----

    [Fact]
    public async Task Update_StatusChange_OnParentWithOpenChild_ReturnsDerived()
    {
        SetupParent(Status.Todo, Status.Completed, Status.InProgress);

        var result = await _controller.Update(1, new UpdateTaskItemDto { Title = "Parent", Status = Status.Draft });

        Assert.Equal(DerivedCode, Code(result));
        Assert.Equal("A parent task's status follows its open subtasks and cannot be changed directly.", Message(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Patch_StatusChange_OnParentWithOpenChild_ReturnsDerived()
    {
        SetupParent(Status.Todo, Status.Todo);

        var result = await _controller.Patch(1, new PatchTaskItemDto { Status = Status.InProgress });

        Assert.Equal(DerivedCode, Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        _repo.Verify(r => r.GetChildrenAsync(1), Times.Once);
    }

    [Fact]
    public async Task Patch_CompleteWithOpenChild_StillReturnsCompleteBlockedByChildren()
    {
        SetupParent(Status.Todo, Status.Todo);

        var result = await _controller.Patch(1, new PatchTaskItemDto { Status = Status.Completed });

        Assert.Equal("TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Patch_Block_OnParentWithOpenChild_ReturnsDerived()
    {
        SetupParent(Status.Todo, Status.Todo);

        var result = await _controller.Patch(1, new PatchTaskItemDto { Status = Status.Blocked, BlockedReason = "x" });

        Assert.Equal(DerivedCode, Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Patch_Unblock_OnBlockedParentWithOpenChild_ReturnsDerived()
    {
        SetupParent(Status.Blocked, Status.Todo);

        var result = await _controller.Patch(1, new PatchTaskItemDto { Status = Status.Todo });

        Assert.Equal(DerivedCode, Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ReopenCompletedParentWithOpenChild_ReturnsDerivedBeforeReopenCode()
    {
        SetupParent(Status.Completed, Status.Todo);

        var result = await _controller.Update(1, new UpdateTaskItemDto { Title = "Parent", Status = Status.Todo });

        Assert.Equal(DerivedCode, Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_CompletedResend_OnCompletedParentWithOpenChild_Succeeds()
    {
        SetupParent(Status.Completed, Status.Todo);

        AssertOk(await _controller.Update(1, new UpdateTaskItemDto { Title = "Renamed", Status = Status.Completed }));
    }

    // ---- Real stack (SQLite) ----

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

        public async Task<TaskItem> SeedAsync(string title, Status status, int? parentId = null)
        {
            var item = new TaskItem
            {
                Title = title,
                Status = status,
                ParentTaskItemId = parentId,
                BlockedReason = status == Status.Blocked ? "Waiting" : null,
                BlockedAt = status == Status.Blocked ? new DateTime(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc) : null,
                PreviousStatus = status == Status.Blocked ? Status.Todo : null,
                CompletedAt = status == Status.Completed ? DateTime.UtcNow : null
            };
            Context.TaskItems.Add(item);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return item;
        }

        public async Task<Status> StatusOfAsync(int id)
        {
            Context.ChangeTracker.Clear();
            return (await Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id)).Status;
        }

        public void Dispose()
        {
            Context.Dispose();
            _connection.Dispose();
        }
    }

    [Fact]
    public async Task RealStack_CompletingLastOpenChild_WithAutoComplete_AutoCompletesParent()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Todo);
        await stack.SeedAsync("Done", Status.Completed, parent.Id);
        var last = await stack.SeedAsync("Last", Status.Todo, parent.Id);

        AssertOk(await stack.Controller.Patch(last.Id, new PatchTaskItemDto
        {
            Status = Status.Completed,
            AutoCompleteParentWhenChildrenDone = true
        }));

        Assert.Equal(Status.Completed, await stack.StatusOfAsync(parent.Id));
    }

    [Fact]
    public async Task RealStack_BlockedParentWithAllChildrenCompleted_StatusChangeAccepted()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Blocked);
        await stack.SeedAsync("Done", Status.Completed, parent.Id);

        AssertOk(await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal(Status.Todo, await stack.StatusOfAsync(parent.Id));
    }

    [Fact]
    public async Task RealStack_ContradictoryStoredParent_NonStatusEditNotBlocked()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Completed);
        await stack.SeedAsync("Open", Status.Todo, parent.Id);

        AssertOk(await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Title = "Renamed" }));

        Assert.Equal(Status.Completed, await stack.StatusOfAsync(parent.Id));
    }

    [Fact]
    public async Task RealStack_RealPutResend_OnParentWithOpenChild_Succeeds()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.InProgress);
        await stack.SeedAsync("Open", Status.Todo, parent.Id);

        AssertOk(await stack.Controller.Update(parent.Id, new UpdateTaskItemDto
        {
            Title = "Renamed",
            Status = Status.InProgress,
            Priority = Priority.High
        }));
    }

    [Fact]
    public async Task RealStack_CompleteWithOpenChild_ReturnsCompleteBlockedByChildren_NotDerived()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Blocked);
        await stack.SeedAsync("Open", Status.Todo, parent.Id);

        var result = await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.Completed });

        Assert.Equal("TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", Code(result));
    }

    [Fact]
    public async Task RealStack_MovingChildBetweenParents_LocksAndUnlocksBoth()
    {
        using var stack = new RealStack();
        var a = await stack.SeedAsync("A", Status.Todo);
        var b = await stack.SeedAsync("B", Status.Todo);
        var child = await stack.SeedAsync("Child", Status.Todo, a.Id);

        // A is locked, B is free.
        Assert.Equal(DerivedCode, Code(await stack.Controller.Patch(a.Id, new PatchTaskItemDto { Status = Status.InProgress })));
        AssertOk(await stack.Controller.Patch(b.Id, new PatchTaskItemDto { Status = Status.InProgress }));

        // Move the child from A to B.
        AssertOk(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { ParentTaskItemId = b.Id }));

        // A is now free, B is locked.
        AssertOk(await stack.Controller.Patch(a.Id, new PatchTaskItemDto { Status = Status.InProgress }));
        Assert.Equal(DerivedCode, Code(await stack.Controller.Patch(b.Id, new PatchTaskItemDto { Status = Status.Todo })));
    }

    [Fact]
    public async Task RealStack_CompletingLastOpenChild_UnlocksParent()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Todo);
        var child = await stack.SeedAsync("Child", Status.Todo, parent.Id);

        Assert.Equal(DerivedCode, Code(await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.InProgress })));

        AssertOk(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { Status = Status.Completed }));

        AssertOk(await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.InProgress }));
    }

    [Fact]
    public async Task RealStack_DeletingLastOpenChild_UnlocksParent()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Todo);
        var child = await stack.SeedAsync("Child", Status.Todo, parent.Id);

        Assert.Equal(DerivedCode, Code(await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.InProgress })));

        Assert.IsType<NoContentResult>(await stack.Controller.Delete(child.Id));

        AssertOk(await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.InProgress }));
    }
}
