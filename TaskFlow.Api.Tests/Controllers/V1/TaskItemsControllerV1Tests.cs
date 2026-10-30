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

namespace TaskFlow.Api.Tests.Controllers.V1;

public class TaskItemsControllerV1Tests
{
    private readonly Mock<ITaskRepository> _mockRepo;
    private readonly Mock<IValidator<TaskItem>> _mockValidator;
    private readonly Mock<IJournalEntryRepository> _mockJournalRepo;
    private readonly Mock<IProjectRepository> _mockProjectRepo;
    private readonly TaskItemsController _controller;

    public TaskItemsControllerV1Tests()
    {
        _mockRepo = new Mock<ITaskRepository>();
        _mockValidator = new Mock<IValidator<TaskItem>>();
        _mockJournalRepo = new Mock<IJournalEntryRepository>();
        _mockProjectRepo = new Mock<IProjectRepository>();
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(It.IsAny<int>())).ReturnsAsync((DateOnly?)null);
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([]);
        _mockRepo.Setup(r => r.GetHistoryAsync(It.IsAny<int>())).ReturnsAsync([]);
        _mockRepo.Setup(r => r.GetAssignedJournalDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly>());
        _mockRepo.Setup(r => r.GetLastMovedDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly>());
        _controller = new TaskItemsController(_mockRepo.Object, _mockValidator.Object, _mockJournalRepo.Object, _mockProjectRepo.Object);
    }

    [Fact]
    public async Task GetAll_ShouldUseBulkLookupsOnce_WhenManyTasks()
    {
        var tasks = Enumerable.Range(1, 5).Select(i => new TaskItem { Id = i, Title = $"T{i}", Status = Status.Todo }).ToList();
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync(tasks);

        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(5, Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).Count());
        _mockRepo.Verify(r => r.GetAssignedJournalDatesAsync(It.Is<IReadOnlyCollection<int>>(c => c.Count == 5)), Times.Once);
        _mockRepo.Verify(r => r.GetLastMovedDatesAsync(It.Is<IReadOnlyCollection<int>>(c => c.Count == 5)), Times.Once);
        _mockRepo.Verify(r => r.GetAssignedJournalDateAsync(It.IsAny<int>()), Times.Never);
        _mockRepo.Verify(r => r.GetHistoryAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task GetAll_ShouldMapDatesFromLookups_WhenOnlySomeTasksHaveThem()
    {
        var tasks = new List<TaskItem>
        {
            new() { Id = 1, Title = "Parent", Status = Status.Todo, FirstTaggedDate = new DateOnly(2026, 3, 1) },
            new() { Id = 2, Title = "Child", Status = Status.Todo, ParentTaskItemId = 1 },
            new() { Id = 3, Title = "Bare", Status = Status.Todo }
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync(tasks);
        _mockRepo.Setup(r => r.GetAssignedJournalDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly> { [1] = new DateOnly(2026, 3, 4) });
        _mockRepo.Setup(r => r.GetLastMovedDatesAsync(It.IsAny<IReadOnlyCollection<int>>()))
            .ReturnsAsync(new Dictionary<int, DateOnly> { [1] = new DateOnly(2026, 3, 3), [2] = new DateOnly(2026, 3, 2) });

        var result = await _controller.GetAll();

        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).ToDictionary(d => d.Id);
        Assert.Equal(new DateOnly(2026, 3, 4), dtos[1].CurrentJournalDate);
        Assert.Equal(DaysTaggedHelper.GetDaysTagged(new DateOnly(2026, 3, 1), new DateOnly(2026, 3, 4)), dtos[1].DaysTagged);
        Assert.Equal(new DateOnly(2026, 3, 3), dtos[1].LastMovedDate);
        Assert.Equal(1, dtos[1].ChildTaskCount);
        Assert.Null(dtos[2].CurrentJournalDate);
        Assert.Equal(new DateOnly(2026, 3, 2), dtos[2].LastMovedDate);
        Assert.Null(dtos[3].CurrentJournalDate);
        Assert.Null(dtos[3].LastMovedDate);
        Assert.Equal(0, dtos[3].ChildTaskCount);
    }

    [Fact]
    public async Task GetAll_ShouldReturnEmptyWithoutBulkCalls_WhenNoTasks()
    {
        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value));
        _mockRepo.Verify(r => r.GetAssignedJournalDatesAsync(It.IsAny<IReadOnlyCollection<int>>()), Times.Never);
        _mockRepo.Verify(r => r.GetLastMovedDatesAsync(It.IsAny<IReadOnlyCollection<int>>()), Times.Never);
    }

    [Fact]
    public async Task Get_ShouldReturnLastMovedDateFromHistory_WhenEventsHaveDates()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "T", Status = Status.Todo });
        _mockRepo.Setup(r => r.GetHistoryAsync(1)).ReturnsAsync(
        [
            new TaskItemEvent { Id = 1, TaskItemId = 1, OccurredAtUtc = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc), ToJournalDate = new DateOnly(2026, 3, 1) },
            new TaskItemEvent { Id = 2, TaskItemId = 1, OccurredAtUtc = new DateTime(2026, 3, 2, 0, 0, 0, DateTimeKind.Utc), FromJournalDate = new DateOnly(2026, 3, 1) }
        ]);

        var result = await _controller.Get(1);

        var dto = Assert.IsType<TaskItemResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new DateOnly(2026, 3, 1), dto.LastMovedDate);
        _mockRepo.Verify(r => r.GetHistoryAsync(1), Times.Once);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOkWithAllTasks()
    {
        // Arrange
        var dueDate = new DateTime(2025, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        var tasks = new List<TaskItem>
        {
            new() { Id = 1, Title = "Task 1", Description = "Description 1", Status = Status.Todo, Priority = Priority.Low, DueDate = dueDate },
            new() { Id = 2, Title = "Task 2", Description = "Description 2", Status = Status.Completed, Priority = Priority.High }
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync(tasks);

        // Act
        var result = await _controller.GetAll();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(okResult.Value);
        Assert.Equal(2, dtos.Count());
        Assert.Contains(dtos, d => d.Id == 1 && d.Title == "Task 1" && d.Status == "Todo" && d.Priority == "Low" && d.DueDate == dueDate);
        Assert.Contains(dtos, d => d.Id == 2 && d.Title == "Task 2" && d.Status == "Completed" && d.Priority == "High" && d.DueDate == null);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Once);
    }

    [Fact]
    public async Task Get_ShouldReturnOkWithTask_WhenTaskExists()
    {
        // Arrange
        var dueDate = new DateTime(2025, 6, 15, 0, 0, 0, DateTimeKind.Utc);
        var task = new TaskItem
        {
            Id = 1,
            Title = "Task 1",
            Description = "Description",
            Status = Status.Todo,
            Priority = Priority.Medium,
            DueDate = dueDate
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);

        // Act
        var result = await _controller.Get(1);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<TaskItemResponseDto>(okResult.Value);
        Assert.Equal(1, dto.Id);
        Assert.Equal("Task 1", dto.Title);
        Assert.Equal("Description", dto.Description);
        Assert.Equal("Todo", dto.Status);
        Assert.Equal("Medium", dto.Priority);
        Assert.Equal(dueDate, dto.DueDate);
        _mockRepo.Verify(r => r.GetByIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        // Arrange
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync((TaskItem?)null);

        // Act
        var result = await _controller.Get(1);

        // Assert
        Assert.IsType<NotFoundResult>(result.Result);
        _mockRepo.Verify(r => r.GetByIdAsync(1), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldReturnCreatedAtRoute_WhenValid()
    {
        // Arrange
        var dueDate = new DateTime(2025, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        var createDto = new CreateTaskItemDto
        {
            Title = "New Task",
            Description = "New Description",
            Status = Status.Todo,
            Priority = Priority.High,
            DueDate = dueDate
        };
        var createdTask = new TaskItem
        {
            Id = 1,
            Title = createDto.Title,
            Description = createDto.Description,
            Status = createDto.Status,
            Priority = createDto.Priority,
            DueDate = createDto.DueDate
        };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>()))
            .ReturnsAsync(createdTask);

        // Act
        var result = await _controller.Create(createDto);

        // Assert
        var createdResult = Assert.IsType<CreatedAtRouteResult>(result.Result);
        Assert.Equal("GetTaskV1", createdResult.RouteName);
        Assert.True(createdResult.RouteValues!.TryGetValue("version", out var versionValue));
        Assert.Equal("1.0", versionValue);
        Assert.True(createdResult.RouteValues.TryGetValue("id", out var idValue));
        Assert.Equal(1, idValue);

        // Controller now returns TaskItemResponseDto, not TaskItem
        var responseDto = Assert.IsType<TaskItemResponseDto>(createdResult.Value);
        Assert.Equal(1, responseDto.Id);
        Assert.Equal("New Task", responseDto.Title);
        Assert.Equal("New Description", responseDto.Description);
        Assert.Equal("Todo", responseDto.Status);
        Assert.Equal("High", responseDto.Priority);
        Assert.Equal(dueDate, responseDto.DueDate);
    }

    [Fact]
    public async Task Create_ShouldAssignProject_WhenProjectExists()
    {
        var project = new Project { Id = 7, Name = "Alpha" };
        var createDto = new CreateTaskItemDto { Title = "New Task", ProjectId = 7 };
        TaskItem? captured = null;
        _mockProjectRepo.Setup(r => r.GetByIdAsync(7)).ReturnsAsync(project);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>()))
            .Callback<TaskItem>(t => captured = t)
            .ReturnsAsync((TaskItem t) =>
            {
                t.Id = 1;
                t.Project = project;
                return t;
            });
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(() => captured);

        var result = await _controller.Create(createDto);

        Assert.NotNull(captured);
        Assert.Equal(7, captured!.ProjectId);
        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var dto = Assert.IsType<TaskItemResponseDto>(created.Value);
        Assert.Equal(7, dto.ProjectId);
        Assert.Equal("Alpha", dto.ProjectName);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenProjectDoesNotExist()
    {
        var createDto = new CreateTaskItemDto { Title = "New Task", ProjectId = 999 };
        _mockProjectRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((Project?)null);

        var result = await _controller.Create(createDto);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.NotNull(unprocessable.Value);
        Assert.Contains("TASK_PROJECT_NOT_FOUND", unprocessable.Value!.ToString());
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldPreserveProject()
    {
        var existing = new TaskItem { Id = 3, Title = "Old", ProjectId = 7, Project = new Project { Id = 7, Name = "Alpha" } };
        _mockRepo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(existing);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());

        var result = await _controller.Update(3, new UpdateTaskItemDto { Title = "New" });

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<TaskItemResponseDto>(ok.Value);
        Assert.Equal(7, dto.ProjectId);
        Assert.Equal(7, existing.ProjectId);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenParentTaskDoesNotExist()
    {
        var createDto = new CreateTaskItemDto
        {
            Title = "New Task",
            Description = "Desc",
            ParentTaskItemId = 999
        };

        _mockRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Create(createDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenJournalDateIsPast()
    {
        var createDto = new CreateTaskItemDto
        {
            Title = "Task",
            JournalDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1))
        };

        var result = await _controller.Create(createDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenJournalDateIsYesterdayInUserTimezone()
    {
        // timezoneOffsetMinutes uses UTC-offset convention (negative = west of UTC)
        // User's "today" = utcNow + offset; a negative offset shifts the date earlier
        const int offsetMinutes = -300; // UTC-5 (e.g. CDT)
        var userYesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(offsetMinutes).AddDays(-1));

        var createDto = new CreateTaskItemDto
        {
            Title = "Task",
            JournalDate = userYesterday,
            TimezoneOffsetMinutes = offsetMinutes
        };

        var result = await _controller.Create(createDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldAssignToJournalDate_WhenJournalDateIsProvided()
    {
        var targetDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        var createDto = new CreateTaskItemDto
        {
            Title = "Scheduled task",
            JournalDate = targetDate
        };

        var createdTask = new TaskItem
        {
            Id = 77,
            Title = "Scheduled task",
            Status = Status.Todo
        };
        var entry = new JournalEntry { Id = 12, Date = targetDate, Title = "Journal" };

        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);
        _mockRepo.Setup(r => r.GetByIdAsync(77)).ReturnsAsync(createdTask);
        _mockJournalRepo.Setup(r => r.GetByDateAsync(targetDate)).ReturnsAsync(entry);
        _mockJournalRepo.Setup(r => r.AddTodoAsync(entry.Id, createdTask.Id)).ReturnsAsync(AddTodoResult.Success);

        var result = await _controller.Create(createDto);

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        _mockJournalRepo.Verify(r => r.AddTodoAsync(entry.Id, createdTask.Id), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldSucceedAndAttachToExistingEntry_WhenJournalDateRaceOccurs()
    {
        var targetDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        var createDto = new CreateTaskItemDto
        {
            Title = "Racy task",
            JournalDate = targetDate
        };

        var createdTask = new TaskItem
        {
            Id = 88,
            Title = "Racy task",
            Status = Status.Todo
        };
        var existingEntry = new JournalEntry { Id = 21, Date = targetDate, Title = "Journal" };

        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);
        _mockRepo.Setup(r => r.GetByIdAsync(88)).ReturnsAsync(createdTask);

        _mockJournalRepo.SetupSequence(r => r.GetByDateAsync(targetDate))
            .ReturnsAsync((JournalEntry?)null)
            .ReturnsAsync(existingEntry);
        _mockJournalRepo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>()))
            .ThrowsAsync(new DuplicateJournalDateException(targetDate));
        _mockJournalRepo.Setup(r => r.AddTodoAsync(existingEntry.Id, createdTask.Id, null))
            .ReturnsAsync(AddTodoResult.Success);

        var result = await _controller.Create(createDto);

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        _mockJournalRepo.Verify(r => r.AddTodoAsync(existingEntry.Id, createdTask.Id, null), Times.Once);
        _mockJournalRepo.Verify(r => r.GetByDateAsync(targetDate), Times.Exactly(2));
    }

    [Fact]
    public async Task Create_ShouldNeverTriggerCarryForward_WhenJournalDateIsProvided()
    {
        var targetDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        var createdTask = new TaskItem { Id = 91, Title = "Tomorrow", Status = Status.Todo };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);
        _mockRepo.Setup(r => r.GetByIdAsync(91)).ReturnsAsync(createdTask);
        _mockJournalRepo.Setup(r => r.GetByDateAsync(targetDate)).ReturnsAsync((JournalEntry?)null);
        _mockJournalRepo.Setup(r => r.AddAsync(It.IsAny<JournalEntry>()))
            .ReturnsAsync(new JournalEntry { Id = 4, Title = "J", Date = targetDate });

        var result = await _controller.Create(new CreateTaskItemDto { Title = "Tomorrow", JournalDate = targetDate, TimezoneOffsetMinutes = 0 });

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        _mockJournalRepo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldLeaveTodaysTasksOnToday_WhenTaskCreatedForTomorrow()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        await using var _ = connection;
        var options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(connection).Options;
        await using var context = new TaskDbContext(options);
        context.Database.EnsureCreated();

        var journalRepo = new JournalEntryRepository(context);
        var controller = new TaskItemsController(new TaskRepository(context), _mockValidator.Object, journalRepo, _mockProjectRepo.Object);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());

        const int offset = 0;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var todayEntry = await journalRepo.AddAsync(new JournalEntry { Title = "Today", Date = today });
        var todayTask = new TaskItem { Title = "Today task", Status = Status.Todo };
        context.TaskItems.Add(todayTask);
        await context.SaveChangesAsync();
        await journalRepo.AddTodoAsync(todayEntry.Id, todayTask.Id, offset);

        var result = await controller.Create(new CreateTaskItemDto
        {
            Title = "Tomorrow task",
            JournalDate = today.AddDays(1),
            TimezoneOffsetMinutes = offset
        });

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        var tomorrowEntry = await journalRepo.GetByDateAsync(today.AddDays(1));
        Assert.Equal("Tomorrow task", Assert.Single(tomorrowEntry!.Todos.Select(t => t.Title)));
        Assert.Single(await journalRepo.GetTodosAsync(todayEntry.Id), t => t.Id == todayTask.Id);
        Assert.Equal(0, context.TaskItems.Single(t => t.Id == todayTask.Id).MoveCount);
    }

    [Fact]
    public async Task Create_ShouldNotMoveOtherTasks_WhenJournalDateIsTomorrowAndTodayHasIncompleteTasks()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        await using var _ = connection;
        var options = new DbContextOptionsBuilder<TaskDbContext>().UseSqlite(connection).Options;
        await using var context = new TaskDbContext(options);
        context.Database.EnsureCreated();

        var journalRepo = new JournalEntryRepository(context);
        var controller = new TaskItemsController(new TaskRepository(context), _mockValidator.Object, journalRepo, _mockProjectRepo.Object);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());

        // Pick the offset that puts the user's local time at about noon, so a run can never straddle the
        // user's midnight and "today"/"tomorrow" stay stable between here and the controller's own clock read.
        var now = DateTime.UtcNow;
        var offset = 720 - (now.Hour * 60 + now.Minute);
        var today = UserDateHelper.GetUserToday(now, offset);
        var tomorrow = today.AddDays(1);
        var todayEntry = await journalRepo.AddAsync(new JournalEntry { Title = "Today", Date = today });
        var seeded = new List<TaskItem>();
        for (var i = 0; i < 3; i++)
        {
            var task = new TaskItem { Title = $"Seeded {i}", Status = Status.Todo };
            context.TaskItems.Add(task);
            await context.SaveChangesAsync();
            await journalRepo.AddTodoAsync(todayEntry.Id, task.Id, offset);
            seeded.Add(task);
        }

        var before = seeded.ToDictionary(t => t.Id, t => (t.CurrentJournalEntryId, t.MoveCount, t.FirstTaggedDate));
        var eventsBefore = await context.TaskItemEvents.CountAsync();
        Assert.Null(await journalRepo.GetByDateAsync(tomorrow));

        var result = await controller.Create(new CreateTaskItemDto
        {
            Title = "Tomorrow task",
            JournalDate = tomorrow,
            TimezoneOffsetMinutes = offset
        });

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        var tomorrowEntry = await journalRepo.GetByDateAsync(tomorrow);
        Assert.NotNull(tomorrowEntry);
        Assert.Equal("Tomorrow task", Assert.Single(tomorrowEntry!.Todos.Select(t => t.Title)));
        foreach (var task in seeded)
        {
            var reloaded = await context.TaskItems.AsNoTracking().SingleAsync(t => t.Id == task.Id);
            Assert.Equal(before[task.Id], (reloaded.CurrentJournalEntryId, reloaded.MoveCount, reloaded.FirstTaggedDate));
        }

        var seededIds = seeded.Select(t => t.Id).ToList();
        Assert.Equal(0, await context.TaskItemEvents.CountAsync(e => seededIds.Contains(e.TaskItemId) && e.EventType == "ReassignedToJournalDay"));
        Assert.Equal(eventsBefore, (await context.TaskItemEvents.CountAsync(e => seededIds.Contains(e.TaskItemId))));
        _mockJournalRepo.Verify(r => r.CarryForwardIncompleteTasksAsync(It.IsAny<int>(), It.IsAny<DateOnly>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldForwardTimezoneOffsetToAddTodoAsync_WhenJournalDateIsToday()
    {
        // User in UTC-5 (timezoneOffsetMinutes = -300). Their "today" = utcNow - 5h.
        // Before the fix, AddTodoAsync received no timezone offset and saw today as UTC today,
        // causing it to silently return PastDayNotAllowed and drop the journal link.
        const int offsetMinutes = -300;
        var userToday = DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(offsetMinutes));
        var createDto = new CreateTaskItemDto
        {
            Title = "Task for today",
            JournalDate = userToday,
            TimezoneOffsetMinutes = offsetMinutes
        };

        var createdTask = new TaskItem { Id = 55, Title = "Task for today", Status = Status.Todo };
        var entry = new JournalEntry { Id = 8, Date = userToday, Title = "Journal" };

        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);
        _mockRepo.Setup(r => r.GetByIdAsync(55)).ReturnsAsync(createdTask);
        _mockJournalRepo.Setup(r => r.GetByDateAsync(userToday)).ReturnsAsync(entry);
        _mockJournalRepo.Setup(r => r.AddTodoAsync(entry.Id, createdTask.Id, offsetMinutes))
            .ReturnsAsync(AddTodoResult.Success);

        var result = await _controller.Create(createDto);

        Assert.IsType<CreatedAtRouteResult>(result.Result);
        _mockJournalRepo.Verify(r => r.AddTodoAsync(entry.Id, createdTask.Id, offsetMinutes), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldReturnUnprocessableEntity_WhenParentWouldExceedOneLevelDepth()
    {
        var createDto = new CreateTaskItemDto
        {
            Title = "New Task",
            Description = "Desc",
            ParentTaskItemId = 5
        };

        _mockRepo.Setup(r => r.GetByIdAsync(5)).ReturnsAsync(new TaskItem
        {
            Id = 5,
            Title = "Existing Child",
            ParentTaskItemId = 1
        });

        var result = await _controller.Create(createDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnOkWithUpdatedTask_WhenValid()
    {
        // Arrange
        var dueDate = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Updated Task",
            Description = "Updated Description",
            Status = Status.Completed,
            Priority = Priority.Medium,
            DueDate = dueDate
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Old Task",
            Description = "Old",
            Status = Status.Completed,
            Priority = Priority.Low
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        // Controller now returns 200 OK with TaskItemResponseDto instead of 204 NoContent
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var responseDto = Assert.IsType<TaskItemResponseDto>(okResult.Value);
        Assert.Equal(1, responseDto.Id);
        Assert.Equal("Updated Task", responseDto.Title);
        Assert.Equal("Updated Description", responseDto.Description);
        Assert.Equal("Completed", responseDto.Status);
        Assert.Equal("Medium", responseDto.Priority);
        Assert.Equal(dueDate, responseDto.DueDate);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenTaskExists()
    {
        // Arrange
        var task = new TaskItem { Id = 1, Title = "Task 1", Description = "Description", Status = Status.Todo };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockRepo.Setup(r => r.DeleteAsync(1)).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Delete(1);

        // Assert
        Assert.IsType<NoContentResult>(result);
        _mockRepo.Verify(r => r.DeleteAsync(1), Times.Once);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        // Arrange
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync((TaskItem?)null);

        // Act
        var result = await _controller.Delete(1);

        // Assert
        Assert.IsType<NotFoundResult>(result);
        _mockRepo.Verify(r => r.DeleteAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task GetAll_ShouldReturnOkWithEmptyList_WhenNoTasks()
    {
        // Arrange
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([]);

        // Act
        var result = await _controller.GetAll();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(okResult.Value);
        Assert.Empty(dtos);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Once);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        // Arrange
        var createDto = new CreateTaskItemDto { Title = "", Description = "Description" };
        var validationFailures = new List<ValidationFailure>
        {
            new("Title", "Title is required.")
        };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult(validationFailures));

        // Act
        var result = await _controller.Create(createDto);

        // Assert
        var badRequestResult = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equivalent(validationFailures, badRequestResult.Value, strict: true);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldHandleTaskWithNullDescription()
    {
        // Arrange
        var createDto = new CreateTaskItemDto { Title = "Task", Description = null };
        var createdTask = new TaskItem { Id = 1, Title = "Task", Description = null };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);

        // Act
        var result = await _controller.Create(createDto);

        // Assert
        var createdResult = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var dto = Assert.IsType<TaskItemResponseDto>(createdResult.Value);
        Assert.Equal("Task", dto.Title);
        Assert.Null(dto.Description);
        Assert.Equal("Draft", dto.Status);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto { Title = "Updated Task", Description = "Updated Description", Status = Status.Completed };
        _mockRepo.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((TaskItem?)null);

        // Act
        var result = await _controller.Update(999, updateDto);

        // Assert
        Assert.IsType<NotFoundResult>(result.Result);
        _mockRepo.Verify(r => r.GetByIdAsync(999), Times.Once);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnBadRequest_WhenValidationFails()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto { Title = "", Description = "Description", Status = Status.Completed };
        var existingTask = new TaskItem { Id = 1, Title = "Old Task", Description = "Old Description", Status = Status.Todo };
        var validationFailures = new List<ValidationFailure>
        {
            new("Title", "Title is required.")
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult(validationFailures));

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        var badRequestResult = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equivalent(validationFailures, badRequestResult.Value, strict: true);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldPreserveExistingPriority_WhenPriorityOmitted()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Updated Task",
            Description = "Updated Description",
            Status = Status.Completed,
            Priority = null // omitted — should preserve existing priority
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Old Task",
            Description = "Old",
            Status = Status.Completed,
            Priority = Priority.High
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var responseDto = Assert.IsType<TaskItemResponseDto>(okResult.Value);
        Assert.Equal("High", responseDto.Priority); // Priority preserved from existing task
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenReopeningTaskAssignedToPastDay()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low
        };

        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(yesterday);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.NotNull(unprocessable.Value);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldAllowReopeningTaskAssignedToToday()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low
        };

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(today);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        Assert.IsType<OkObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Theory]
    [InlineData(840)]
    [InlineData(-720)]
    public async Task Update_ShouldAllowReopeningTaskAssignedToUserLocalToday_WhenOffsetSupplied(int offset)
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            TimezoneOffsetMinutes = offset
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low
        };

        var utcNow = DateTime.UtcNow;
        var localToday = UserDateHelper.GetUserToday(utcNow, offset);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(localToday);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(1, updateDto);

        Assert.IsType<OkObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Theory]
    [InlineData(840)]
    [InlineData(-720)]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenReopeningTaskAssignedBeforeUserLocalToday(int offset)
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            TimezoneOffsetMinutes = offset
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low
        };

        var utcNow = DateTime.UtcNow;
        var assignedDate = UserDateHelper.GetUserToday(utcNow, offset).AddDays(-1);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(assignedDate);

        var result = await _controller.Update(1, updateDto);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var value = unprocessable.Value!;
        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", value.GetType().GetProperty("code")!.GetValue(value));
        Assert.Equal("Completed tasks assigned to past days cannot be reopened.", value.GetType().GetProperty("message")!.GetValue(value));
        var details = value.GetType().GetProperty("details")!.GetValue(value)!;
        Assert.Equal(assignedDate, details.GetType().GetProperty("assignedDate")!.GetValue(details));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenAssignedDateIsUtcTodayButBeforeLocalTodayAtFarAheadOffset()
    {
        // Offset +1440 puts the local date exactly one day ahead of the UTC date at every UTC hour,
        // so assigned = UTC today is "yesterday" locally. A UTC-only "today" would wrongly allow it.
        const int offset = 1440;
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            TimezoneOffsetMinutes = offset
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low
        };

        var utcNow = DateTime.UtcNow;
        var assignedDate = DateOnly.FromDateTime(utcNow);
        Assert.Equal(assignedDate.AddDays(1), UserDateHelper.GetUserToday(utcNow, offset));
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1)).ReturnsAsync(assignedDate);

        var result = await _controller.Update(1, updateDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldUseUtcToday_WhenOffsetMissing_AndAllowReopeningTaskAssignedToUtcToday()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            TimezoneOffsetMinutes = null
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1))
            .ReturnsAsync(DateOnly.FromDateTime(DateTime.UtcNow));
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(1, updateDto);

        Assert.IsType<OkObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldUseUtcToday_WhenOffsetMissing_AndRejectReopeningTaskAssignedToUtcYesterday()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            TimezoneOffsetMinutes = null
        };
        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetAssignedJournalDateAsync(1))
            .ReturnsAsync(DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1));

        var result = await _controller.Update(1, updateDto);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var value = unprocessable.Value!;
        Assert.Equal("TASK_REOPEN_PAST_DAY_NOT_ALLOWED", value.GetType().GetProperty("code")!.GetValue(value));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenParentTaskMatchesSelf()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 1
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);

        var result = await _controller.Update(1, updateDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenParentTaskDoesNotExist()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 12
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.Update(1, updateDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenParentWouldExceedOneLevelDepth()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 12
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Task",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync(new TaskItem
        {
            Id = 12,
            Title = "Existing Child",
            ParentTaskItemId = 4
        });

        var result = await _controller.Update(1, updateDto);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenTaskWithChildrenIsAssignedParent()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Existing Parent",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 12
        };

        var existingTask = new TaskItem
        {
            Id = 1,
            Title = "Existing Parent",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };

        var parentCandidate = new TaskItem
        {
            Id = 12,
            Title = "New Parent",
            Status = Status.Todo,
            Priority = Priority.Low
        };

        var existingChild = new TaskItem
        {
            Id = 2,
            Title = "Child",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 1
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync(parentCandidate);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([existingChild]);

        var result = await _controller.Update(1, updateDto);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Contains("TASK_PARENT_DEPTH_NOT_ALLOWED", System.Text.Json.JsonSerializer.Serialize(unprocessable.Value));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnUnprocessableEntity_WhenCompletingParentWithOpenChildren()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Parent",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low,
            ParentTaskItemId = null
        };

        var parentTask = new TaskItem
        {
            Id = 1,
            Title = "Parent",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };

        var childTask = new TaskItem
        {
            Id = 2,
            Title = "Child",
            Description = "Desc",
            Status = Status.Todo,
            ParentTaskItemId = 1
        };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(parentTask);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([childTask]);

        var result = await _controller.Update(1, updateDto);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Contains("TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN", System.Text.Json.JsonSerializer.Serialize(unprocessable.Value));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnDepthError_WhenProposedParentIsAGrandchild()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Root",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 3
        };

        var root = new TaskItem { Id = 1, Title = "Root", Status = Status.Todo };
        var child = new TaskItem { Id = 2, Title = "Child", Status = Status.Todo, ParentTaskItemId = 1 };
        var grandchild = new TaskItem { Id = 3, Title = "Grandchild", Status = Status.Todo, ParentTaskItemId = 2 };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(root);
        _mockRepo.Setup(r => r.GetByIdAsync(3)).ReturnsAsync(grandchild);

        var result = await _controller.Update(1, updateDto);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Contains("TASK_PARENT_DEPTH_NOT_ALLOWED", System.Text.Json.JsonSerializer.Serialize(unprocessable.Value));
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<TaskItem>()), Times.Never);
    }

    [Fact]
    public async Task GetHistory_ShouldReturnNotFound_WhenTaskDoesNotExist()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(7)).ReturnsAsync((TaskItem?)null);

        var result = await _controller.GetHistory(7);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetHistory_ShouldReturnOk_WhenTaskExists()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new TaskItem { Id = 1, Title = "Task" });
        _mockRepo.Setup(r => r.GetHistoryAsync(1)).ReturnsAsync([
            new TaskItemEvent
            {
                Id = 10,
                TaskItemId = 1,
                EventType = "AssignedToJournalDay",
                OccurredAtUtc = DateTime.UtcNow,
                ToJournalEntryId = 3,
                ToJournalDate = DateOnly.FromDateTime(DateTime.UtcNow),
                ChangeSummary = "Task was assigned to a journal day."
            }
        ]);

        var result = await _controller.GetHistory(1);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var history = Assert.IsAssignableFrom<IEnumerable<TaskItemEventResponseDto>>(okResult.Value);
        Assert.Single(history, e => e.Id == 10 && e.EventType == "AssignedToJournalDay");
    }

    [Fact]
    public async Task Delete_ShouldReturnUnprocessableEntity_WhenTaskHasChildren()
    {
        var parent = new TaskItem { Id = 1, Title = "Parent" };
        var child = new TaskItem { Id = 2, Title = "Child", ParentTaskItemId = 1 };

        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(parent);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([child]);

        var result = await _controller.Delete(1);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result);
        Assert.Contains("TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN", System.Text.Json.JsonSerializer.Serialize(unprocessable.Value));
        _mockRepo.Verify(r => r.DeleteAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenTaskHasNoChildren()
    {
        var task = new TaskItem { Id = 1, Title = "Task" };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(task);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([]);

        var result = await _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
        _mockRepo.Verify(r => r.DeleteAsync(1), Times.Once);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldAutoCompleteParent_WhenEnabledAndLastChildCompletes()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Child",
            Description = "Desc",
            Status = Status.Completed,
            Priority = Priority.Low,
            ParentTaskItemId = 10,
            AutoCompleteParentWhenChildrenDone = true
        };

        var child = new TaskItem
        {
            Id = 2,
            Title = "Child",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low,
            ParentTaskItemId = 10
        };
        var parent = new TaskItem
        {
            Id = 10,
            Title = "Parent",
            Description = "Desc",
            Status = Status.Todo,
            Priority = Priority.Low
        };

        _mockRepo.Setup(r => r.GetByIdAsync(2)).ReturnsAsync(child);
        _mockRepo.Setup(r => r.GetByIdAsync(10)).ReturnsAsync(parent);
        _mockRepo.Setup(r => r.GetChildrenAsync(10)).ReturnsAsync([
            new TaskItem { Id = 2, Title = "Child", Status = Status.Completed, ParentTaskItemId = 10 }
        ]);
        _mockRepo.Setup(r => r.GetChildrenAsync(2)).ReturnsAsync([]);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(2, updateDto);

        Assert.IsType<OkObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.Is<TaskItem>(t => t.Id == 2)), Times.Once);
        _mockRepo.Verify(r => r.UpdateAsync(It.Is<TaskItem>(t => t.Id == 10 && t.Status == Status.Completed)), Times.Once);
    }

    [Fact]
    public async Task Get_ReturnsChildTaskCount_ComputedOnce()
    {
        // Arrange
        var parent = new TaskItem { Id = 1, Title = "Parent", Status = Status.Todo, Priority = Priority.Low };
        var children = new List<TaskItem>
        {
            new() { Id = 2, Title = "Child 1", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 1 },
            new() { Id = 3, Title = "Child 2", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 1 }
        };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(parent);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync(children);

        // Act
        var result = await _controller.Get(1);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<TaskItemResponseDto>(okResult.Value);
        Assert.Equal(2, dto.ChildTaskCount);
        _mockRepo.Verify(r => r.GetChildrenAsync(1), Times.Once);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Never);
    }

    [Fact]
    public void Get_ResponseDto_DoesNotExposeChildCount_ReflectionGuard()
    {
        // Assert: ChildCount must never be reintroduced; ChildTaskCount is the sole source of truth.
        Assert.Null(typeof(TaskItemResponseDto).GetProperty("ChildCount"));
        Assert.NotNull(typeof(TaskItemResponseDto).GetProperty("ChildTaskCount"));
    }

    [Fact]
    public async Task Create_ReturnsZeroChildTaskCount_WithoutChildQuery()
    {
        // Arrange
        var createDto = new CreateTaskItemDto
        {
            Title = "New Parent",
            Status = Status.Todo,
            Priority = Priority.Medium
        };
        var createdTask = new TaskItem { Id = 1, Title = createDto.Title, Status = createDto.Status, Priority = createDto.Priority };
        var refreshedTask = new TaskItem { Id = 1, Title = createDto.Title, Status = createDto.Status, Priority = createDto.Priority };
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<TaskItem>())).ReturnsAsync(createdTask);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(refreshedTask);

        // Act
        var result = await _controller.Create(createDto);

        // Assert
        var createdResult = Assert.IsType<CreatedAtRouteResult>(result.Result);
        var responseDto = Assert.IsType<TaskItemResponseDto>(createdResult.Value);
        Assert.Equal(0, responseDto.ChildTaskCount);
        _mockRepo.Verify(r => r.GetChildrenAsync(It.IsAny<int>()), Times.Never);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Never);
    }

    [Fact]
    public async Task Update_ReturnsCorrectChildTaskCount()
    {
        // Arrange
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Updated Parent",
            Status = Status.Todo,
            Priority = Priority.Low
        };
        var existingTask = new TaskItem { Id = 1, Title = "Old Parent", Status = Status.Todo, Priority = Priority.Low };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existingTask);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default))
            .ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync(
        [
            new TaskItem { Id = 2, Title = "Child 1", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 1 },
            new TaskItem { Id = 3, Title = "Child 2", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 1 },
            new TaskItem { Id = 4, Title = "Child 3", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 1 }
        ]);

        // Act
        var result = await _controller.Update(1, updateDto);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var responseDto = Assert.IsType<TaskItemResponseDto>(okResult.Value);
        Assert.Equal(3, responseDto.ChildTaskCount);
        _mockRepo.Verify(r => r.GetChildrenAsync(1), Times.Once);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldCallGetAllAsyncNever_WhenReassigningParent()
    {
        var updateDto = new UpdateTaskItemDto { Title = "T", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 12 };
        var existing = new TaskItem { Id = 1, Title = "T", Status = Status.Todo, Priority = Priority.Low };
        var newParent = new TaskItem { Id = 12, Title = "P", Status = Status.Todo, Priority = Priority.Low };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync(newParent);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(1, updateDto);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(12, existing.ParentTaskItemId);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldQueryChildrenOnce_WhenSettingParentAndCompleting()
    {
        var updateDto = new UpdateTaskItemDto { Title = "T", Status = Status.Completed, Priority = Priority.Low, ParentTaskItemId = 12 };
        var existing = new TaskItem { Id = 1, Title = "T", Status = Status.Todo, Priority = Priority.Low };
        var newParent = new TaskItem { Id = 12, Title = "P", Status = Status.Todo, Priority = Priority.Low };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockRepo.Setup(r => r.GetByIdAsync(12)).ReturnsAsync(newParent);
        _mockRepo.Setup(r => r.GetChildrenAsync(1)).ReturnsAsync([]);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        var result = await _controller.Update(1, updateDto);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(0, Assert.IsType<TaskItemResponseDto>(okResult.Value).ChildTaskCount);
        _mockRepo.Verify(r => r.GetChildrenAsync(1), Times.Once);
        _mockRepo.Verify(r => r.GetAllAsync(), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldQueryChildrenOnlyForResponseCount_WhenNeitherParentSetNorCompleting()
    {
        var updateDto = new UpdateTaskItemDto { Title = "T", Status = Status.Todo, Priority = Priority.Low };
        var existing = new TaskItem { Id = 1, Title = "T", Status = Status.Todo, Priority = Priority.Low };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        await _controller.Update(1, updateDto);

        // Only the response mapping asks for the child count.
        _mockRepo.Verify(r => r.GetChildrenAsync(1), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldNotAutoCompleteParent_WhenParentHasNoChildren()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Child",
            Status = Status.Completed,
            Priority = Priority.Low,
            ParentTaskItemId = 10,
            AutoCompleteParentWhenChildrenDone = true
        };
        var child = new TaskItem { Id = 2, Title = "Child", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 10 };
        var parent = new TaskItem { Id = 10, Title = "Parent", Status = Status.Todo, Priority = Priority.Low };
        _mockRepo.Setup(r => r.GetByIdAsync(2)).ReturnsAsync(child);
        _mockRepo.Setup(r => r.GetByIdAsync(10)).ReturnsAsync(parent);
        _mockRepo.Setup(r => r.GetChildrenAsync(10)).ReturnsAsync([]);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        await _controller.Update(2, updateDto);

        _mockRepo.Verify(r => r.UpdateAsync(It.Is<TaskItem>(t => t.Id == 10)), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldNotQueryChildrenOfParent_WhenParentIsBlocked()
    {
        var updateDto = new UpdateTaskItemDto
        {
            Title = "Child",
            Status = Status.Completed,
            Priority = Priority.Low,
            ParentTaskItemId = 10,
            AutoCompleteParentWhenChildrenDone = true
        };
        var child = new TaskItem { Id = 2, Title = "Child", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 10 };
        var parent = new TaskItem { Id = 10, Title = "Parent", Status = Status.Blocked, Priority = Priority.Low };
        _mockRepo.Setup(r => r.GetByIdAsync(2)).ReturnsAsync(child);
        _mockRepo.Setup(r => r.GetByIdAsync(10)).ReturnsAsync(parent);
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<TaskItem>(), default)).ReturnsAsync(new ValidationResult());
        _mockRepo.Setup(r => r.UpdateAsync(It.IsAny<TaskItem>())).Returns(Task.CompletedTask);

        await _controller.Update(2, updateDto);

        _mockRepo.Verify(r => r.GetChildrenAsync(10), Times.Never);
        _mockRepo.Verify(r => r.UpdateAsync(It.Is<TaskItem>(t => t.Id == 10)), Times.Never);
    }

    [Fact]
    public async Task GetAll_ChildTaskCount_MatchesDictionaryLookup()
    {
        // Arrange
        var tasks = new List<TaskItem>
        {
            new() { Id = 1, Title = "Parent", Status = Status.Todo, Priority = Priority.Low },
            new() { Id = 2, Title = "Child 1", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 1 },
            new() { Id = 3, Title = "Child 2", Status = Status.Todo, Priority = Priority.Low, ParentTaskItemId = 1 },
            new() { Id = 4, Title = "Unrelated", Status = Status.Todo, Priority = Priority.Low }
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync(tasks);

        // Act
        var result = await _controller.GetAll();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(okResult.Value).ToList();
        Assert.Equal(2, dtos.Single(d => d.Id == 1).ChildTaskCount);
        Assert.Equal(0, dtos.Single(d => d.Id == 2).ChildTaskCount);
        Assert.Equal(0, dtos.Single(d => d.Id == 4).ChildTaskCount);
    }
}
