using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class ProjectsController(
    IProjectRepository repo,
    IValidator<Project> validator,
    IValidator<AssignProjectTaskDto> assignValidator) : ControllerBase
{
    private const string GetProjectRouteName = "GetProjectV1";
    private const string ApiVersionString = "1.0";
    private readonly IProjectRepository _repo = repo;
    private readonly IValidator<Project> _validator = validator;
    private readonly IValidator<AssignProjectTaskDto> _assignValidator = assignValidator;

    // GET: api/v1/Projects
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ProjectResponseDto>>> GetAll()
    {
        var projects = await _repo.GetAllAsync();
        return Ok(projects.Select(ToDto));
    }

    // GET: api/v1/Projects/5
    [HttpGet("{id}", Name = GetProjectRouteName)]
    public async Task<ActionResult<ProjectResponseDto>> Get(int id)
    {
        var project = await _repo.GetByIdAsync(id);
        if (project is null)
        {
            return NotFound();
        }

        return Ok(ToDto(project));
    }

    // GET: api/v1/Projects/5/tasks
    [HttpGet("{id}/tasks")]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetTasks(int id)
    {
        var project = await _repo.GetByIdAsync(id);
        if (project is null)
        {
            return NotFound();
        }

        var tasks = await _repo.GetTasksAsync(id);
        return Ok(tasks.Select(t => new TaskItemResponseDto
        {
            Id = t.Id,
            Title = t.Title,
            Description = t.Description,
            IsComplete = t.IsComplete,
            DueDate = t.DueDate,
            Status = t.Status.ToString(),
            Priority = t.Priority.ToString(),
            ParentTaskItemId = t.ParentTaskItemId,
            ProjectId = t.ProjectId,
            ProjectName = t.Project?.Name,
            CurrentJournalEntryId = t.CurrentJournalEntryId,
            FirstTaggedDate = t.FirstTaggedDate,
            MoveCount = t.MoveCount,
        }));
    }

    // POST: api/v1/Projects
    [HttpPost]
    public async Task<ActionResult<ProjectResponseDto>> Create([FromBody] CreateProjectDto createDto)
    {
        var project = new Project
        {
            Name = createDto.Name?.Trim() ?? string.Empty,
            Description = createDto.Description,
        };

        var validationResult = await _validator.ValidateAsync(project);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        if (await _repo.NameExistsAsync(project.Name))
        {
            return Conflict(new { message = "A project with this name already exists." });
        }

        var created = await _repo.AddAsync(project);
        return CreatedAtRoute(GetProjectRouteName, new { version = ApiVersionString, id = created.Id }, ToDto(created));
    }

    // PUT: api/v1/Projects/5
    [HttpPut("{id}")]
    public async Task<ActionResult<ProjectResponseDto>> Update(int id, [FromBody] UpdateProjectDto updateDto)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        existing.Name = updateDto.Name?.Trim() ?? string.Empty;
        existing.Description = updateDto.Description;
        existing.IsArchived = updateDto.IsArchived;

        var validationResult = await _validator.ValidateAsync(existing);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        if (await _repo.NameExistsAsync(existing.Name, id))
        {
            return Conflict(new { message = "A project with this name already exists." });
        }

        await _repo.UpdateAsync(existing);
        return Ok(ToDto(existing));
    }

    // DELETE: api/v1/Projects/5  (tasks are kept; their project is cleared)
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        await _repo.DeleteAsync(id);
        return NoContent();
    }

    // POST: api/v1/Projects/5/tasks
    [HttpPost("{id}/tasks")]
    public async Task<IActionResult> AssignTask(int id, [FromBody] AssignProjectTaskDto dto)
    {
        var validationResult = await _assignValidator.ValidateAsync(dto);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var result = await _repo.AssignTaskAsync(id, dto.TaskItemId);
        return result switch
        {
            AssignTaskResult.ProjectNotFound => NotFound(),
            AssignTaskResult.TaskNotFound => NotFound(),
            AssignTaskResult.AlreadyAssigned => Conflict(new { message = "This task is already assigned to the project." }),
            _ => NoContent(),
        };
    }

    // DELETE: api/v1/Projects/5/tasks/7
    [HttpDelete("{id}/tasks/{taskItemId}")]
    public async Task<IActionResult> UnassignTask(int id, int taskItemId)
    {
        return await _repo.UnassignTaskAsync(id, taskItemId) ? NoContent() : NotFound();
    }

    private static ProjectResponseDto ToDto(Project project) => new()
    {
        Id = project.Id,
        Name = project.Name,
        Description = project.Description,
        IsArchived = project.IsArchived,
        CreatedAt = project.CreatedAt,
        UpdatedAt = project.UpdatedAt,
        OpenTaskCount = project.Tasks.Count(t => !(t.IsComplete || t.Status == Status.Completed)),
        CompletedTaskCount = project.Tasks.Count(t => t.IsComplete || t.Status == Status.Completed),
    };
}
