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

/// <summary>
/// Tests for <c>PATCH /api/v1/TaskItems/{id}</c> and the Status-only completion contract shared with PUT.
/// "Real" tests use a real SQLite context, the real <see cref="TaskRepository"/> and the real
/// <see cref="TaskItemValidator"/> so history events and validation are actually exercised.
/// </summary>
public class TaskItemsControllerPatchTests
{
    private readonly Mock<ITaskRepository> _mockRepo = new();
    private readonly Mock<FluentValidation.IValidator<TaskItem>> _mockValidator = new();
    private readonly Mock<IJournalEntryRepository> _mockJournalRepo = new();
    private readonly Mock<IProjectRepository> _mockProjectRepo = new();
    private readonly Mock<FluentValidation.IValidator<CreateTaskItemDto>> _mockCreateDtoValidator = new();
    private readonly Mock<FluentValidation.IValidator<UpdateTaskItemDto>> _mockUpdateDtoValidator = new();
    private readonly Mock<FluentValidation.IValidator<PatchTaskItemDto>> _mockPatchDtoValidator = new();
    private readonly TaskItemsController _mockedController;

    public TaskItemsControllerPatchTests()
    {
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(It.IsAny<int>())).ReturnsAsync((DateOnly?)null);
        _mockRepo.Setup(r => r.GetHistoryAsync(It.IsAny<int>())).ReturnsAsync([]);
        _mockRepo.Setup(r => r.GetAssignedJournalDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly>());
        _mockRepo.Setup(r => r.GetLastMovedDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly>());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _mockUpdateDtoValidator.Setup(v => v.ValidateAsync(It.IsAny<UpdateTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _mockPatchDtoValidator.Setup(v => v.ValidateAsync(It.IsAny<PatchTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _mockCreateDtoValidator.Setup(v => v.ValidateAsync(It.IsAny<CreateTaskItemDto>(), default)).ReturnsAsync(new ValidationResult());
        _mockedController = new TaskItemsController(
            _mockRepo.Object,
            _mockValidator.Object,
            _mockJournalRepo.Object,
            _mockProjectRepo.Object,
            _mockCreateDtoValidator.Object,
            _mockUpdateDtoValidator.Object,
            _mockPatchDtoValidator.Object);
    }

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

        public async Task<List<string>> EventTypesAsync(int taskId) =>
            await Context.TaskItemEvents.Where(e => e.TaskItemId == taskId).Select(e => e.EventType).ToListAsync();

        public async Task<TaskItem> ReloadAsync(int id) =>
            await Context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == id);

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

    private static TaskItem NewRichTask() => new()
    {
        Title = "Original",
        Description = "Keep me",
        DueDate = new DateOnly(2026, 5, 20),
        Status = Status.Todo,
        Priority = Priority.High
    };

    // ---- Real-stack success paths ----

    [Fact]
    public async Task GetAll_ShouldResolveDatesForManyTasks_OnRealSqliteStack()
    {
        using var stack = new RealStack();
        var day1 = new JournalEntry { Title = "d1", Date = new DateOnly(2026, 3, 1) };
        var day2 = new JournalEntry { Title = "d2", Date = new DateOnly(2026, 3, 2) };
        stack.Context.JournalEntries.AddRange(day1, day2);
        var a = new TaskItem { Title = "A", Status = Status.Todo, CurrentJournalEntry = day1, FirstTaggedDate = day1.Date };
        var b = new TaskItem { Title = "B", Status = Status.Todo, CurrentJournalEntry = day2, FirstTaggedDate = day1.Date };
        var c = new TaskItem { Title = "C", Status = Status.Todo };
        stack.Context.TaskItems.AddRange(a, b, c);
        await stack.Context.SaveChangesAsync();
        var t0 = new DateTime(2026, 3, 1, 8, 0, 0, DateTimeKind.Utc);
        stack.Context.TaskItemEvents.AddRange(
            new TaskItemEvent { TaskItemId = a.Id, EventType = "TaskCreated", OccurredAtUtc = t0 },
            new TaskItemEvent { TaskItemId = a.Id, EventType = "MovedToJournalDay", OccurredAtUtc = t0.AddHours(1), ToJournalDate = day1.Date },
            new TaskItemEvent { TaskItemId = b.Id, EventType = "MovedToJournalDay", OccurredAtUtc = t0, ToJournalDate = day1.Date },
            new TaskItemEvent { TaskItemId = b.Id, EventType = "MovedToJournalDay", OccurredAtUtc = t0.AddHours(2), FromJournalDate = day1.Date, ToJournalDate = day2.Date });
        await stack.Context.SaveChangesAsync();
        stack.Context.ChangeTracker.Clear();

        var result = await stack.Controller.GetAll();

        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).ToDictionary(d => d.Id);
        Assert.Equal(3, dtos.Count);
        Assert.Equal(day1.Date, dtos[a.Id].CurrentJournalDate);
        Assert.Equal(day1.Date, dtos[a.Id].LastMovedDate);
        Assert.Equal(day2.Date, dtos[b.Id].CurrentJournalDate);
        Assert.Equal(day2.Date, dtos[b.Id].LastMovedDate);
        Assert.Null(dtos[c.Id].CurrentJournalDate);
        Assert.Null(dtos[c.Id].LastMovedDate);
    }

    [Fact]
    public async Task Patch_ShouldLeaveEveryOtherFieldUnchanged_WhenOnlyTitleSent()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var seeded = NewRichTask();
        seeded.ParentTaskItemId = parent.Id;
        await stack.SeedAsync(seeded);

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Title = "Renamed" });

        var dto = OkDto(result);
        Assert.Equal("Renamed", dto.Title);
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal("Keep me", reloaded.Description);
        Assert.Equal(seeded.DueDate, reloaded.DueDate);
        Assert.Equal(Status.Todo, reloaded.Status);
        Assert.Equal(Priority.High, reloaded.Priority);
        Assert.Equal(parent.Id, reloaded.ParentTaskItemId);
        Assert.Null(reloaded.ProjectId);
        Assert.Equal(["TitleChanged"], await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldWriteNoDescriptionOrDueDateEvents_WhenStatusToggledWithoutThoseFields()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto
        {
            Status = Status.Completed,
            AutoCompleteParentWhenChildrenDone = true,
            TimezoneOffsetMinutes = -300
        });

        Assert.Equal("Completed", OkDto(result).Status);
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Equal("Keep me", reloaded.Description);
        Assert.Equal(seeded.DueDate, reloaded.DueDate);
        Assert.Equal(["Completed"], await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldCompleteThenReopen_WithCompletedAndReopenedEvents()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Completed }));
        Assert.Equal(Status.Completed, (await stack.ReloadAsync(seeded.Id)).Status);
        stack.Context.ChangeTracker.Clear();
        OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));

        Assert.Equal(Status.Todo, (await stack.ReloadAsync(seeded.Id)).Status);
        Assert.Equal(["Completed", "Reopened"], (await stack.EventTypesAsync(seeded.Id)).Order().ToList());
    }

    [Fact]
    public async Task Patch_ShouldClearDescriptionAndWriteEvent_WhenDescriptionExplicitlyNull()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Description = null }));

        Assert.Null(dto.Description);
        Assert.Null((await stack.ReloadAsync(seeded.Id)).Description);
        Assert.Equal(["DescriptionChanged"], await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldClearDueDateAndWriteEvent_WhenDueDateExplicitlyNull()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { DueDate = null }));

        Assert.Null(dto.DueDate);
        var reloaded = await stack.ReloadAsync(seeded.Id);
        Assert.Null(reloaded.DueDate);
        Assert.Equal("Keep me", reloaded.Description);
        Assert.Equal(["DueDateChanged"], await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldSetDescriptionDueDateAndPriority_WhenSupplied()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());
        var newDue = new DateOnly(2026, 6, 1);

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto
        {
            Description = "New",
            DueDate = newDue,
            Priority = Priority.Low
        }));

        Assert.Equal("New", dto.Description);
        Assert.Equal(newDue, dto.DueDate);
        Assert.Equal("Low", dto.Priority);
    }

    [Fact]
    public async Task Patch_ShouldLeaveStatusAndPriorityUnchanged_WhenSentExplicitlyNull()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = null, Priority = null, Title = "T" }));

        Assert.Equal("Todo", dto.Status);
        Assert.Equal("High", dto.Priority);
    }

    [Fact]
    public async Task Patch_ShouldSetAndClearParent_WhenParentPresent()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo });

        var assigned = OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { ParentTaskItemId = parent.Id }));
        Assert.Equal(parent.Id, assigned.ParentTaskItemId);
        stack.Context.ChangeTracker.Clear();

        var untouched = OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { Title = "Renamed child" }));
        Assert.Equal(parent.Id, untouched.ParentTaskItemId);
        stack.Context.ChangeTracker.Clear();

        var cleared = OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { ParentTaskItemId = null }));
        Assert.Null(cleared.ParentTaskItemId);
    }

    [Fact]
    public async Task Patch_ShouldKeepCompletedStatus_WhenRenamingCompletedTask()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "Done", Status = Status.Completed });

        var dto = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Title = "Done renamed" }));

        Assert.Equal("Completed", dto.Status);
        Assert.Equal(["TitleChanged"], await stack.EventTypesAsync(seeded.Id));
    }

    [Fact]
    public async Task Patch_ShouldAutoCompleteParent_WhenLastChildCompletesAndFlagSet()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto
        {
            Status = Status.Completed,
            AutoCompleteParentWhenChildrenDone = true
        }));

        Assert.Equal(Status.Completed, (await stack.ReloadAsync(child.Id)).Status);
        Assert.Equal(Status.Completed, (await stack.ReloadAsync(parent.Id)).Status);
        Assert.Contains("Completed", await stack.EventTypesAsync(parent.Id));
    }

    [Fact]
    public async Task Patch_ShouldNotAutoCompleteParent_WhenFlagNotSet()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto { Status = Status.Completed }));

        Assert.Equal(Status.Todo, (await stack.ReloadAsync(parent.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldNotAutoCompleteParent_WhenAnotherChildIsStillOpen()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });
        await stack.SeedAsync(new TaskItem { Title = "Other child", Status = Status.Draft, ParentTaskItemId = parent.Id });

        OkDto(await stack.Controller.Patch(child.Id, new PatchTaskItemDto
        {
            Status = Status.Completed,
            AutoCompleteParentWhenChildrenDone = true
        }));

        Assert.Equal(Status.Todo, (await stack.ReloadAsync(parent.Id)).Status);
    }

    [Fact]
    public async Task Patch_ShouldNotQueryChildren_WhenParentIsMissingDuringAutoComplete()
    {
        var child = new TaskItem { Id = 2, Title = "Child", Status = Status.Todo, ParentTaskItemId = 10 };
        _mockRepo.Setup(r => r.GetByIdAsync(2)).ReturnsAsync(child);
        _mockRepo.Setup(r => r.GetByIdAsync(10)).ReturnsAsync((TaskItem?)null);

        var result = await _mockedController.Patch(2, new PatchTaskItemDto
        {
            Status = Status.Completed,
            AutoCompleteParentWhenChildrenDone = true
        });

        Assert.IsType<OkObjectResult>(result.Result);
        _mockRepo.Verify(r => r.GetChildrenAsync(10), Times.Never);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Never);
    }

    [Fact]
    public async Task Put_ShouldAutoCompleteParent_WhenLastChildCompletesAgainstRealDatabase()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        var child = await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        OkDto(await stack.Controller.Update(child.Id, new UpdateTaskItemDto
        {
            Title = "Child",
            Status = Status.Completed,
            Priority = Priority.Low,
            ParentTaskItemId = parent.Id,
            AutoCompleteParentWhenChildrenDone = true
        }));

        Assert.Equal(Status.Completed, (await stack.ReloadAsync(parent.Id)).Status);
    }

    [Fact]
    public async Task Put_ShouldRejectParentAssignment_WhenTaskHasChildrenAgainstRealDatabase()
    {
        using var stack = new RealStack();
        var task = await stack.SeedAsync(new TaskItem { Title = "Task", Status = Status.Todo });
        await stack.SeedAsync(new TaskItem { Title = "Its child", Status = Status.Todo, ParentTaskItemId = task.Id });
        var newParent = await stack.SeedAsync(new TaskItem { Title = "New parent", Status = Status.Todo });

        var result = await stack.Controller.Update(task.Id, new UpdateTaskItemDto
        {
            Title = "Task",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = newParent.Id
        });

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Contains("TASK_PARENT_DEPTH_NOT_ALLOWED", System.Text.Json.JsonSerializer.Serialize(unprocessable.Value));
        Assert.Null((await stack.ReloadAsync(task.Id)).ParentTaskItemId);
    }

    [Fact]
    public async Task Put_ThenPatchReopen_ShouldReadAsOpenEverywhere()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto
        {
            Title = "Original",
            Description = "Keep me",
            DueDate = seeded.DueDate,
            Status = Status.Completed
        }));
        stack.Context.ChangeTracker.Clear();
        var reopened = OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo }));
        stack.Context.ChangeTracker.Clear();

        Assert.Equal("Todo", reopened.Status);
        var get = Assert.IsType<OkObjectResult>((await stack.Controller.Get(seeded.Id)).Result);
        Assert.Equal("Todo", Assert.IsType<TaskItemResponseDto>(get.Value).Status);
        var all = Assert.IsType<OkObjectResult>((await stack.Controller.GetAll()).Result);
        Assert.Equal("Todo", Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(all.Value).Single().Status);
    }

    [Fact]
    public async Task Put_ThenPatchReopen_ShouldBeIncludedInCarryForward()
    {
        using var stack = new RealStack();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var tomorrow = today.AddDays(1);
        var journalRepo = new JournalEntryRepository(stack.Context);
        var source = await journalRepo.AddAsync(new JournalEntry { Title = "Today", Date = today });
        var seeded = await stack.SeedAsync(NewRichTask());
        stack.Context.JournalEntries.Single(e => e.Id == source.Id).Todos.Add(stack.Context.TaskItems.Single(t => t.Id == seeded.Id));
        stack.Context.TaskItems.Single(t => t.Id == seeded.Id).CurrentJournalEntryId = source.Id;
        await stack.Context.SaveChangesAsync();
        stack.Context.ChangeTracker.Clear();

        OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Original", Status = Status.Completed }));
        stack.Context.ChangeTracker.Clear();
        OkDto(await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 }));
        stack.Context.ChangeTracker.Clear();

        var target = await journalRepo.AddAsync(new JournalEntry { Title = "Tomorrow", Date = tomorrow });
        var moved = await journalRepo.CarryForwardIncompleteTasksAsync(target.Id, tomorrow);

        Assert.Equal([seeded.Id], moved);
    }

    [Fact]
    public async Task Put_ShouldKeepStoredStatus_WhenStatusOmitted()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(new TaskItem { Title = "T", Status = Status.Todo });

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "T2" }));

        Assert.Equal("Todo", dto.Status);
    }

    [Fact]
    public async Task Put_ShouldStillClearDescriptionAndDueDate_WhenSentNull()
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        var dto = OkDto(await stack.Controller.Update(seeded.Id, new UpdateTaskItemDto { Title = "Original", Description = null, DueDate = null }));

        Assert.Null(dto.Description);
        Assert.Null(dto.DueDate);
        Assert.Equal("High", dto.Priority);
    }

    // ---- Real-stack failure paths ----

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Patch_ShouldReturnBadRequest_WhenTitleIsNullEmptyOrWhitespace(string? title)
    {
        using var stack = new RealStack();
        var seeded = await stack.SeedAsync(NewRichTask());

        var result = await stack.Controller.Patch(seeded.Id, new PatchTaskItemDto { Title = title });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        stack.Context.ChangeTracker.Clear();
        Assert.Equal("Original", (await stack.ReloadAsync(seeded.Id)).Title);
    }

    [Fact]
    public async Task Patch_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        using var stack = new RealStack();

        var result = await stack.Controller.Patch(999, new PatchTaskItemDto { Title = "x" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenCompletingParentWithOpenChildren()
    {
        using var stack = new RealStack();
        var parent = await stack.SeedAsync(new TaskItem { Title = "Parent", Status = Status.Todo });
        await stack.SeedAsync(new TaskItem { Title = "Child", Status = Status.Todo, ParentTaskItemId = parent.Id });

        var result = await stack.Controller.Patch(parent.Id, new PatchTaskItemDto { Status = Status.Completed });

        Assert.Equal("TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", ErrorCode(result));
    }

    // ---- Mocked guard paths ----

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenReopeningTaskAssignedToPastDay()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T", Status = Status.Completed });
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1));

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 });

        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", ErrorCode(result));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Patch_ShouldAllowReopening_WhenCompletedTodayAndLinkedToPastDay()
    {
        var existing = new TaskItem { Id = 1, Title = "T", Status = Status.Completed, CompletedAt = DateTime.UtcNow };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-3));

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 });

        Assert.Equal("Todo", OkDto(result).Status);
        _mockRepo.Verify(r => r.UpdateAsync(existing), Times.Once);
    }

    [Fact]
    public async Task Patch_ShouldRejectReopening_WhenCompletedYesterdayAndReportCompletionDay()
    {
        var completedAt = DateTime.UtcNow.AddDays(-1);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T", Status = Status.Completed, CompletedAt = completedAt });
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(DateOnly.FromDateTime(DateTime.UtcNow));

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 });

        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", ErrorCode(result));
        var value = Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;
        var details = value.GetType().GetProperty("details")!.GetValue(value)!;
        Assert.Equal(DateOnly.FromDateTime(completedAt), details.GetType().GetProperty("assignedDate")!.GetValue(details));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Patch_ShouldUseRequestTimezoneOffset_ForReopenGuard()
    {
        const int offset = 1440;
        var utcNow = DateTime.UtcNow;
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T", Status = Status.Completed });
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(UserDateHelper.GetUserToday(utcNow, offset).AddDays(-1));

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = offset });

        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", ErrorCode(result));
    }

    [Fact]
    public async Task Patch_ShouldAllowReopening_WhenAssignedToToday()
    {
        var existing = new TaskItem { Id = 1, Title = "T", Status = Status.Completed };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(DateOnly.FromDateTime(DateTime.UtcNow));

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 0 });

        Assert.Equal("Todo", OkDto(result).Status);
        _mockRepo.Verify(r => r.UpdateAsync(existing), Times.Once);
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenParentIsSelf()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T" });

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { ParentTaskItemId = 1 });

        Assert.Equal("TASK_PARENT_SELF_NOT_ALLOWED", ErrorCode(result));
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenParentNotFound()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T" });
        _mockRepo.Setup(r => r.GetByIdNoTrackingAsync(9)).ReturnsAsync((TaskItem?)null);

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { ParentTaskItemId = 9 });

        Assert.Equal("TASK_PARENT_NOT_FOUND", ErrorCode(result));
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenParentWouldExceedDepth()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T" });
        _mockRepo.Setup(r => r.GetByIdNoTrackingAsync(9)).ReturnsAsync(new TaskItem { Id = 9, Title = "Child", ParentTaskItemId = 4 });

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { ParentTaskItemId = 9 });

        Assert.Equal("TASK_PARENT_DEPTH_NOT_ALLOWED", ErrorCode(result));
    }

    [Fact]
    public async Task Patch_ShouldReturnUnprocessable_WhenTaskWithChildrenBecomesChild()
    {
        var root = new TaskItem { Id = 1, Title = "Root" };
        var candidate = new TaskItem { Id = 9, Title = "Candidate" };
        var child = new TaskItem { Id = 2, Title = "Child", ParentTaskItemId = 1 };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(root);
        _mockRepo.Setup(r => r.GetByIdNoTrackingAsync(9)).ReturnsAsync(candidate);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([child]);

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { ParentTaskItemId = 9 });

        Assert.Equal("TASK_PARENT_DEPTH_NOT_ALLOWED", ErrorCode(result));
    }

    [Fact]
    public async Task Patch_ShouldReturnDepthError_WhenProposedParentIsOwnChild()
    {
        // A proposed parent that is itself a child is rejected by the one-level depth guard.
        var root = new TaskItem { Id = 1, Title = "Root" };
        var child = new TaskItem { Id = 2, Title = "Child", ParentTaskItemId = 1 };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(root);
        _mockRepo.Setup(r => r.GetByIdNoTrackingAsync(2)).ReturnsAsync(child);

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { ParentTaskItemId = 2 });

        Assert.Equal("TASK_PARENT_DEPTH_NOT_ALLOWED", ErrorCode(result));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Patch_ShouldNotRunParentGuards_WhenParentOmittedOrNull()
    {
        var existing = new TaskItem { Id = 1, Title = "T", ParentTaskItemId = 5 };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);

        OkDto(await _mockedController.Patch(1, new PatchTaskItemDto { Title = "x" }));
        Assert.Equal(5, existing.ParentTaskItemId);

        OkDto(await _mockedController.Patch(1, new PatchTaskItemDto { ParentTaskItemId = null }));
        Assert.Null(existing.ParentTaskItemId);
        _mockRepo.Verify(r => r.GetByIdNoTrackingAsync(5), Times.Never);
    }

    [Fact]
    public async Task Patch_ShouldReturnBadRequestWithValidatorErrors_WhenValidationFails()
    {
        var failures = new List<ValidationFailure> { new("Title", "Title is required.") };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T" });
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult(failures));

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { Title = "" });

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(failures, bad.Value);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    // ---- Status-only contract ----

    [Theory]
    [InlineData(Status.Todo)]
    [InlineData(Status.Draft)]
    public async Task Update_ShouldReturnRequestedStatus(Status status)
    {
        // Status is the only completion input on UpdateTaskItemDto. The stale-isComplete
        // behaviour is covered end to end in TaskItemsControllerLegacyIsCompleteTests.
        var existing = new TaskItem { Id = 1, Title = "T", Status = Status.Draft };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);

        var result = await _mockedController.Update(1, new UpdateTaskItemDto { Title = "T", Status = status });

        Assert.Equal(status.ToString(), OkDto(result).Status);
    }

    [Fact]
    public async Task Create_ShouldPersistRequestedStatus()
    {
        TaskItem? captured = null;
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>()))
            .Callback<TaskItem>(t => captured = t)
            .ReturnsAsync((TaskItem t) => { t.Id = 1; return t; });
        _mockRepo.Setup(r => r.GetByIdNoTrackingAsync(1)).ReturnsAsync(() => captured);

        var result = await _mockedController.Create(new CreateTaskItemDto { Title = "T", Status = Status.Completed });

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        Assert.Equal("Completed", Assert.IsType<TaskItemResponseDto>(created.Value).Status);
        Assert.Equal(Status.Completed, captured!.Status);
    }

    [Fact]
    public void Contracts_ShouldNotExposeIsComplete()
    {
        Assert.Null(typeof(TaskItem).GetProperty("IsComplete"));
        Assert.Null(typeof(TaskItemResponseDto).GetProperty("IsComplete"));
        Assert.Null(typeof(CreateTaskItemDto).GetProperty("IsComplete"));
        Assert.Null(typeof(UpdateTaskItemDto).GetProperty("IsComplete"));
        Assert.Null(typeof(PatchTaskItemDto).GetProperty("IsComplete"));
    }

    // ---- DTO timezone offset validation (issue #207) ----

    private const string OffsetMessage = TimezoneOffsetTestHelpers.OffsetMessage;

    private TaskItemsController NewControllerWithRealDtoValidators() => new(
        _mockRepo.Object,
        _mockValidator.Object,
        _mockJournalRepo.Object,
        _mockProjectRepo.Object,
        new CreateTaskItemDtoValidator(),
        new UpdateTaskItemDtoValidator(),
        new PatchTaskItemDtoValidator());

    private static void AssertOffsetBadRequest(ActionResult<TaskItemResponseDto> result)
        => TimezoneOffsetTestHelpers.AssertOffsetBadRequest(result.Result);

    [Fact]
    public async Task Patch_ShouldReturnBadRequestWithValidationErrors_WhenDtoValidatorFails()
    {
        var failures = new List<ValidationFailure> { new("TimezoneOffsetMinutes", OffsetMessage) };
        _mockPatchDtoValidator.Setup(v => v.ValidateAsync(It.IsAny<PatchTaskItemDto>(), default))
            .ReturnsAsync(new ValidationResult(failures));

        var result = await _mockedController.Patch(1, new PatchTaskItemDto { TimezoneOffsetMinutes = 841 });

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(failures, badRequest.Value);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
        _mockRepo.Verify(r => r.GetByIdAsync(It.IsAny<int>()), Times.Never);
    }

    [Theory]
    [InlineData(-721)]
    [InlineData(841)]
    [InlineData(-2000000000)]
    public async Task Patch_ShouldReturnBadRequest_WhenOffsetOutOfRange(int offset)
    {
        var controller = NewControllerWithRealDtoValidators();

        var result = await controller.Patch(1, new PatchTaskItemDto { Status = Status.Completed, TimezoneOffsetMinutes = offset });

        AssertOffsetBadRequest(result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Patch_ShouldReturnBadRequestNotNotFound_WhenIdMissingAndOffsetOutOfRange()
    {
        var controller = NewControllerWithRealDtoValidators();
        _mockRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((TaskItem?)null);

        var result = await controller.Patch(999, new PatchTaskItemDto { Title = "x", TimezoneOffsetMinutes = -721 });

        AssertOffsetBadRequest(result);
        _mockRepo.Verify(r => r.GetByIdAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Patch_ShouldReturnNotFound_WhenIdMissingAndOffsetValid()
    {
        var controller = NewControllerWithRealDtoValidators();
        _mockRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((TaskItem?)null);

        var result = await controller.Patch(999, new PatchTaskItemDto { Title = "x", TimezoneOffsetMinutes = 0 });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Patch_ShouldReturnBadRequestNotReopenError_WhenReopeningAndOffsetOutOfRange()
    {
        // Positive control (same setup, valid offset 0 -> reopen guard fires):
        // Patch_ShouldReturnUnprocessable_WhenReopeningTaskAssignedToPastDay
        var controller = NewControllerWithRealDtoValidators();
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T", Status = Status.Completed });
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1));

        var result = await controller.Patch(1, new PatchTaskItemDto { Status = Status.Todo, TimezoneOffsetMinutes = 841 });

        AssertOffsetBadRequest(result);
        _mockRepo.Verify(r => r.GetByIdAsync(It.IsAny<int>()), Times.Never);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Theory]
    [InlineData(-720)]
    [InlineData(840)]
    public async Task Patch_ShouldNotReturnOffsetBadRequest_WhenOffsetAtBoundary(int offset)
    {
        var controller = NewControllerWithRealDtoValidators();
        var existing = new TaskItem { Id = 1, Title = "T", Status = Status.Todo };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);

        var result = await controller.Patch(1, new PatchTaskItemDto { Title = "T2", TimezoneOffsetMinutes = offset });

        Assert.Equal("T2", OkDto(result).Title);
        _mockRepo.Verify(r => r.UpdateAsync(existing), Times.Once);
    }
}
