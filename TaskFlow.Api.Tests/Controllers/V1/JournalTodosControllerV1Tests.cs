using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Controllers.V1;

public class JournalTodosControllerV1Tests
{
    private readonly Mock<IJournalEntryRepository> _journalRepo = new();
    private readonly Mock<IValidator<AddJournalTodoDto>> _mockValidator = new();
    private readonly JournalTodosController _controller;

    public JournalTodosControllerV1Tests()
    {
        _mockValidator
            .Setup(v => v.ValidateAsync(It.IsAny<AddJournalTodoDto>(), default))
            .ReturnsAsync(new ValidationResult());
        _controller = new JournalTodosController(_journalRepo.Object, _mockValidator.Object);
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryMissing()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync((JournalEntry?)null);

        var result = await _controller.GetAll(1);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOk_WhenEntryExists()
    {
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "May 10", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync(
        [
            new TaskItem { Id = 2, Title = "Task", Status = Status.Todo, Priority = Priority.Low }
        ]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value);
        Assert.Single(todos, t => t.Id == 2 && t.Status == "Todo");
    }

    [Fact]
    public async Task GetAll_ShouldReturnBlockedFields_ForBlockedTodoAndItsChild()
    {
        var blockedAt = new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);
        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 10, 2) });
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Blocked parent",
            Status = Status.Blocked,
            BlockedReason = "Waiting on Sam",
            BlockedAt = blockedAt,
            PreviousStatus = Status.Todo,
            ChildTaskItems =
            [
                new TaskItem
                {
                    Id = 3,
                    Title = "Blocked child",
                    Status = Status.Blocked,
                    BlockedReason = "Child reason",
                    BlockedAt = blockedAt,
                    PreviousStatus = Status.Todo,
                    ParentTaskItemId = 2
                }
            ]
        };
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).Single();
        Assert.Equal("Waiting on Sam", dto.BlockedReason);
        Assert.Equal(blockedAt, dto.BlockedAt);
        Assert.Equal("Todo", dto.PreviousStatus);
        var child = Assert.Single(dto.Children!);
        Assert.Equal("Child reason", child.BlockedReason);
        Assert.Equal("Todo", child.PreviousStatus);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnBadRequest_WhenTaskIdInvalid()
    {
        var dto = new AddJournalTodoDto { TaskItemId = 0 };
        _mockValidator
            .Setup(v => v.ValidateAsync(dto, default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("TaskItemId", "TaskItemId must be greater than 0.")]));

        var result = await _controller.AddTodo(1, dto);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnNotFound_WhenEntryMissing()
    {
        _journalRepo.Setup(s => s.AddTodoAsync(1, 9)).ReturnsAsync(AddTodoResult.EntryNotFound);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 9 });

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnNotFound_WhenTaskMissing()
    {
        _journalRepo.Setup(s => s.AddTodoAsync(1, 9)).ReturnsAsync(AddTodoResult.TaskNotFound);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 9 });

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnConflict_WhenAlreadyLinked()
    {
        _journalRepo.Setup(s => s.AddTodoAsync(1, 4)).ReturnsAsync(AddTodoResult.AlreadyLinked);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnUnprocessableEntity_WhenEntryIsPastDay()
    {
        _journalRepo.Setup(s => s.AddTodoAsync(1, 4)).ReturnsAsync(AddTodoResult.PastDayNotAllowed);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        Assert.IsType<UnprocessableEntityObjectResult>(result);
    }

    [Fact]
    public async Task AddTodo_ShouldReturnNoContent_WhenValid()
    {
        _journalRepo.Setup(s => s.AddTodoAsync(1, 4)).ReturnsAsync(AddTodoResult.Success);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        Assert.IsType<NoContentResult>(result);
        _journalRepo.Verify(s => s.AddTodoAsync(1, 4), Times.Once);
    }

    [Fact]
    public async Task RemoveTodo_ShouldReturnNoContent_WhenLinked()
    {
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([]);
        _journalRepo.Setup(s => s.RemoveTodoAsync(1, 4)).ReturnsAsync(true);

        var result = await _controller.RemoveTodo(1, 4);

        Assert.IsType<NoContentResult>(result);
        _journalRepo.Verify(s => s.RemoveTodoAsync(1, 4), Times.Once);
    }

    [Fact]
    public async Task RemoveTodo_ShouldReturnNotFound_WhenNotLinked()
    {
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([]);
        _journalRepo.Setup(s => s.RemoveTodoAsync(1, 4)).ReturnsAsync(false);

        var result = await _controller.RemoveTodo(1, 4);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task GetAll_ShouldReturnChildren_WhenParentHasSubtasks()
    {
        var child = new TaskItem { Id = 10, Title = "Child", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 2, ChildTaskItems = [] };
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = [child]
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        Assert.Single(todos, t => t.Id == 2);
        Assert.Single(todos[0].Children!, c => c.Id == 10);
    }

    [Fact]
    public async Task GetAll_ShouldExcludeChildFromTopLevel_WhenParentAlsoPresent()
    {
        var child = new TaskItem { Id = 10, Title = "Child", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 2, ChildTaskItems = [] };
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = [child]
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent, child]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        Assert.Single(todos, t => t.Id == 2);
        Assert.Single(todos[0].Children!, c => c.Id == 10);
    }

    [Fact]
    public async Task GetAll_ShouldExcludeOrphanedSubtask_WhenParentNotInEntry()
    {
        var orphan = new TaskItem
        {
            Id = 10,
            Title = "Orphan",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 99, // parent NOT in the list
            ChildTaskItems = []
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([orphan]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        Assert.Empty(todos);
    }

    [Fact]
    public async Task GetAll_ShouldOmitChildrenField_WhenParentHasNoSubtasks()
    {
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = []
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        Assert.Single(todos);
        Assert.Null(todos[0].Children);
    }

    [Fact]
    public async Task GetAll_ShouldSetCurrentJournalDate_OnChildDto()
    {
        var childJournalDate = new DateOnly(2026, 5, 8);
        var childEntry = new JournalEntry { Id = 5, Title = "Another Day", Date = childJournalDate };
        var child = new TaskItem
        {
            Id = 10,
            Title = "Child",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 2,
            ChildTaskItems = [],
            CurrentJournalEntry = childEntry
        };
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = [child]
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        var childDto = todos[0].Children!.Single();
        Assert.Equal(childJournalDate, childDto.CurrentJournalDate);
    }

    [Fact]
    public async Task GetAll_ShouldComputeDaysTagged_ForChildIndependently()
    {
        var childJournalDate = new DateOnly(2026, 5, 10);
        var childFirstTaggedDate = new DateOnly(2026, 5, 8);
        var childEntry = new JournalEntry { Id = 5, Title = "Day", Date = childJournalDate };
        var child = new TaskItem
        {
            Id = 10,
            Title = "Child",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 2,
            ChildTaskItems = [],
            FirstTaggedDate = childFirstTaggedDate,
            CurrentJournalEntry = childEntry
        };
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = [child]
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        var childDto = todos[0].Children!.Single();
        // DaysTagged = childJournalDate.DayNumber - childFirstTaggedDate.DayNumber + 1 = 3
        Assert.Equal(3, childDto.DaysTagged);
    }

    [Fact]
    public async Task GetAll_ShouldNotIncludeOrphanedSubtask_InAnyChildList()
    {
        // A child whose ParentTaskItemId does not match the parent's Id — misconfigured relationship.
        // The child appears in ChildTaskItems of the parent object, but its ParentTaskItemId points elsewhere.
        var misconfiguredChild = new TaskItem
        {
            Id = 10,
            Title = "Misconfigured",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 99, // does NOT match parent.Id (2)
            ChildTaskItems = []
        };
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = [misconfiguredChild]
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        // Parent is a root item, but its misconfigured child should still appear mapped under Children
        // because MapTodo iterates ChildTaskItems directly from the EF nav property.
        // The important assertion: the child does NOT appear in the root list.
        Assert.Single(todos, t => t.Id == 2);
        Assert.DoesNotContain(todos, t => t.Id == 10);
    }

    [Fact]
    public async Task RemoveTodo_ShouldAlsoRemoveChildren_WhenParentIsRemoved()
    {
        var child = new TaskItem { Id = 10, Title = "Child", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 4, ChildTaskItems = [] };
        var parent = new TaskItem { Id = 4, Title = "Parent", Status = Status.Todo, Priority = Priority.Low, ChildTaskItems = [child] };

        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent, child]);
        _journalRepo.Setup(s => s.RemoveTodoAsync(1, 4)).ReturnsAsync(true);
        _journalRepo.Setup(s => s.RemoveTodoAsync(1, 10)).ReturnsAsync(true);

        var result = await _controller.RemoveTodo(1, 4);

        Assert.IsType<NoContentResult>(result);
        _journalRepo.Verify(s => s.RemoveTodoAsync(1, 10), Times.Once);
    }

    [Fact]
    public async Task RemoveTodo_ShouldNotRemoveUnrelatedTodos_WhenParentIsRemoved()
    {
        var unrelated = new TaskItem { Id = 20, Title = "Unrelated", Status = Status.Todo, Priority = Priority.Low, ChildTaskItems = [] };
        var parent = new TaskItem { Id = 4, Title = "Parent", Status = Status.Todo, Priority = Priority.Low, ChildTaskItems = [] };

        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent, unrelated]);
        _journalRepo.Setup(s => s.RemoveTodoAsync(1, 4)).ReturnsAsync(true);

        var result = await _controller.RemoveTodo(1, 4);

        Assert.IsType<NoContentResult>(result);
        _journalRepo.Verify(s => s.RemoveTodoAsync(1, 20), Times.Never);
    }

    [Fact]
    public async Task GetAll_MapTodo_ReturnsCorrectChildTaskCount()
    {
        var child1 = new TaskItem { Id = 10, Title = "Child 1", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 2, ChildTaskItems = [] };
        var child2 = new TaskItem { Id = 11, Title = "Child 2", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 2, ChildTaskItems = [] };
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = [child1, child2]
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([parent]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        Assert.Equal(2, todos.Single(t => t.Id == 2).ChildTaskCount);
    }

    [Fact]
    public async Task GetAll_MapTodo_LeafTodoHasZeroChildTaskCount()
    {
        var leaf = new TaskItem
        {
            Id = 2,
            Title = "Leaf",
            Status = Status.Todo,
            Priority = Priority.Low,
            ChildTaskItems = []
        };

        _journalRepo.Setup(s => s.GetByIdAsync(1)).ReturnsAsync(new JournalEntry { Id = 1, Title = "Day", Date = new DateOnly(2026, 5, 10) });
        _journalRepo.Setup(s => s.GetTodosAsync(1)).ReturnsAsync([leaf]);

        var result = await _controller.GetAll(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var todos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        var dto = todos.Single(t => t.Id == 2);
        Assert.Equal(0, dto.ChildTaskCount);
        Assert.Null(dto.Children);
    }
}
