using System.Text.Json;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

public class JournalTodosControllerV1Tests
{
    private static readonly DateOnly Day = new(2026, 5, 10);

    private readonly Mock<IJournalEntryRepository> _journalRepo = new();
    private readonly Mock<IValidator<AddJournalTodoDto>> _mockValidator = new();
    private readonly JournalTodosController _controller;

    public JournalTodosControllerV1Tests()
    {
        _mockValidator
            .Setup(v => v.ValidateAsync(It.IsAny<AddJournalTodoDto>(), default))
            .ReturnsAsync(new ValidationResult());
        _controller = new JournalTodosController(_journalRepo.Object, _mockValidator.Object, new JournalDayQueryDtoValidator());
    }

    private void SetupDay(DateOnly date, params TaskItem[] tasks) =>
        _journalRepo.Setup(s => s.GetTodosForDayAsync(1, It.IsAny<int?>())).ReturnsAsync(new JournalDayTodos(date, tasks));

    private async Task<List<TaskItemResponseDto>> GetRowsAsync(int? offset = null)
    {
        var result = await _controller.GetAll(1, new JournalDayQueryDto { TimezoneOffsetMinutes = offset });
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
    }

    [Fact]
    public async Task GetAll_ShouldReturnNotFound_WhenEntryMissing()
    {
        _journalRepo.Setup(s => s.GetTodosForDayAsync(1, It.IsAny<int?>())).ReturnsAsync((JournalDayTodos?)null);

        var result = await _controller.GetAll(1, new JournalDayQueryDto());

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOk_WhenEntryExists()
    {
        SetupDay(Day, new TaskItem { Id = 2, Title = "Task", Status = Status.Todo, Priority = Priority.Low });

        var todos = await GetRowsAsync();

        Assert.Single(todos, t => t.Id == 2 && t.Status == "Todo");
    }

    [Theory]
    [InlineData(null)]
    [InlineData(-300)]
    [InlineData(-720)]
    [InlineData(840)]
    public async Task GetAll_ShouldPassOffsetThroughToRepository(int? offset)
    {
        SetupDay(Day);

        await GetRowsAsync(offset);

        _journalRepo.Verify(s => s.GetTodosForDayAsync(1, offset), Times.Once);
    }

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    public async Task GetAll_ShouldReturnBadRequest_WhenOffsetOutOfRange(int offset)
    {
        var result = await _controller.GetAll(1, new JournalDayQueryDto { TimezoneOffsetMinutes = offset });

        TimezoneOffsetTestHelpers.AssertOffsetBadRequest(result.Result);
        _journalRepo.Verify(s => s.GetTodosForDayAsync(It.IsAny<int>(), It.IsAny<int?>()), Times.Never);
    }

    [Fact]
    public async Task GetAll_ShouldReturnBlockedFields_ForBlockedTodoAndItsChild()
    {
        var blockedAt = new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);
        SetupDay(new DateOnly(2026, 10, 2), new TaskItem
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
        });

        var dto = (await GetRowsAsync()).Single();

