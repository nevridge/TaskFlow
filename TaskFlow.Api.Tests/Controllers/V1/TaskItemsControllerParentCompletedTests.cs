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
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Tests for the TASK_PARENT_COMPLETED_NOT_ALLOWED guard (issue #368): a task whose resulting status is not
/// Completed cannot be attached to a Completed parent through POST, PUT or PATCH.
/// </summary>
public class TaskItemsControllerParentCompletedTests
{
    private const string CompletedCode = "TASK_PARENT_COMPLETED_NOT_ALLOWED";
    private const int ParentId = 1;
    private const int ChildId = 5;

    private readonly Mock<ITaskRepository> _repo = new();
    private readonly Mock<FluentValidation.IValidator<TaskItem>> _validator = new();
    private readonly Mock<FluentValidation.IValidator<UpdateTaskItemDto>> _updateValidator = new();
    private readonly Mock<FluentValidation.IValidator<PatchTaskItemDto>> _patchValidator = new();
    private readonly Mock<FluentValidation.IValidator<CreateTaskItemDto>> _createValidator = new();
    private readonly TaskItemsController _controller;

    public TaskItemsControllerParentCompletedTests()
    {
        _repo.Setup(r => r.GetAssignedJournalDateAsync(It.IsAny<int>())).ReturnsAsync((DateOnly?)null);
        _repo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);
        _repo.Setup(r => r.GetChildrenAsync(It.IsAny<int>())).ReturnsAsync([]);
        _repo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync((TaskItem t) =>
        {
            t.Id = 20;
            return t;
        });
        _repo.Setup(r => r.GetByIdNoTrackingAsync(20)).ReturnsAsync(() => new TaskItem
        {
            Id = 20,
            Title = "Created",
            Status = Status.Draft,
            ParentTaskItemId = ParentId
        });
        _validator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _updateValidator.Setup(v => v.ValidateAsync(It.IsAny<UpdateTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _patchValidator.Setup(v => v.ValidateAsync(It.IsAny<PatchTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _createValidator.Setup(v => v.ValidateAsync(It.IsAny<CreateTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _controller = new TaskItemsController(
            _repo.Object,
            _validator.Object,
            new Mock<IJournalEntryRepository>().Object,
            new Mock<IProjectRepository>().Object,
            _createValidator.Object,
            _updateValidator.Object,
            _patchValidator.Object);
    }

    private TaskItem SetupParent(Status status, int? grandParentId = null)
    {
        var parent = new TaskItem
        {
            Id = ParentId,
            Title = "Parent",
            Status = status,
            ParentTaskItemId = grandParentId,
            CompletedAt = status == Status.Completed ? DateTime.UtcNow : null
        };
        _repo.Setup(r => r.GetByIdNoTrackingAsync(ParentId)).ReturnsAsync(parent);
        return parent;
    }

    private TaskItem SetupChild(Status status, int? parentId = null)
    {
        var child = new TaskItem
        {
            Id = ChildId,
            Title = "Child",
            Status = status,
            ParentTaskItemId = parentId,
            CompletedAt = status == Status.Completed ? DateTime.UtcNow : null
        };
        _repo.Setup(r => r.GetByIdAsync(ChildId)).ReturnsAsync(child);
        return child;
    }

    private static string Code(ActionResult<TaskItemResponseDto> result)
    {
        var value = Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;
        return (string)value.GetType().GetProperty("code")!.GetValue(value)!;
    }

    private static string Message(ActionResult<TaskItemResponseDto> result)
    {
        var value = Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;
        return (string)value.GetType().GetProperty("message")!.GetValue(value)!;
    }

    private static void AssertOk(ActionResult<TaskItemResponseDto> result) => Assert.IsType<OkObjectResult>(result.Result);

    // ---- Create ----

    [Fact]
    public async Task Create_DefaultDraftChild_UnderCompletedParent_ReturnsParentCompleted()
    {
        SetupParent(Status.Completed);

        var result = await _controller.Create(new CreateTaskItemDto { Title = "Sub", ParentTaskItemId = ParentId });

        Assert.Equal(CompletedCode, Code(result));
        Assert.Equal("A completed task can't have open subtasks. Reopen the parent or complete this task first.", Message(result));
        _repo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Theory]
    [InlineData(Status.Todo)]
    [InlineData(Status.InProgress)]
    public async Task Create_OpenChild_UnderCompletedParent_ReturnsParentCompleted(Status status)
    {
        SetupParent(Status.Completed);

        var result = await _controller.Create(new CreateTaskItemDto { Title = "Sub", Status = status, ParentTaskItemId = ParentId });

        Assert.Equal(CompletedCode, Code(result));
        _repo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_CompletedChild_UnderCompletedParent_Succeeds()
    {
        SetupParent(Status.Completed);

        var result = await _controller.Create(new CreateTaskItemDto
        {
            Title = "Sub",
            Status = Status.Completed,
            ParentTaskItemId = ParentId
        });

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        _repo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Create_OpenChild_UnderOpenParent_Succeeds()
    {
        SetupParent(Status.Todo);

        var result = await _controller.Create(new CreateTaskItemDto { Title = "Sub", ParentTaskItemId = ParentId });

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        _repo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Once);
        _repo.Verify(r => r.GetChildrenAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Create_ParentNotFound_ReturnsParentNotFound_NotParentCompleted()
    {
        _repo.Setup(r => r.GetByIdNoTrackingAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Create(new CreateTaskItemDto { Title = "Sub", ParentTaskItemId = 99 });

        Assert.Equal("TASK_PARENT_NOT_FOUND", Code(result));
    }

    [Fact]
    public async Task Create_CompletedParentThatIsItselfAChild_ReturnsDepth_NotParentCompleted()
    {
        SetupParent(Status.Completed, grandParentId: 50);

        var result = await _controller.Create(new CreateTaskItemDto { Title = "Sub", ParentTaskItemId = ParentId });

        Assert.Equal("TASK_PARENT_DEPTH_NOT_ALLOWED", Code(result));
    }

    // ---- PUT ----

    [Fact]
    public async Task Update_OpenTaskToCompletedParent_ReturnsParentCompleted()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Todo);

        var result = await _controller.Update(ChildId, new UpdateTaskItemDto
        {
            Title = "Child",
            Status = Status.Todo,
            ParentTaskItemId = ParentId
        });

        Assert.Equal(CompletedCode, Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_NoStatusSent_OpenTaskToCompletedParent_ReturnsParentCompleted()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Draft);

        var result = await _controller.Update(ChildId, new UpdateTaskItemDto { Title = "Child", ParentTaskItemId = ParentId });

        Assert.Equal(CompletedCode, Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ResendSameParent_OnOpenChildUnderCompletedParent_Succeeds()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Todo, ParentId);

        AssertOk(await _controller.Update(ChildId, new UpdateTaskItemDto
        {
            Title = "Renamed",
            Status = Status.Todo,
            ParentTaskItemId = ParentId
        }));

        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Update_OpenTaskToOpenParent_Succeeds()
    {
        SetupParent(Status.Todo);
        SetupChild(Status.Todo);

        AssertOk(await _controller.Update(ChildId, new UpdateTaskItemDto
        {
            Title = "Child",
            Status = Status.Todo,
            ParentTaskItemId = ParentId
        }));
    }

    [Fact]
    public async Task Update_NoParentSent_OnOpenTask_Succeeds()
    {
        SetupChild(Status.Todo);

        AssertOk(await _controller.Update(ChildId, new UpdateTaskItemDto { Title = "Renamed", Status = Status.Todo }));
        _repo.Verify(r => r.GetByIdNoTrackingAsync(ParentId), Times.Never);
    }

    // ---- PATCH ----

    [Fact]
    public async Task Patch_OpenTaskToCompletedParent_ReturnsParentCompleted()
    {
        SetupParent(Status.Completed);
        var child = SetupChild(Status.Todo);

        var result = await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = ParentId });

        Assert.Equal(CompletedCode, Code(result));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        Assert.Null(child.ParentTaskItemId);
    }

    [Fact]
    public async Task Patch_OpenTaskToCompletedParent_LoadsChildrenAtMostOnce()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Todo);

        var result = await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = ParentId });

        Assert.Equal(CompletedCode, Code(result));
        _repo.Verify(r => r.GetChildrenAsync(It.IsAny<int>()), Times.AtMostOnce);
    }

    [Fact]
    public async Task Patch_ParentAndCompletedStatus_ToCompletedParent_Succeeds()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Todo);

        AssertOk(await _controller.Patch(ChildId, new PatchTaskItemDto
        {
            ParentTaskItemId = ParentId,
            Status = Status.Completed
        }));

        _repo.Verify(r => r.UpdateAsync(It.Is<TaskItem>(t => t.ParentTaskItemId == ParentId && t.Status == Status.Completed)), Times.Once);
    }

    [Fact]
    public async Task Patch_AlreadyCompletedTask_ToCompletedParent_Succeeds()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Completed);

        AssertOk(await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = ParentId }));
    }

    [Fact]
    public async Task Patch_ReopenCompletedChild_UnderCompletedParent_IsNotBlockedByThisRule()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Completed, ParentId);

        AssertOk(await _controller.Patch(ChildId, new PatchTaskItemDto { Status = Status.Todo }));
    }

    [Fact]
    public async Task Patch_SameParentResend_OnOpenChildUnderCompletedParent_Succeeds()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Todo, ParentId);

        AssertOk(await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = ParentId, Title = "Renamed" }));
    }

    [Fact]
    public async Task Patch_DetachingParent_Succeeds()
    {
        SetupChild(Status.Todo, ParentId);

        AssertOk(await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = null }));
    }

    [Fact]
    public async Task Patch_ParentNotFound_ReturnsParentNotFound_NotParentCompleted()
    {
        SetupChild(Status.Todo);
        _repo.Setup(r => r.GetByIdNoTrackingAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = 99 });

        Assert.Equal("TASK_PARENT_NOT_FOUND", Code(result));
    }

    [Fact]
    public async Task Patch_SelfParent_ReturnsSelfNotAllowed()
    {
        SetupChild(Status.Todo);

        var result = await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = ChildId });

        Assert.Equal("TASK_PARENT_SELF_NOT_ALLOWED", Code(result));
    }

    [Fact]
    public async Task Patch_CompletedParentThatIsItselfAChild_ReturnsDepth_NotParentCompleted()
    {
        SetupParent(Status.Completed, grandParentId: 50);
        SetupChild(Status.Todo);

        var result = await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = ParentId });

        Assert.Equal("TASK_PARENT_DEPTH_NOT_ALLOWED", Code(result));
    }

    [Fact]
    public async Task Patch_TaskWithChildren_ToCompletedParent_ReturnsDepth_NotParentCompleted()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Todo);
        _repo.Setup(r => r.GetChildrenAsync(ChildId)).ReturnsAsync(
            [new TaskItem { Id = 30, Title = "Grandchild", Status = Status.Todo, ParentTaskItemId = ChildId }]);

        var result = await _controller.Patch(ChildId, new PatchTaskItemDto { ParentTaskItemId = ParentId });

        Assert.Equal("TASK_PARENT_DEPTH_NOT_ALLOWED", Code(result));
    }

    [Fact]
    public async Task Patch_DraftToInProgress_UnderCompletedParent_ReturnsStartNotAllowed_NotParentCompleted()
    {
        SetupParent(Status.Completed);
        SetupChild(Status.Draft);

        var result = await _controller.Patch(ChildId, new PatchTaskItemDto
        {
            ParentTaskItemId = ParentId,
            Status = Status.InProgress
        });

        Assert.Equal("TASK_START_NOT_ALLOWED", Code(result));
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
                CompletedAt = status == Status.Completed ? DateTime.UtcNow : null
            };
            Context.TaskItems.Add(item);
            await Context.SaveChangesAsync();
            Context.ChangeTracker.Clear();
            return item;
        }

        public async Task<TaskItem> LoadAsync(int id)
        {
            Context.ChangeTracker.Clear();
            return await Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        public async Task<int> CountAsync()
        {
            Context.ChangeTracker.Clear();
            return await Context.TaskItems.CountAsync();
        }

        public void Dispose()
        {
            Context.Dispose();
            _connection.Dispose();
        }
    }

    [Fact]
    public async Task RealStack_Create_DraftChildUnderCompletedParent_Returns422WithCodeAndMessage_AndSavesNothing()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Completed);

        var result = await stack.Controller.Create(new CreateTaskItemDto { Title = "Sub", ParentTaskItemId = parent.Id });

        var body = Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(body));
        var props = json.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray();
        Assert.Equal(["code", "message"], props);
        Assert.Equal(CompletedCode, json.RootElement.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(json.RootElement.GetProperty("message").GetString()));
        Assert.Equal(1, await stack.CountAsync());
    }

    [Fact]
    public async Task RealStack_Create_CompletedChildUnderCompletedParent_IsStored()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Completed);

        var result = await stack.Controller.Create(new CreateTaskItemDto
        {
            Title = "Sub",
            Status = Status.Completed,
            ParentTaskItemId = parent.Id
        });

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        Assert.Equal(2, await stack.CountAsync());
    }

    [Fact]
    public async Task RealStack_Patch_OpenTaskToCompletedParent_LeavesTaskUnchanged()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Completed);
        var child = await stack.SeedAsync("C", Status.Todo);

        var result = await stack.Controller.Patch(child.Id, new PatchTaskItemDto { ParentTaskItemId = parent.Id });

        Assert.Equal(CompletedCode, Code(result));
        var stored = await stack.LoadAsync(child.Id);
        Assert.Null(stored.ParentTaskItemId);
        Assert.Equal(Status.Todo, stored.Status);
    }

    [Fact]
    public async Task RealStack_Put_OpenTaskToCompletedParent_LeavesTaskUnchanged()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Completed);
        var child = await stack.SeedAsync("C", Status.Todo);

        var result = await stack.Controller.Update(child.Id, new UpdateTaskItemDto
        {
            Title = "Renamed",
            Status = Status.Todo,
            ParentTaskItemId = parent.Id
        });

        Assert.Equal(CompletedCode, Code(result));
        var stored = await stack.LoadAsync(child.Id);
        Assert.Null(stored.ParentTaskItemId);
        Assert.Equal("C", stored.Title);
    }

    [Fact]
    public async Task RealStack_Patch_ParentAndCompleted_ToCompletedParent_IsStored()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Completed);
        var child = await stack.SeedAsync("C", Status.Todo);

        AssertOk(await stack.Controller.Patch(child.Id, new PatchTaskItemDto
        {
            ParentTaskItemId = parent.Id,
            Status = Status.Completed
        }));

        var stored = await stack.LoadAsync(child.Id);
        Assert.Equal(parent.Id, stored.ParentTaskItemId);
        Assert.Equal(Status.Completed, stored.Status);
    }

    [Fact]
    public async Task RealStack_Put_SameParentResend_OnOpenChildUnderCompletedParent_IsStored()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync("P", Status.Completed);
        var child = await stack.SeedAsync("C", Status.Todo, parent.Id);

        AssertOk(await stack.Controller.Update(child.Id, new UpdateTaskItemDto
        {
            Title = "Renamed",
            Status = Status.Todo,
            ParentTaskItemId = parent.Id
        }));

        var stored = await stack.LoadAsync(child.Id);
        Assert.Equal("Renamed", stored.Title);
        Assert.Equal(parent.Id, stored.ParentTaskItemId);
    }
}
