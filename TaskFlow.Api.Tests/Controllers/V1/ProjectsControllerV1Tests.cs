using FluentAssertions;
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
                new TaskItem { Id = 2, Title = "Done flag", IsComplete = true },
                new TaskItem { Id = 3, Title = "Done status", Status = Status.Completed },
            ]
        };
        _mockRepo.Setup(r => r.GetAllAsync()).ReturnsAsync([project]);

        var result = await _controller.GetAll();

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeAssignableTo<IEnumerable<ProjectResponseDto>>().Subject.Single();
        dto.OpenTaskCount.Should().Be(1);
        dto.CompletedTaskCount.Should().Be(2);
    }

    [Fact]
    public async Task Get_ShouldReturnNotFound_WhenMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.Get(9);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Get_ShouldReturnOk_WhenFound()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "Alpha" });

        var result = await _controller.Get(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        ok.Value.Should().BeOfType<ProjectResponseDto>().Which.Name.Should().Be("Alpha");
    }

    [Fact]
    public async Task GetTasks_ShouldReturnNotFound_WhenProjectMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.GetTasks(9);

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetTasks_ShouldReturnMappedTasks()
    {
        var project = new Project { Id = 1, Name = "Alpha" };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(project);
        _mockRepo.Setup(r => r.GetTasksAsync(1)).ReturnsAsync(
            [new TaskItem { Id = 4, Title = "T", ProjectId = 1, Project = project, Priority = Priority.High, Status = Status.Todo }]);

        var result = await _controller.GetTasks(1);

        var ok = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ok.Value.Should().BeAssignableTo<IEnumerable<TaskItemResponseDto>>().Subject.Single();
        dto.ProjectId.Should().Be(1);
        dto.ProjectName.Should().Be("Alpha");
        dto.Priority.Should().Be("High");
        dto.Status.Should().Be("Todo");
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

        var created = result.Result.Should().BeOfType<CreatedAtRouteResult>().Subject;
        created.RouteName.Should().Be("GetProjectV1");
        created.RouteValues.Should().ContainKey("id").WhoseValue.Should().Be(5);
        created.Value.Should().BeOfType<ProjectResponseDto>().Which.Name.Should().Be("Alpha");
    }

    [Fact]
    public async Task Create_ShouldReturnBadRequest_WhenValidationFails()
    {
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Project>(), default)).ReturnsAsync(Invalid());

        var result = await _controller.Create(new CreateProjectDto { Name = "" });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Create_ShouldReturnConflict_WhenNameExists()
    {
        _mockRepo.Setup(r => r.NameExistsAsync("Alpha", null)).ReturnsAsync(true);

        var result = await _controller.Create(new CreateProjectDto { Name = "Alpha" });

        result.Result.Should().BeOfType<ConflictObjectResult>();
        _mockRepo.Verify(r => r.AddAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnNotFound_WhenMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.Update(9, new UpdateProjectDto { Name = "X" });

        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_ShouldApplyChangesAndArchive()
    {
        var existing = new Project { Id = 1, Name = "Old" };
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(existing);
        _mockRepo.Setup(r => r.NameExistsAsync("New", 1)).ReturnsAsync(false);

        var result = await _controller.Update(1, new UpdateProjectDto { Name = "New", Description = "d", IsArchived = true });

        result.Result.Should().BeOfType<OkObjectResult>();
        existing.Name.Should().Be("New");
        existing.IsArchived.Should().BeTrue();
        _mockRepo.Verify(r => r.UpdateAsync(existing), Times.Once);
    }

    [Fact]
    public async Task Update_ShouldReturnBadRequest_WhenValidationFails()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "Old" });
        _mockValidator.Setup(v => v.ValidateAsync(It.IsAny<Project>(), default)).ReturnsAsync(Invalid());

        var result = await _controller.Update(1, new UpdateProjectDto { Name = "" });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Update_ShouldReturnConflict_WhenNameTakenByAnotherProject()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "Old" });
        _mockRepo.Setup(r => r.NameExistsAsync("Taken", 1)).ReturnsAsync(true);

        var result = await _controller.Update(1, new UpdateProjectDto { Name = "Taken" });

        result.Result.Should().BeOfType<ConflictObjectResult>();
        _mockRepo.Verify(r => r.UpdateAsync(It.IsAny<Project>()), Times.Never);
    }

    [Fact]
    public async Task Delete_ShouldReturnNotFound_WhenMissing()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(9)).ReturnsAsync((Project?)null);

        var result = await _controller.Delete(9);

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Delete_ShouldReturnNoContent_WhenFound()
    {
        _mockRepo.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new Project { Id = 1, Name = "A" });

        var result = await _controller.Delete(1);

        result.Should().BeOfType<NoContentResult>();
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

        result.Should().BeOfType(expected);
    }

    [Fact]
    public async Task AssignTask_ShouldReturnBadRequest_WhenValidationFails()
    {
        _mockAssignValidator.Setup(v => v.ValidateAsync(It.IsAny<AssignProjectTaskDto>(), default)).ReturnsAsync(Invalid());

        var result = await _controller.AssignTask(1, new AssignProjectTaskDto { TaskItemId = 0 });

        result.Should().BeOfType<BadRequestObjectResult>();
        _mockRepo.Verify(r => r.AssignTaskAsync(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task UnassignTask_ShouldReturnNoContent_WhenRemoved()
    {
        _mockRepo.Setup(r => r.UnassignTaskAsync(1, 2)).ReturnsAsync(true);

        var result = await _controller.UnassignTask(1, 2);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task UnassignTask_ShouldReturnNotFound_WhenTaskNotInProject()
    {
        _mockRepo.Setup(r => r.UnassignTaskAsync(1, 2)).ReturnsAsync(false);

        var result = await _controller.UnassignTask(1, 2);

        result.Should().BeOfType<NotFoundResult>();
    }
}
