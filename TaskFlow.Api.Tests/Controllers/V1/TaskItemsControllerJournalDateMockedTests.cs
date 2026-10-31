using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Api.Validators;

namespace TaskFlow.Api.Tests.Controllers.V1;

/// <summary>
/// Mocked-repository tests for the optional <c>journalDate</c> on PUT/PATCH <c>/api/v1/TaskItems/{id}</c>
/// (issue #352): ordering, transaction use and error mapping.
/// </summary>
public class TaskItemsControllerJournalDateMockedTests
{
    private const string PastDayCode = "TASK_CREATION_PAST_DAY_NOT_ALLOWED";
    private const string ConflictCode = "TASK_JOURNAL_ASSIGNMENT_CONFLICT";

    private readonly Mock<ITaskRepository> _repo = new();
    private readonly Mock<IValidator<TaskItem>> _validator = new();
    private readonly Mock<IJournalEntryRepository> _journalRepo = new();
    private readonly Mock<IProjectRepository> _projectRepo = new();
    private readonly Mock<IRepositoryTransaction> _tx = new();
    private readonly List<string> _calls = [];
    private readonly TaskItemsController _controller;

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    public TaskItemsControllerJournalDateMockedTests()
    {
        _repo.Setup(r => r.GetAssignedJournalDateAsync(It.IsAny<int>())).ReturnsAsync((DateOnly?)null);
        _repo.Setup(r => r.GetHistoryAsync(It.IsAny<int>())).ReturnsAsync([]);
        _repo.Setup(r => r.GetChildrenAsync(It.IsAny<int>())).ReturnsAsync([]);
        _repo.Setup(r => r.BeginTransactionAsync())
            .Callback(() => _calls.Add("begin"))
            .ReturnsAsync(_tx.Object);
        _repo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>()))
            .Callback(() => _calls.Add("update"))
            .Returns(Task.CompletedTask);
        _tx.Setup(t => t.CommitAsync(It.IsAny<CancellationToken>()))
            .Callback(() => _calls.Add("commit"))
            .Returns(Task.CompletedTask);
        _validator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _journalRepo.Setup(j => j.GetByDateAsync(It.IsAny<DateOnly>()))
            .ReturnsAsync((DateOnly d) => new JournalEntry { Id = 77, Title = "J", Date = d });

        var passDto = new Mock<IValidator<UpdateTaskItemDto>>();
        passDto.Setup(v => v.ValidateAsync(It.IsAny<UpdateTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        var passPatch = new Mock<IValidator<PatchTaskItemDto>>();
        passPatch.Setup(v => v.ValidateAsync(It.IsAny<PatchTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _controller = new TaskItemsController(
            _repo.Object, _validator.Object, _journalRepo.Object, _projectRepo.Object,
            new Mock<IValidator<CreateTaskItemDto>>().Object, passDto.Object, passPatch.Object);
    }

    private TaskItem Seed(Status status = Status.Todo)
    {
        var task = new TaskItem { Id = 1, Title = "Task", Status = status, Priority = Priority.Low };
        _repo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        return task;
    }

    private void SetupAddTodo(AddTodoResult result) =>
        _journalRepo.Setup(j => j.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<int?>()))
            .Callback(() => _calls.Add("addTodo"))
            .ReturnsAsync(result);

    private static UpdateTaskItemDto Put(DateOnly? journalDate, int? offset = null, Status? status = null) =>
        new() { Title = "Task", Status = status, JournalDate = journalDate, TimezoneOffsetMinutes = offset };

    private static string Code(ActionResult? result)
    {
        var value = result switch
        {
            UnprocessableEntityObjectResult u => u.Value!,
            ConflictObjectResult c => c.Value!,
            _ => throw new Xunit.Sdk.XunitException($"Unexpected result {result?.GetType().Name}")
        };
        return (string)value.GetType().GetProperty("code")!.GetValue(value)!;
    }

    private void AssertNoJournalOrTx()
    {
        _repo.Verify(r => r.BeginTransactionAsync(), Times.Never);
        _journalRepo.Verify(j => j.GetByDateAsync(It.IsAny<DateOnly>()), Times.Never);
        _journalRepo.Verify(j => j.AddAsync(It.IsAny<JournalEntry>()), Times.Never);
        _journalRepo.Verify(j => j.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<int?>()), Times.Never);
    }

    [Fact]
    public async Task Update_FutureJournalDate_UpdatesThenLinksInsideTransactionAndCommits()
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);
        var future = Today.AddDays(3);

        var result = await _controller.Update(1, Put(future, offset: 60));

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(["begin", "update", "addTodo", "commit"], _calls);
        _journalRepo.Verify(j => j.AddTodoAsync(77, 1, 60), Times.Once);
    }

    [Fact]
    public async Task Update_FutureJournalDate_ReturnsResponseReReadFromStorage()
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);
        var future = Today.AddDays(1);
        _repo.Setup(r => r.GetByIdNoTrackingAsync(1)).ReturnsAsync(
            new TaskItem { Id = 1, Title = "FromStorage", Status = Status.Todo, MoveCount = 4 });
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(future);

        var result = await _controller.Update(1, Put(future));

        var dto = Assert.IsType<TaskItemResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("FromStorage", dto.Title);
        Assert.Equal(4, dto.MoveCount);
        Assert.Equal(future, dto.CurrentJournalDate);
    }

    [Fact]
    public async Task Update_MissingEntry_CreatesEntryAndLinks()
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);
        var future = Today.AddDays(2);
        _journalRepo.Setup(j => j.GetByDateAsync(future)).ReturnsAsync((JournalEntry?)null);
        _journalRepo.Setup(j => j.AddAsync(It.IsAny<JournalEntry>()))
            .ReturnsAsync((JournalEntry e) => { e.Id = 90; return e; });

        var result = await _controller.Update(1, Put(future));

        Assert.IsType<OkObjectResult>(result.Result);
        _journalRepo.Verify(j => j.AddAsync(It.Is<JournalEntry>(e => e.Date == future)), Times.Once);
        _journalRepo.Verify(j => j.AddTodoAsync(90, 1, null), Times.Once);
        _tx.Verify(t => t.CommitAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_NullJournalDate_DoesNotTouchJournalOrOpenTransaction()
    {
        Seed();

        var result = await _controller.Update(1, Put(null));

        Assert.IsType<OkObjectResult>(result.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Patch_NullAndAbsentJournalDate_DoNotTouchJournal()
    {
        Seed();

        await _controller.Patch(1, new PatchTaskItemDto { Title = "A" });
        await _controller.Patch(1, new PatchTaskItemDto { Title = "B", JournalDate = null });

        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Exactly(2));
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Patch_FutureJournalDate_LinksInsideTransaction()
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);

        var result = await _controller.Patch(1, new PatchTaskItemDto { Title = "A", JournalDate = Today.AddDays(1) });

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(["begin", "update", "addTodo", "commit"], _calls);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public async Task Update_SameDateAsCurrent_SkipsPlanningAndSucceeds_EvenForPastDate(int daysFromToday)
    {
        Seed();
        var date = Today.AddDays(daysFromToday);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(date);

        var result = await _controller.Update(1, Put(date));

        Assert.IsType<OkObjectResult>(result.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Update_DifferentValidDate_CallsAddTodoWithOffset()
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(Today.AddDays(1));

        await _controller.Update(1, Put(Today.AddDays(4), offset: -120));

        _journalRepo.Verify(j => j.AddTodoAsync(77, 1, -120), Times.Once);
    }

    [Fact]
    public async Task Update_PastJournalDate_Returns422AndSavesNothing()
    {
        Seed();

        var result = await _controller.Update(1, Put(Today.AddDays(-1)));

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Equal(PastDayCode, Code(unprocessable));
        var value = unprocessable.Value!;
        Assert.Equal("You cannot plan a task on a past journal day.", value.GetType().GetProperty("message")!.GetValue(value));
        Assert.NotNull(value.GetType().GetProperty("details")!.GetValue(value));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Update_PastJournalDateWithInvalidEntity_Returns400Not422()
    {
        Seed();
        _validator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult([new ValidationFailure("Title", "bad")]));

        var result = await _controller.Update(1, Put(Today.AddDays(-3)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Theory]
    [InlineData(840)]
    [InlineData(0)]
    [InlineData(-720)]
    public async Task Update_TodayDerivedFromOffset_AcceptsUserTodayAndRejectsDayBefore(int offset)
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);
        var userToday = UserDateHelper.GetUserToday(DateTime.UtcNow, offset);

        var accepted = await _controller.Update(1, Put(userToday, offset));
        var rejected = await _controller.Update(1, Put(userToday.AddDays(-1), offset));

        Assert.IsType<OkObjectResult>(accepted.Result);
        Assert.Equal(PastDayCode, Code(rejected.Result as ActionResult));
    }

    [Fact]
    public async Task Update_NoOffset_UsesUtcToday()
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);

        var accepted = await _controller.Update(1, Put(Today));
        var rejected = await _controller.Update(1, Put(Today.AddDays(-1)));

        Assert.IsType<OkObjectResult>(accepted.Result);
        Assert.Equal(PastDayCode, Code(rejected.Result as ActionResult));
    }

    [Theory]
    [InlineData(AddTodoResult.AlreadyLinked, 409)]
    [InlineData(AddTodoResult.PastDayNotAllowed, 422)]
    [InlineData(AddTodoResult.TaskNotFound, 404)]
    [InlineData(AddTodoResult.TaskCompleted, 422)]
    public async Task Update_AddTodoFailure_MapsErrorAndDoesNotCommit(AddTodoResult failure, int status)
    {
        Seed();
        SetupAddTodo(failure);

        var result = await _controller.Update(1, Put(Today.AddDays(1)));

        var objectResult = Assert.IsAssignableFrom<IStatusCodeActionResult>(result.Result);
        Assert.Equal(status, objectResult.StatusCode);
        if (failure == AddTodoResult.AlreadyLinked)
        {
            var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
            Assert.Equal(ConflictCode, Code(conflict));
            var value = conflict.Value!;
            Assert.Equal("The task was planned on this day by another request.", value.GetType().GetProperty("message")!.GetValue(value));
        }
        else if (failure == AddTodoResult.PastDayNotAllowed)
        {
            Assert.Equal(PastDayCode, Code(result.Result as ActionResult));
        }

        _tx.Verify(t => t.CommitAsync(It.IsAny<CancellationToken>()), Times.Never);
        _tx.Verify(t => t.DisposeAsync(), Times.Once);
    }

    [Fact]
    public async Task Update_AddTodoEntryNotFound_ThrowsAndDoesNotCommit()
    {
        Seed();
        SetupAddTodo(AddTodoResult.EntryNotFound);

        await Assert.ThrowsAsync<InvalidOperationException>(() => _controller.Update(1, Put(Today.AddDays(1))));

        _tx.Verify(t => t.CommitAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Update_NonexistentTask_Returns404WithoutJournalCalls()
    {
        _repo.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Update(99, Put(Today.AddDays(1)));

        Assert.IsType<NotFoundResult>(result.Result);
        _repo.Verify(r => r.GetAssignedJournalDateAsync(It.IsAny<int>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Theory]
    [InlineData(841)]
    [InlineData(-721)]
    public async Task Update_OffsetOutOfRangeWithJournalDate_Returns400AndChangesNothing(int offset)
    {
        Seed();
        var controller = new TaskItemsController(
            _repo.Object, _validator.Object, _journalRepo.Object, _projectRepo.Object,
            new CreateTaskItemDtoValidator(), new UpdateTaskItemDtoValidator(), new PatchTaskItemDtoValidator());

        var put = await controller.Update(1, Put(Today.AddDays(1), offset));
        var patch = await controller.Patch(1, new PatchTaskItemDto { JournalDate = Today.AddDays(1), TimezoneOffsetMinutes = offset });

        TimezoneOffsetTestHelpers.AssertOffsetBadRequest(put.Result);
        TimezoneOffsetTestHelpers.AssertOffsetBadRequest(patch.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Update_GuardErrors_StayUnchangedAndSkipJournal()
    {
        // Parent self.
        Seed();
        var self = await _controller.Update(1, new UpdateTaskItemDto { Title = "T", ParentTaskItemId = 1, JournalDate = Today.AddDays(1) });
        Assert.Equal("TASK_PARENT_SELF_NOT_ALLOWED", Code(self.Result as ActionResult));

        // Parent depth (proposed parent is itself a child).
        _repo.Setup(r => r.GetByIdNoTrackingAsync(5)).ReturnsAsync(new TaskItem { Id = 5, Title = "P", ParentTaskItemId = 9 });
        var depth = await _controller.Update(1, new UpdateTaskItemDto { Title = "T", ParentTaskItemId = 5, JournalDate = Today.AddDays(1) });
        Assert.Equal("TASK_PARENT_DEPTH_NOT_ALLOWED", Code(depth.Result as ActionResult));

        // Blocking a Draft.
        Seed(Status.Draft);
        var blocked = await _controller.Update(1, Put(Today.AddDays(1), status: Status.Blocked));
        Assert.Equal("TASK_BLOCK_DRAFT_NOT_ALLOWED", Code(blocked.Result as ActionResult));

        // Start guard.
        var start = await _controller.Update(1, Put(Today.AddDays(1), status: Status.InProgress));
        Assert.Equal("TASK_START_NOT_ALLOWED", Code(start.Result as ActionResult));

        // Parent completion guard.
        Seed();
        _repo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([new TaskItem { Id = 2, Title = "c", Status = Status.Todo }]);
        var complete = await _controller.Update(1, Put(Today.AddDays(1), status: Status.Completed));
        Assert.Equal("TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", Code(complete.Result as ActionResult));

        // Reopen guard.
        Seed(Status.Completed);
        _repo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([]);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(Today.AddDays(-2));
        var reopen = await _controller.Update(1, Put(Today.AddDays(1), status: Status.Todo));
        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", Code(reopen.Result as ActionResult));

        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Update_DuplicateDateRace_RefetchesExistingEntryAndLinks()
    {
        Seed();
        SetupAddTodo(AddTodoResult.Success);
        var future = Today.AddDays(2);
        _journalRepo.SetupSequence(j => j.GetByDateAsync(future))
            .ReturnsAsync((JournalEntry?)null)
            .ReturnsAsync(new JournalEntry { Id = 55, Title = "J", Date = future });
        _journalRepo.Setup(j => j.AddAsync(It.IsAny<JournalEntry>())).ThrowsAsync(new DuplicateJournalDateException(future));

        var result = await _controller.Update(1, Put(future));

        Assert.IsType<OkObjectResult>(result.Result);
        _journalRepo.Verify(j => j.AddTodoAsync(55, 1, null), Times.Once);
        _tx.Verify(t => t.CommitAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_NullRefetchAfterDuplicate_ThrowsAndRollsBack()
    {
        Seed();
        var future = Today.AddDays(2);
        _journalRepo.Setup(j => j.GetByDateAsync(future)).ReturnsAsync((JournalEntry?)null);
        _journalRepo.Setup(j => j.AddAsync(It.IsAny<JournalEntry>())).ThrowsAsync(new DuplicateJournalDateException(future));

        await Assert.ThrowsAsync<InvalidOperationException>(() => _controller.Update(1, Put(future)));

        _journalRepo.Verify(j => j.AddTodoAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<int?>()), Times.Never);
        _tx.Verify(t => t.CommitAsync(It.IsAny<CancellationToken>()), Times.Never);
        _tx.Verify(t => t.DisposeAsync(), Times.Once);
    }

    // ---- CompletedAt (issue #350): reopen guard definition and planning a completed task ----

    private const string PlanCompletedCode = "TASK_PLAN_COMPLETED_NOT_ALLOWED";
    private const string ReopenCode = "TASK_REOPEN_PAST_DAY_NOT_ALLOWED";

    private TaskItem SeedCompleted(DateTime? completedAt)
    {
        var task = new TaskItem { Id = 1, Title = "Task", Status = Status.Completed, Priority = Priority.Low, CompletedAt = completedAt };
        _repo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        return task;
    }

    private static object Details(ActionResult? result)
    {
        var value = ((UnprocessableEntityObjectResult)result!).Value!;
        return value.GetType().GetProperty("details")!.GetValue(value)!;
    }

    private static DateTime LocalMidnightUtc(int? offset) =>
        UserDateHelper.GetUserToday(DateTime.UtcNow, offset).ToDateTime(TimeOnly.MinValue).AddMinutes(-(offset ?? 0));

    [Fact]
    public async Task Update_CompletedAtTask_DifferentJournalDate_Returns422AndWritesNothing()
    {
        SeedCompleted(DateTime.UtcNow);

        var result = await _controller.Update(1, Put(Today.AddDays(3)));

        Assert.Equal(PlanCompletedCode, Code(result.Result as ActionResult));
        Assert.Equal(
            "Completed tasks cannot be planned onto a different day.",
            ((UnprocessableEntityObjectResult)result.Result!).Value!.GetType().GetProperty("message")!.GetValue(((UnprocessableEntityObjectResult)result.Result!).Value!));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Patch_CompletedAtTask_DifferentJournalDate_Returns422AndWritesNothing()
    {
        SeedCompleted(DateTime.UtcNow);

        var result = await _controller.Patch(1, new PatchTaskItemDto { JournalDate = Today.AddDays(3) });

        Assert.Equal(PlanCompletedCode, Code(result.Result as ActionResult));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Update_CompletedAtTask_JournalDateEqualToCurrentLink_IsAcceptedWithoutPlanning()
    {
        SeedCompleted(DateTime.UtcNow);
        var link = Today.AddDays(-3);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(link);

        var result = await _controller.Update(1, Put(link));

        Assert.IsType<OkObjectResult>(result.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Patch_CompletedAtTask_JournalDateEqualToCurrentLink_IsAccepted()
    {
        SeedCompleted(DateTime.UtcNow);
        var link = Today.AddDays(2);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(link);

        var result = await _controller.Patch(1, new PatchTaskItemDto { JournalDate = link });

        Assert.IsType<OkObjectResult>(result.Result);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Update_CompletedAtTask_NullJournalDate_IsAccepted()
    {
        SeedCompleted(DateTime.UtcNow);

        var result = await _controller.Update(1, Put(null));

        Assert.IsType<OkObjectResult>(result.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Patch_CompletedAtTask_AbsentJournalDate_IsAccepted()
    {
        SeedCompleted(DateTime.UtcNow);

        var result = await _controller.Patch(1, new PatchTaskItemDto { Title = "Renamed" });

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_LegacyCompletedTaskWithNullCompletedAt_CanStillBePlanned()
    {
        SeedCompleted(null);
        SetupAddTodo(AddTodoResult.Success);

        var result = await _controller.Update(1, Put(Today.AddDays(3)));

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(["begin", "update", "addTodo", "commit"], _calls);
    }

    [Fact]
    public async Task Update_ReopenGuard422WinsOverPlanning422_WhenBothApply()
    {
        SeedCompleted(DateTime.UtcNow.AddDays(-2));

        var result = await _controller.Update(1, Put(Today.AddDays(3), status: Status.Todo));

        Assert.Equal(ReopenCode, Code(result.Result as ActionResult));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ReopenAndReplanOnCompletedAtTask_Returns422PlanCompleted()
    {
        SeedCompleted(DateTime.UtcNow);

        var result = await _controller.Update(1, Put(Today.AddDays(3), status: Status.Todo));

        Assert.Equal(PlanCompletedCode, Code(result.Result as ActionResult));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        AssertNoJournalOrTx();
    }

    [Fact]
    public async Task Patch_ReopenAndReplanOnCompletedAtTask_Returns422PlanCompleted()
    {
        SeedCompleted(DateTime.UtcNow);

        var result = await _controller.Patch(1, new PatchTaskItemDto { Status = Status.Todo, JournalDate = Today.AddDays(3) });

        Assert.Equal(PlanCompletedCode, Code(result.Result as ActionResult));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_SameDayResendOfPastLinkOnLegacyTask_DoesNotFail()
    {
        SeedCompleted(null);
        var past = Today.AddDays(-4);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(past);

        var result = await _controller.Update(1, Put(past));

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Reopen_CompletedToday_WithPastLink_IsAllowed()
    {
        SeedCompleted(DateTime.UtcNow);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(Today.AddDays(-5));

        var result = await _controller.Update(1, Put(null, status: Status.Todo));

        Assert.IsType<OkObjectResult>(result.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Update_Reopen_CompletedYesterday_IsRejectedWithCompletionDayAsAssignedDate()
    {
        var completedAt = DateTime.UtcNow.AddDays(-1);
        SeedCompleted(completedAt);
        // The linked day is today: only the completion day is "past".
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(Today);

        var result = await _controller.Update(1, Put(null, status: Status.Todo));

        Assert.Equal(ReopenCode, Code(result.Result as ActionResult));
        var details = Details(result.Result as ActionResult);
        Assert.Equal(DateOnly.FromDateTime(completedAt), details.GetType().GetProperty("assignedDate")!.GetValue(details));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(-300)]
    [InlineData(840)]
    public async Task Update_Reopen_OneMinuteBeforeLocalMidnight_IsRejected(int? offset)
    {
        SeedCompleted(LocalMidnightUtc(offset).AddMinutes(-1));

        var result = await _controller.Update(1, Put(null, offset, Status.Todo));

        Assert.Equal(ReopenCode, Code(result.Result as ActionResult));
        var details = Details(result.Result as ActionResult);
        Assert.Equal(
            UserDateHelper.GetUserToday(DateTime.UtcNow, offset).AddDays(-1),
            details.GetType().GetProperty("assignedDate")!.GetValue(details));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(-300)]
    [InlineData(840)]
    public async Task Update_Reopen_OneMinuteAfterLocalMidnight_IsAllowed(int? offset)
    {
        SeedCompleted(LocalMidnightUtc(offset).AddMinutes(1));

        var result = await _controller.Update(1, Put(null, offset, Status.Todo));

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Reopen_NullCompletedAtWithPastLink_IsRejectedWithLinkedDay()
    {
        SeedCompleted(null);
        var link = Today.AddDays(-2);
        _repo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(link);

        var result = await _controller.Update(1, Put(null, status: Status.Todo));

        Assert.Equal(ReopenCode, Code(result.Result as ActionResult));
        var details = Details(result.Result as ActionResult);
        Assert.Equal(link, details.GetType().GetProperty("assignedDate")!.GetValue(details));
    }

    [Fact]
    public async Task Update_Reopen_CompletedAtOnPastDayWithNoLink_IsRejected()
    {
        SeedCompleted(DateTime.UtcNow.AddDays(-3));

        var result = await _controller.Update(1, Put(null, status: Status.Todo));

        Assert.Equal(ReopenCode, Code(result.Result as ActionResult));
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_Reopen_NullCompletedAtAndNoJournalDay_IsAllowed()
    {
        SeedCompleted(null);

        var result = await _controller.Update(1, Put(null, status: Status.Todo));

        Assert.IsType<OkObjectResult>(result.Result);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }
}
