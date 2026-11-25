using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;
using TaskFlow.Contracts;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion(ApiVersions.V1)]
[Route("api/v{version:apiVersion}/[controller]")]
public class GoalsController(
    IGoalRepository repo,
    IValidator<Goal> validator,
    IValidator<AssignGoalTaskDto> assignValidator) : ControllerBase
{
    private const string GetGoalRouteName = "GetGoalV1";
    private const string GoalNotFoundMessage = "Goal not found.";
    private readonly IGoalRepository _repo = repo;
    private readonly IValidator<Goal> _validator = validator;
    private readonly IValidator<AssignGoalTaskDto> _assignValidator = assignValidator;

    // GET: api/v1/Goals?projectId=1&status=now
    [HttpGet]
    public async Task<ActionResult<IEnumerable<GoalResponseDto>>> GetAll(
        [FromQuery] int? projectId = null,
        [FromQuery] GoalStatus? status = null)
    {
        var goals = await _repo.GetAllAsync(projectId, status);
        return Ok(goals.Select(ToDto));
    }

    // GET: api/v1/Goals/5
    [HttpGet("{id}", Name = GetGoalRouteName)]
    public async Task<ActionResult<GoalResponseDto>> Get(int id)
    {
        var goal = await _repo.GetByIdAsync(id);
        return goal is null ? GoalNotFound() : Ok(ToDto(goal));
    }

    // POST: api/v1/Goals
    [HttpPost]
    public async Task<ActionResult<GoalResponseDto>> Create([FromBody] CreateGoalDto createDto)
    {
        var status = createDto.Status ?? GoalStatus.Next;
        if (status is not (GoalStatus.Next or GoalStatus.Now))
        {
            return BadRequest(new { message = "A new goal can only be Next or Now." });
        }

        var goal = new Goal
        {
            ProjectId = createDto.ProjectId,
            Title = createDto.Title?.Trim() ?? string.Empty,
            Description = NullIfBlank(createDto.Description),
            DoneWhen = NullIfBlank(createDto.DoneWhen),
            Status = status,
        };

        var validationResult = await _validator.ValidateAsync(goal);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var result = await _repo.CreateAsync(goal);
        if (result.Status == GoalWriteStatus.ProjectNotFound)
        {
            return BadRequest(new { message = "Project not found." });
        }

        if (result.Status == GoalWriteStatus.NowExists)
        {
            return Conflict(new
            {
                message = "This project already has a Now goal. Create this one as Next, then swap it to Now.",
            });
        }

        var created = await _repo.GetByIdAsync(result.GoalId) ?? goal;
        return CreatedAtRoute(GetGoalRouteName, new { version = ApiVersions.V1, id = result.GoalId }, ToDto(created));
    }

    /// <summary>Updates a goal (full update), including its status.</summary>
    /// <remarks>
    /// Returns 409 when the goal would become Now while the project has another Now goal (use swap-now), and 422 with
    /// <c>{ code, message, details }</c> for <c>GOAL_NOW_HAS_INPROGRESS_TASKS</c> (the Now goal cannot go back to Next or
    /// Parked while it has tasks in progress) and <c>GOAL_HAS_OPEN_TASKS</c> (Done or Dropped needs every task
    /// Completed). Nothing is saved.
    /// </remarks>
    [ProducesResponseType<GoalResponseDto>(StatusCodes.Status200OK)]
    [ProducesResponseType<TaskRuleErrorResponseDto>(StatusCodes.Status422UnprocessableEntity)]
    // PUT: api/v1/Goals/5
    [HttpPut("{id}")]
    public async Task<ActionResult<GoalResponseDto>> Update(int id, [FromBody] UpdateGoalDto updateDto)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return GoalNotFound();
        }

        if (updateDto.Status is not { } status)
        {
            return BadRequest(new { message = "Status is required." });
        }

        var changes = new Goal
        {
            ProjectId = existing.ProjectId,
            Title = updateDto.Title?.Trim() ?? string.Empty,
            Description = NullIfBlank(updateDto.Description),
            DoneWhen = NullIfBlank(updateDto.DoneWhen),
            Status = status,
            ParkedReason = status == GoalStatus.Parked ? NullIfBlank(updateDto.ParkedReason?.Trim()) : null,
        };

        var validationResult = await _validator.ValidateAsync(changes);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var result = await _repo.UpdateAsync(id, changes);
        return await ToWriteResponseAsync(result);
    }

    // PUT: api/v1/Goals/order  (the literal segment takes precedence over {id})
    [HttpPut("order")]
    public async Task<ActionResult<IEnumerable<GoalResponseDto>>> Reorder([FromBody] ReorderGoalsDto reorderDto)
    {
        if (!await _repo.ReorderAsync(reorderDto.ProjectId, reorderDto.GoalIds))
        {
            return BadRequest(new { message = "The list must contain every Next goal of the project exactly once." });
        }

        var goals = await _repo.GetAllAsync(reorderDto.ProjectId);
        return Ok(goals.Select(ToDto));
    }

    /// <summary>Makes a goal the project's Now goal; the previous Now goal goes to the top of Next.</summary>
    /// <remarks>
    /// Returns 422 <c>GOAL_NOW_HAS_INPROGRESS_TASKS</c> while the current Now goal has tasks in progress, and 400 for a
    /// Done or Dropped goal. A goal that is already Now is returned unchanged.
    /// </remarks>
    [ProducesResponseType<GoalResponseDto>(StatusCodes.Status200OK)]
    [ProducesResponseType<TaskRuleErrorResponseDto>(StatusCodes.Status422UnprocessableEntity)]
    // POST: api/v1/Goals/5/swap-now
    [HttpPost("{id}/swap-now")]
    public async Task<ActionResult<GoalResponseDto>> SwapNow(int id)
    {
        var result = await _repo.SwapNowAsync(id);
        return await ToWriteResponseAsync(result);
    }

    // DELETE: api/v1/Goals/5  (tasks are kept; their goal is cleared)
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        return await _repo.DeleteAsync(id) ? NoContent() : GoalNotFound();
    }

    /// <summary>Puts a task, with its subtasks in the same project, into a goal.</summary>
    /// <remarks>
    /// Returns 422 <c>TASK_GOAL_NOT_NOW</c> when the goal is Next or Parked, the project has a Now goal and the task or
    /// one of those subtasks is in progress. Nothing is changed.
    /// </remarks>
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<TaskRuleErrorResponseDto>(StatusCodes.Status422UnprocessableEntity)]
    // POST: api/v1/Goals/5/tasks
    [HttpPost("{id}/tasks")]
    public async Task<IActionResult> AssignTask(int id, [FromBody] AssignGoalTaskDto dto)
    {
        var validationResult = await _assignValidator.ValidateAsync(dto);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var result = await _repo.AssignTaskAsync(id, dto.TaskItemId);
        return result.Status switch
        {
            AssignGoalTaskStatus.GoalNotFound => GoalNotFound(),
            AssignGoalTaskStatus.TaskNotFound => NotFound(new { message = "Task not found." }),
            AssignGoalTaskStatus.IsSubtask => SubtaskGoal(),
            AssignGoalTaskStatus.WrongProject => BadRequest(new { message = "The task must be in the goal's project." }),
            AssignGoalTaskStatus.GoalClosed => BadRequest(new { message = "Tasks cannot be added to a Done or Dropped goal." }),
            AssignGoalTaskStatus.AlreadyAssigned => Conflict(new { message = "This task is already assigned to the goal." }),
            AssignGoalTaskStatus.GoalNotNow => UnprocessableEntity(
                GoalRuleErrors.TaskGoalNotNow(dto.TaskItemId, id, result.NowGoal!)),
            _ => NoContent(),
        };
    }

    // DELETE: api/v1/Goals/5/tasks/7
    [HttpDelete("{id}/tasks/{taskItemId}")]
    public async Task<IActionResult> RemoveTask(int id, int taskItemId)
    {
        return await _repo.RemoveTaskAsync(id, taskItemId) switch
        {
            RemoveGoalTaskResult.IsSubtask => SubtaskGoal(),
            RemoveGoalTaskResult.NotFound => NotFound(new { message = "This task is not in the goal." }),
            _ => NoContent(),
        };
    }

    private async Task<ActionResult<GoalResponseDto>> ToWriteResponseAsync(GoalWriteResult result)
    {
        switch (result.Status)
        {
            case GoalWriteStatus.NotFound:
                return GoalNotFound();
            case GoalWriteStatus.Closed:
                return BadRequest(new { message = "A Done or Dropped goal cannot be swapped to Now." });
            case GoalWriteStatus.NowExists:
                return Conflict(new { message = "This project already has a Now goal. Use swap-now instead." });
            case GoalWriteStatus.NowHasInProgressTasks:
                return UnprocessableEntity(GoalRuleErrors.NowHasInProgressTasks(result.GoalId, result.Tasks!));
            case GoalWriteStatus.HasOpenTasks:
                return UnprocessableEntity(GoalRuleErrors.HasOpenTasks(result.Tasks!));
            default:
                var goal = await _repo.GetByIdAsync(result.GoalId);
                return goal is null ? GoalNotFound() : Ok(ToDto(goal));
        }
    }

    private NotFoundObjectResult GoalNotFound() => NotFound(new { message = GoalNotFoundMessage });

    private BadRequestObjectResult SubtaskGoal() =>
        BadRequest(new { message = "A subtask's goal follows its parent and cannot be set directly." });

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static GoalResponseDto ToDto(Goal goal) => new()
    {
        Id = goal.Id,
        ProjectId = goal.ProjectId,
        Title = goal.Title,
        Description = goal.Description,
        DoneWhen = goal.DoneWhen,
        Status = goal.Status.ToString(),
        ParkedReason = goal.ParkedReason,
        DisplayOrder = goal.DisplayOrder,
        StatusChangedAt = goal.StatusChangedAt,
        ClosedAt = goal.ClosedAt,
        CreatedAt = goal.CreatedAt,
        UpdatedAt = goal.UpdatedAt,
        OpenTaskCount = goal.Tasks.Count(t => t.Status != Status.Completed),
        DoneTaskCount = goal.Tasks.Count(t => t.Status == Status.Completed),
    };
}
