using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TaskFlow.Api.Controllers.V1;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Tests.Controllers.V1;

public class ProjectsControllerV1Tests
{
    private readonly Mock<IProjectRepository> _mockRepo = new();
    private readonly Mock<IValidator<Project>> _mockValidator = new();
    private readonly Mock<IValidator<AssignProjectTaskDto>> _mockAssignValidator = new();
    private readonly ProjectsController _controller;

    public ProjectsControllerV1Tests()
    {
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Project>(), default)).ReturnsAsync(new ValidationResult());
        _mockAssignValidator.Setup(v => v.ValidateAsync(It.IsAny<AssignProjectTaskDto>(), default)).ReturnsAsync(new ValidationResult());
        _controller = new ProjectsController(_mockRepo.Object, _mockValidator.Object, _mockAssignValidator.Object);
    }

    private static ValidationResult Invalid() =>
        new([new ValidationFailure("Name", "Name is required.")]);

    [Fact]
    public async Task GetAll_ShouldReturnProjectsWithTaskCounts()
    {
        var project = new Project
        {
            Id = 1,
            Name = "Alpha",
            Tasks =
            [
                new TaskItem { Id = 1, Title = "Open", Status = Status.Todo },
                new TaskItem { Id = 2, Title = "Draft", Status = Status.Draft },
                new TaskItem { Id = 3, Title = "Done status", Status = Status.Completed },
            ]
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([project]);

        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsAssignableFrom<IEnumerable<ProjectResponseDto>>(ok.Value).Single();
        Assert.Equal(2, dto.OpenTaskCount);
        Assert.Equal(1, dto.CompletedTaskCount);
    }

    [Fact]
    public async Task GetAll_ShouldCountBlockedTasksAsOpenAndReportBlockedCount()
    {
        var project = new Project
        {
            Id = 1,
            Name = "Alpha",
            Tasks =
            [
                new TaskItem { Id = 1, Title = "Open", Status = Status.Todo },
                new TaskItem { Id = 2, Title = "Blocked 1", Status = Status.Blocked },
                new TaskItem { Id = 3, Title = "Blocked 2", Status = Status.Blocked },
                new TaskItem { Id = 4, Title = "Done", Status = Status.Completed },
            ]
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([project]);

        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsAssignableFrom<IEnumerable<ProjectResponseDto>>(ok.Value).Single();
        Assert.Equal(3, dto.OpenTaskCount);
        Assert.Equal(2, dto.BlockedCount);
        Assert.Equal(1, dto.CompletedTaskCount);
    }

    [Fact]
    public async Task GetAll_ShouldCountInProgressTasksAsOpen()
    {
        var project = new Project
        {
            Id = 1,
            Name = "Alpha",
            Tasks =
            [
                new TaskItem { Id = 1, Title = "Open", Status = Status.Todo },
                new TaskItem { Id = 2, Title = "Started", Status = Status.InProgress },
                new TaskItem { Id = 3, Title = "Done", Status = Status.Completed },
            ]
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([project]);

        var result = await _controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsAssignableFrom<IEnumerable<ProjectResponseDto>>(ok.Value).Single();
        Assert.Equal(2, dto.OpenTaskCount);
        Assert.Equal(1, dto.CompletedTaskCount);
    }

    [Fact]
    public async Task GetTasks_ShouldIncludeStartedAt_ForInProgressTask()
    {
        var project = new Project { Id = 1, Name = "Alpha" };
        var startedAt = new DateTime(2026, 10, 3, 9, 0, 0, DateTimeKind.Utc);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(project);
        _mockRepo.Setup(r => r.GetTasksAsync(1)).ReturnsAsync(
        [
            new TaskItem { Id = 4, Title = "T", ProjectId = 1, Project = project, Status = Status.InProgress, StartedAt = startedAt },
            new TaskItem { Id = 5, Title = "Plain", ProjectId = 1, Project = project, Status = Status.Todo }
        ]);

        var result = await _controller.GetTasks(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        var started = dtos.Single(d => d.Id == 4);
        Assert.Equal("InProgress", started.Status);
        Assert.Equal(startedAt, started.StartedAt);
        Assert.Null(dtos.Single(d => d.Id == 5).StartedAt);
    }

    [Fact]
    public async Task GetTasks_ShouldIncludeBlockedTasksWithBlockedFields()
    {
        var project = new Project { Id = 1, Name = "Alpha" };
        var blockedAt = new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(project);
        _mockRepo.Setup(r => r.GetTasksAsync(1)).ReturnsAsync(
        [
            new TaskItem
            {
                Id = 4,
                Title = "T",
                ProjectId = 1,
                Project = project,
                Status = Status.Blocked,
                BlockedReason = "Waiting",
                BlockedAt = blockedAt,
                PreviousStatus = Status.Todo
            },
            new TaskItem { Id = 5, Title = "Plain", ProjectId = 1, Project = project, Status = Status.Todo }
        ]);

        var result = await _controller.GetTasks(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dtos = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).ToList();
        var blocked = dtos.Single(d => d.Id == 4);
        Assert.Equal("Blocked", blocked.Status);
        Assert.Equal("Waiting", blocked.BlockedReason);
        Assert.Equal(blockedAt, blocked.BlockedAt);
        Assert.Equal("Todo", blocked.PreviousStatus);
        var plain = dtos.Single(d => d.Id == 5);
        Assert.Null(plain.BlockedReason);
        Assert.Null(plain.BlockedAt);
        Assert.Null(plain.PreviousStatus);
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.Get(9);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Get_ShouldReturnOk_WhenFound()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "Alpha" });

        var result = await _controller.Get(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("Alpha", Assert.IsType<ProjectResponseDto>(ok.Value).Name);
    }

    [Fact]
    public async Task GetTasks_ShouldReturnNotFound_WhenProjectMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.GetTasks(9);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetTasks_ShouldReturnMappedTasks()
    {
        var project = new Project { Id = 1, Name = "Alpha" };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(project);
        _mockRepo.Setup(r => r.GetTasksAsync(1)).ReturnsAsync(
            [new TaskItem { Id = 4, Title = "T", ProjectId = 1, Project = project, Priority = Priority.High, Status = Status.Todo }]);

        var result = await _controller.GetTasks(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).Single();
        Assert.Equal(1, dto.ProjectId);
        Assert.Equal("Alpha", dto.ProjectName);
        Assert.Equal("High", dto.Priority);
        Assert.Equal("Todo", dto.Status);
    }

    [Fact]
    public async Task GetTasks_ShouldExposeCompletionOnlyThroughStatus()
    {
        var project = new Project { Id = 1, Name = "Alpha" };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(project);
        _mockRepo.Setup(r => r.GetTasksAsync(1)).ReturnsAsync(
            [new TaskItem { Id = 4, Title = "T", ProjectId = 1, Project = project, Status = Status.Completed }]);

        var result = await _controller.GetTasks(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsAssignableFrom<IEnumerable<TaskItemResponseDto>>(ok.Value).Single();
        Assert.Equal("Completed", dto.Status);
        Assert.Null(typeof(TaskItemResponseDto).GetProperty("IsComplete"));
    }

    [Fact]
    public async Task Create_ShouldReturnCreated_WhenValid()
    {
        _mockRepo.Setup(r => r.NameExistsAsync("Alpha", null)).ReturnsAsync(false);
        _mockRepo.Setup(r => r.AddAsync(It.IsAny<Project>())).ReturnsAsync((Project p) =>
        {
            p.Id = 5;
            return p;
        });

        var result = await _controller.Create(new CreateProjectDto { Name = "  Alpha  ", Description = "d" });

        var created = Assert.IsType<CreatedAtRouteResult>(result.Result);
        Assert.Equal("GetProjectV1", created.RouteName);
        Assert.True(created.RouteValues!.TryGetValue("id", out var createdId));
        Assert.Equal(5, createdId);
        Assert.Equal("Alpha", Assert.IsType<ProjectResponseDto>(created.Value).Name);
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Project>(), default)).ReturnsAsync(Invalid());

        var result = await _controller.Create(new CreateProjectDto { Name = "" });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnConflict_WhenNameExists()
    {
        _mockRepo.Setup(r => r.NameExistsAsync("Alpha", null)).ReturnsAsync(true);

        var result = await _controller.Create(new CreateProjectDto { Name = "Alpha" });

        Assert.IsType<ConflictObjectResult>(result.Result);
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.Update(9, new UpdateProjectDto { Name = "X" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Update_ShouldApplyChangesAndArchive()
    {
        var existing = new Project { Id = 1, Name = "Old" };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockRepo.Setup(r => r.NameExistsAsync("New", 1)).ReturnsAsync(false);

        var result = await _controller.Update(1, new UpdateProjectDto { Name = "New", Description = "d", IsArchived = true });

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("New", existing.Name);
        Assert.True(existing.IsArchived);
        _mockRepo.Verify(r => r.UpdateAsync(existing), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldReturnBadRequest_WhenValidationFails()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "Old" });
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Project>(), default)).ReturnsAsync(Invalid());

        var result = await _controller.Update(1, new UpdateProjectDto { Name = "" });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnConflict_WhenNameTakenByAnotherProject()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "Old" });
        _mockRepo.Setup(r => r.NameExistsAsync("Taken", 1)).ReturnsAsync(true);

        var result = await _controller.Update(1, new UpdateProjectDto { Name = "Taken" });

        Assert.IsType<ConflictObjectResult>(result.Result);
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.Delete(9);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenFound()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "A" });

        var result = await _controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
        _mockRepo.Verify(r => r.DeleteAsync(1), Times.Once);
    }

    [Theory]
    [InlineData(AssignTaskResult.Success, typeof(NoContentResult))]
    [InlineData(AssignTaskResult.ProjectNotFound, typeof(NotFoundResult))]
    [InlineData(AssignTaskResult.TaskNotFound, typeof(NotFoundResult))]
    [InlineData(AssignTaskResult.AlreadyAssigned, typeof(ConflictObjectResult))]
    public async Task AssignTask_ShouldMapRepositoryResult(AssignTaskResult repoResult, Type expected)
    {
        _mockRepo.Setup(r => r.AssignTaskAsync(1, 2)).ReturnsAsync(repoResult);

        var result = await _controller.AssignTask(1, new AssignProjectTaskDto { TaskItemId = 2 });

        Assert.IsType(expected, result);
    }

    // TaskFlow.Web (lib/project-errors.ts) recognises the 409 conflict by this message, because
    // the generated client throws only the parsed body. Update both if the wording changes.
    [Fact]
    public async Task AssignTask_ConflictMessage_ShouldMatchPatternUsedByFrontend()
    {
        _mockRepo.Setup(r => r.AssignTaskAsync(1, 2)).ReturnsAsync(AssignTaskResult.AlreadyAssigned);

        var result = await _controller.AssignTask(1, new AssignProjectTaskDto { TaskItemId = 2 });

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        var message = conflict.Value!.GetType().GetProperty("message")!.GetValue(conflict.Value) as string;
        Assert.Matches("(?i)already (assigned|in)", message);
    }

    [Fact]
    public async Task AssignTask_ShouldReturnBadRequest_WhenValidationFails()
    {
        _mockAssignValidator.Setup(v => v.ValidateAsync(It.IsAny<AssignProjectTaskDto>(), default)).ReturnsAsync(Invalid());

        var result = await _controller.AssignTask(1, new AssignProjectTaskDto { TaskItemId = 0 });

        Assert.IsType<BadRequestObjectResult>(result);
        _mockRepo.Verify(r => r.AssignTaskAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task UnassignTask_ShouldReturnNoContent_WhenRemoved()
    {
        _mockRepo.Setup(r => r.UnassignTaskAsync(1, 2)).ReturnsAsync(true);

        var result = await _controller.UnassignTask(1, 2);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task UnassignTask_ShouldReturnNotFound_WhenTaskNotInProject()
    {
        _mockRepo.Setup(r => r.UnassignTaskAsync(1, 2)).ReturnsAsync(false);

        var result = await _controller.UnassignTask(1, 2);

        Assert.IsType<NotFoundResult>(result);
    }
}