        Assert.Equal("Waiting on Sam", dto.BlockedReason);
        Assert.Equal(blockedAt, dto.BlockedAt);
        Assert.Equal("Todo", dto.PreviousStatus);
        var child = Assert.Single(dto.Children!);
        Assert.Equal("Child reason", child.BlockedReason);
        Assert.Equal("Todo", child.PreviousStatus);
    }

    [Fact]
    public async Task GetAll_ShouldMapDueDateAsCalendarDate_ForTodoAndItsChild()
    {
        SetupDay(new DateOnly(2026, 5, 1), new TaskItem
        {
            Id = 2,
            Title = "Parent",
            DueDate = new DateOnly(2026, 5, 1),
            ChildTaskItems = [new TaskItem { Id = 3, Title = "Child", ParentTaskItemId = 2 }]
        });

        var dto = (await GetRowsAsync()).Single();

        Assert.Equal(new DateOnly(2026, 5, 1), dto.DueDate);
        Assert.Null(dto.Children!.Single().DueDate);
    }

    [Fact]
    public async Task GetAll_ShouldReturnStartedAt_ForInProgressTodoAndItsChild()
    {
        var startedAt = new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);
        var childStartedAt = new DateTime(2026, 10, 2, 10, 0, 0, DateTimeKind.Utc);
        SetupDay(new DateOnly(2026, 10, 2), new TaskItem
        {
            Id = 2,
            Title = "Started parent",
            Status = Status.InProgress,
            StartedAt = startedAt,
            ChildTaskItems =
            [
                new TaskItem { Id = 3, Title = "Started child", Status = Status.InProgress, StartedAt = childStartedAt, ParentTaskItemId = 2 },
                new TaskItem { Id = 4, Title = "Plain child", Status = Status.Todo, ParentTaskItemId = 2 }
            ]
        });

        var dto = (await GetRowsAsync()).Single();

        Assert.Equal("InProgress", dto.Status);
        Assert.Equal(startedAt, dto.StartedAt);
        Assert.Equal(childStartedAt, dto.Children!.Single(c => c.Id == 3).StartedAt);
        Assert.Null(dto.Children!.Single(c => c.Id == 4).StartedAt);
    }

    [Fact]
    public async Task GetAll_ShouldReturnCompletedAt_ForCompletedTodoAndItsChild()
    {
        var completedAt = new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);
        var childCompletedAt = new DateTime(2026, 10, 2, 8, 0, 0, DateTimeKind.Utc);
        SetupDay(new DateOnly(2026, 10, 2), new TaskItem
        {
            Id = 2,
            Title = "Done parent",
            Status = Status.Completed,
            CompletedAt = completedAt,
            ChildTaskItems =
            [
                new TaskItem { Id = 3, Title = "Done child", Status = Status.Completed, CompletedAt = childCompletedAt, ParentTaskItemId = 2 },
                new TaskItem { Id = 4, Title = "Open child", Status = Status.Todo, ParentTaskItemId = 2 }
            ]
        });

        var dto = (await GetRowsAsync()).Single();

        Assert.Equal(completedAt, dto.CompletedAt);
        Assert.Equal(childCompletedAt, dto.Children!.Single(c => c.Id == 3).CompletedAt);
        Assert.Null(dto.Children!.Single(c => c.Id == 4).CompletedAt);
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
    public async Task AddTodo_ShouldReturnPlanCompletedUnprocessableEntity_WhenTaskIsCompleted()
    {
        var completedAt = new DateTime(2026, 5, 9, 15, 30, 0, DateTimeKind.Utc);
        _journalRepo.Setup(s => s.AddTodoAsync(1, 4)).ReturnsAsync(AddTodoResult.TaskCompleted);
        _journalRepo.Setup(s => s.GetPlanCompletedDetailsAsync(1, 4))
            .ReturnsAsync(new PlanCompletedDetails(new DateOnly(2026, 5, 8), completedAt, Day));

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result);
        using var body = JsonDocument.Parse(JsonSerializer.Serialize(unprocessable.Value));
        var root = body.RootElement;
        Assert.Equal("TASK_PLAN_COMPLETED_NOT_ALLOWED", root.GetProperty("code").GetString());
        Assert.Equal("Completed tasks cannot be planned onto a different day.", root.GetProperty("message").GetString());
        var details = root.GetProperty("details");
        Assert.Equal("2026-05-08", details.GetProperty("assignedDate").GetString());
        Assert.Equal(completedAt, details.GetProperty("completedAt").GetDateTime().ToUniversalTime());
        Assert.Equal("2026-05-10", details.GetProperty("journalDate").GetString());
    }

    [Fact]
    public async Task AddTodo_ShouldReturnPlanCompletedBodyWithNullDetails_WhenDetailsUnavailable()
    {
        _journalRepo.Setup(s => s.AddTodoAsync(1, 4)).ReturnsAsync(AddTodoResult.TaskCompleted);
        _journalRepo.Setup(s => s.GetPlanCompletedDetailsAsync(1, 4)).ReturnsAsync((PlanCompletedDetails?)null);

        var result = await _controller.AddTodo(1, new AddJournalTodoDto { TaskItemId = 4 });

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result);
        using var body = JsonDocument.Parse(JsonSerializer.Serialize(unprocessable.Value));
        Assert.Equal("TASK_PLAN_COMPLETED_NOT_ALLOWED", body.RootElement.GetProperty("code").GetString());
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("details").GetProperty("journalDate").ValueKind);
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
        SetupDay(Day, new TaskItem { Id = 2, Title = "Parent", ChildTaskItems = [child] });

        var todos = await GetRowsAsync();

        Assert.Single(todos, t => t.Id == 2);
        Assert.Single(todos[0].Children!, c => c.Id == 10);
        Assert.Null(todos[0].IsContextOnly);
    }

    [Fact]
    public async Task GetAll_ShouldExcludeChildFromTopLevel_WhenParentAlsoPresent()
    {
        var child = new TaskItem { Id = 10, Title = "Child", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 2, ChildTaskItems = [] };
        var parent = new TaskItem { Id = 2, Title = "Parent", ChildTaskItems = [child] };
        SetupDay(Day, parent, child);

        var todos = await GetRowsAsync();

        Assert.Single(todos, t => t.Id == 2);
        Assert.DoesNotContain(todos, t => t.Id == 10);
        Assert.Single(todos[0].Children!, c => c.Id == 10);
        Assert.Null(todos[0].IsContextOnly);
    }

    [Fact]
    public async Task GetAll_ShouldExcludeOrphanedSubtask_WhenParentNotLoaded()
    {
        // No ParentTaskItem to show as context: the orphan cannot be placed, so it is not returned.
        var orphan = new TaskItem { Id = 10, Title = "Orphan", ParentTaskItemId = 99, ChildTaskItems = [] };
        SetupDay(Day, orphan);

        Assert.Empty(await GetRowsAsync());
    }

    [Fact]
    public async Task GetAll_ShouldEmitParentAsContextOnly_WhenSubtaskIsTodoButParentIsNot()
    {
        var wed = new DateOnly(2026, 6, 3);
        var monEntry = new JournalEntry { Id = 5, Title = "Mon", Date = new DateOnly(2026, 6, 1) };
        var otherDaySibling = new TaskItem { Id = 11, Title = "Sibling", ParentTaskItemId = 2, Status = Status.Todo };
        var doneChild = new TaskItem
        {
            Id = 10,
            Title = "Done on Wed",
            ParentTaskItemId = 2,
            Status = Status.Completed,
            CompletedAt = new DateTime(2026, 6, 3, 10, 0, 0, DateTimeKind.Utc),
        };
        var parent = new TaskItem
        {
            Id = 2,
            Title = "Parent",
            Status = Status.Todo,
            CurrentJournalEntryId = 5,
            CurrentJournalEntry = monEntry,
            FirstTaggedDate = new DateOnly(2026, 5, 30),
            ChildTaskItems = [doneChild, otherDaySibling],
        };
        doneChild.ParentTaskItem = parent;
        SetupDay(wed, doneChild);

        var rows = await GetRowsAsync();

        var context = Assert.Single(rows);
        Assert.Equal(2, context.Id);
        Assert.True(context.IsContextOnly);
        Assert.Equal(new DateOnly(2026, 6, 1), context.CurrentJournalDate);
        Assert.Equal(3, context.DaysTagged);
        var child = Assert.Single(context.Children!);
        Assert.Equal(10, child.Id);
        Assert.Equal(1, context.ChildTaskCount);
        Assert.Null(child.IsContextOnly);
        Assert.NotNull(child.CompletedAt);
    }

    [Fact]
    public async Task GetAll_ShouldEmitOneContextParent_ForSeveralSubtasksOfTheSameParent()
    {
        var parent = new TaskItem { Id = 2, Title = "Parent" };
        var c1 = new TaskItem { Id = 10, Title = "C1", ParentTaskItemId = 2, ParentTaskItem = parent };
        var c2 = new TaskItem { Id = 11, Title = "C2", ParentTaskItemId = 2, ParentTaskItem = parent };
        SetupDay(Day, c2, c1);

        var rows = await GetRowsAsync();

        var context = Assert.Single(rows);
        Assert.True(context.IsContextOnly);
        Assert.Equal([10, 11], context.Children!.Select(c => c.Id));
    }

    [Fact]
    public async Task GetAll_ShouldReportOwnLinkedDay_AndNullForNeverLinkedCompletedTask()
    {
        var mon = new DateOnly(2026, 6, 1);
        var linkedThenDone = new TaskItem
        {
            Id = 2,
            Title = "Mon then done",
            Status = Status.Completed,
            CompletedAt = new DateTime(2026, 6, 3, 10, 0, 0, DateTimeKind.Utc),
            FirstTaggedDate = mon,
            CurrentJournalEntry = new JournalEntry { Id = 5, Title = "Mon", Date = mon },
        };
        var neverLinked = new TaskItem
        {
            Id = 3,
            Title = "Never linked",
            Status = Status.Completed,
            CompletedAt = new DateTime(2026, 6, 3, 11, 0, 0, DateTimeKind.Utc),
        };
        SetupDay(new DateOnly(2026, 6, 3), linkedThenDone, neverLinked);

        var rows = await GetRowsAsync();

        var first = rows.Single(r => r.Id == 2);
        Assert.Equal(mon, first.CurrentJournalDate);
        Assert.Equal(1, first.DaysTagged);
        var second = rows.Single(r => r.Id == 3);
        Assert.Null(second.CurrentJournalDate);
        Assert.Equal(0, second.DaysTagged);
        Assert.All(rows, r => Assert.NotNull(r.CompletedAt));
    }

    [Fact]
    public async Task GetAll_ShouldOmitChildrenField_WhenParentHasNoSubtasks()
    {
        SetupDay(Day, new TaskItem { Id = 2, Title = "Parent", ChildTaskItems = [] });

        var todos = await GetRowsAsync();

        Assert.Single(todos);
        Assert.Null(todos[0].Children);
    }

    [Fact]
    public async Task GetAll_ShouldSetCurrentJournalDate_OnChildDto()
    {
        var childJournalDate = new DateOnly(2026, 5, 8);
        var child = new TaskItem
        {
            Id = 10,
            Title = "Child",
            ParentTaskItemId = 2,
            ChildTaskItems = [],
            CurrentJournalEntry = new JournalEntry { Id = 5, Title = "Another Day", Date = childJournalDate }
        };
        SetupDay(Day, new TaskItem { Id = 2, Title = "Parent", ChildTaskItems = [child] });

        var todos = await GetRowsAsync();

        Assert.Equal(childJournalDate, todos[0].Children!.Single().CurrentJournalDate);
    }

    [Fact]
    public async Task GetAll_ShouldComputeDaysTagged_ForChildIndependently()
    {
        var child = new TaskItem
        {
            Id = 10,
            Title = "Child",
            ParentTaskItemId = 2,
            ChildTaskItems = [],
            FirstTaggedDate = new DateOnly(2026, 5, 8),
            CurrentJournalEntry = new JournalEntry { Id = 5, Title = "Day", Date = new DateOnly(2026, 5, 10) }
        };
        SetupDay(Day, new TaskItem { Id = 2, Title = "Parent", ChildTaskItems = [child] });

        var todos = await GetRowsAsync();

        // DaysTagged = childJournalDate.DayNumber - childFirstTaggedDate.DayNumber + 1 = 3
        Assert.Equal(3, todos[0].Children!.Single().DaysTagged);
    }

    [Fact]
    public async Task GetAll_ShouldNotIncludeOrphanedSubtask_InAnyChildList()
    {
        // A child whose ParentTaskItemId does not match the parent's Id - misconfigured relationship.
        var misconfiguredChild = new TaskItem { Id = 10, Title = "Misconfigured", ParentTaskItemId = 99, ChildTaskItems = [] };
        SetupDay(Day, new TaskItem { Id = 2, Title = "Parent", ChildTaskItems = [misconfiguredChild] });

        var todos = await GetRowsAsync();

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
        var child1 = new TaskItem { Id = 10, Title = "Child 1", ParentTaskItemId = 2, ChildTaskItems = [] };
        var child2 = new TaskItem { Id = 11, Title = "Child 2", ParentTaskItemId = 2, ChildTaskItems = [] };
        SetupDay(Day, new TaskItem { Id = 2, Title = "Parent", ChildTaskItems = [child1, child2] });

        var todos = await GetRowsAsync();

        Assert.Equal(2, todos.Single(t => t.Id == 2).ChildTaskCount);
    }

    [Fact]
    public async Task GetAll_MapTodo_LeafTodoHasZeroChildTaskCount()
    {
        SetupDay(Day, new TaskItem { Id = 2, Title = "Leaf", ChildTaskItems = [] });

        var dto = (await GetRowsAsync()).Single(t => t.Id == 2);

        Assert.Equal(0, dto.ChildTaskCount);
        Assert.Null(dto.Children);
    }

    [Fact]
    public void IsContextOnly_ShouldBeOmittedFromJson_WhenNull()
    {
        var json = JsonSerializer.Serialize(new TaskItemResponseDto { Title = "t" });

        Assert.DoesNotContain("IsContextOnly", json);
        Assert.Contains("\"IsContextOnly\":true", JsonSerializer.Serialize(new TaskItemResponseDto { Title = "t", IsContextOnly = true }));
    }
}
