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
public class TaskItemsController(ITaskRepository repo, IValidator<TaskItem> validator) : ControllerBase
{
    private const string ApiVersionString = "1.0";
    private const string ReopenPastDayErrorCode = "TASK_REOPEN_PAST_DAY_NOT_ALLOWED";
    private const string ParentTaskNotFoundErrorCode = "TASK_PARENT_NOT_FOUND";
    private const string ParentSelfNotAllowedErrorCode = "TASK_PARENT_SELF_NOT_ALLOWED";
    private const string ParentDepthNotAllowedErrorCode = "TASK_PARENT_DEPTH_NOT_ALLOWED";
    private const string ParentCycleNotAllowedErrorCode = "TASK_PARENT_CYCLE_NOT_ALLOWED";
    private const string ParentCompleteBlockedByChildrenErrorCode = "TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN";
    private const string ParentDeleteBlockedByChildrenErrorCode = "TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN";
    private readonly ITaskRepository _repo = repo;
    private readonly IValidator<TaskItem> _validator = validator;

    // GET: api/v1/TaskItems
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll()
    {
        var items = await _repo.GetAllAsync();
        var childCounts = items
            .Where(t => t.ParentTaskItemId.HasValue)
            .GroupBy(t => t.ParentTaskItemId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        var dtoTasks = items.Select(async i => new TaskItemResponseDto
        {
            Id = i.Id,
            Title = i.Title,
            Description = i.Description,
            IsComplete = i.IsComplete,
            DueDate = i.DueDate,
            Status = i.Status.ToString(),
            Priority = i.Priority.ToString(),
            ParentTaskItemId = i.ParentTaskItemId,
            ChildTaskCount = childCounts.GetValueOrDefault(i.Id),
            CurrentJournalDate = await _repo.GetAssignedJournalDateAsync(i.Id),
            MoveCount = i.MoveCount,
            DaysTagged = GetDaysTagged(i.FirstTaggedDate, await _repo.GetAssignedJournalDateAsync(i.Id))
        });
        return Ok(await Task.WhenAll(dtoTasks));
    }

    // GET: api/v1/TaskItems/5
    [HttpGet("{id}", Name = "GetTaskV1")]
    public async Task<ActionResult<TaskItemResponseDto>> Get(int id)
    {
        var item = await _repo.GetByIdAsync(id);
        if (item is null)
        {
            return NotFound();
        }

        var dto = new TaskItemResponseDto
        {
            Id = item.Id,
            Title = item.Title,
            Description = item.Description,
            IsComplete = item.IsComplete,
            DueDate = item.DueDate,
            Status = item.Status.ToString(),
            Priority = item.Priority.ToString(),
            ParentTaskItemId = item.ParentTaskItemId,
            ChildTaskCount = await GetChildTaskCountAsync(item.Id),
            CurrentJournalDate = await _repo.GetAssignedJournalDateAsync(item.Id),
            MoveCount = item.MoveCount,
            DaysTagged = GetDaysTagged(item.FirstTaggedDate, await _repo.GetAssignedJournalDateAsync(item.Id))
        };
        return Ok(dto);
    }

    // GET: api/v1/TaskItems/5/history
    [HttpGet("{id}/history")]
    public async Task<ActionResult<IEnumerable<TaskItemEventResponseDto>>> GetHistory(int id)
    {
        var item = await _repo.GetByIdAsync(id);
        if (item is null)
        {
            return NotFound();
        }

        var history = await _repo.GetHistoryAsync(id);
        return Ok(history.Select(e => new TaskItemEventResponseDto
        {
            Id = e.Id,
            TaskItemId = e.TaskItemId,
            EventType = e.EventType,
            OccurredAtUtc = e.OccurredAtUtc,
            FromJournalEntryId = e.FromJournalEntryId,
            ToJournalEntryId = e.ToJournalEntryId,
            FromJournalDate = e.FromJournalDate,
            ToJournalDate = e.ToJournalDate,
            ChangeSummary = e.ChangeSummary,
        }));
    }

    // POST: api/v1/TaskItems
    [HttpPost]
    public async Task<ActionResult<TaskItemResponseDto>> Create([FromBody] CreateTaskItemDto createDto)
    {
        if (createDto.ParentTaskItemId.HasValue)
        {
            var parent = await _repo.GetByIdAsync(createDto.ParentTaskItemId.Value);
            if (parent is null)
            {
                return UnprocessableEntity(new
                {
                    code = ParentTaskNotFoundErrorCode,
                    message = "The selected parent task was not found.",
                    details = new { parentTaskItemId = createDto.ParentTaskItemId }
                });
            }

            if (parent.ParentTaskItemId.HasValue)
            {
                return UnprocessableEntity(new
                {
                    code = ParentDepthNotAllowedErrorCode,
                    message = "Only one subtask level is supported.",
                    details = new { parentTaskItemId = createDto.ParentTaskItemId }
                });
            }
        }

        var item = new TaskItem
        {
            Title = createDto.Title,
            Description = createDto.Description,
            Status = createDto.Status,
            IsComplete = createDto.IsComplete,
            Priority = createDto.Priority,
            DueDate = createDto.DueDate,
            ParentTaskItemId = createDto.ParentTaskItemId
        };

        var validationResult = await _validator.ValidateAsync(item);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var createdItem = await _repo.AddAsync(item);

        var responseDto = new TaskItemResponseDto
        {
            Id = createdItem.Id,
            Title = createdItem.Title,
            Description = createdItem.Description,
            IsComplete = createdItem.IsComplete,
            DueDate = createdItem.DueDate,
            Status = createdItem.Status.ToString(),
            Priority = createdItem.Priority.ToString(),
            ParentTaskItemId = createdItem.ParentTaskItemId,
            ChildTaskCount = 0,
            CurrentJournalDate = await _repo.GetAssignedJournalDateAsync(createdItem.Id),
            MoveCount = createdItem.MoveCount,
            DaysTagged = GetDaysTagged(createdItem.FirstTaggedDate, await _repo.GetAssignedJournalDateAsync(createdItem.Id))
        };

        return CreatedAtRoute("GetTaskV1", new { version = ApiVersionString, id = createdItem.Id }, responseDto);
    }

    // PUT: api/v1/TaskItems/5
    [HttpPut("{id}")]
    public async Task<ActionResult<TaskItemResponseDto>> Update(int id, [FromBody] UpdateTaskItemDto updateDto)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        if (updateDto.ParentTaskItemId.HasValue)
        {
            if (updateDto.ParentTaskItemId.Value == id)
            {
                return UnprocessableEntity(new
                {
                    code = ParentSelfNotAllowedErrorCode,
                    message = "A task cannot be its own parent.",
                    details = new { parentTaskItemId = updateDto.ParentTaskItemId }
                });
            }

            var parent = await _repo.GetByIdAsync(updateDto.ParentTaskItemId.Value);
            if (parent is null)
            {
                return UnprocessableEntity(new
                {
                    code = ParentTaskNotFoundErrorCode,
                    message = "The selected parent task was not found.",
                    details = new { parentTaskItemId = updateDto.ParentTaskItemId }
                });
            }

            if (parent.ParentTaskItemId.HasValue)
            {
                return UnprocessableEntity(new
                {
                    code = ParentDepthNotAllowedErrorCode,
                    message = "Only one subtask level is supported.",
                    details = new { parentTaskItemId = updateDto.ParentTaskItemId }
                });
            }

            if (await WouldCreateCycleAsync(id, updateDto.ParentTaskItemId.Value))
            {
                return UnprocessableEntity(new
                {
                    code = ParentCycleNotAllowedErrorCode,
                    message = "This parent assignment would create a cycle.",
                    details = new { parentTaskItemId = updateDto.ParentTaskItemId }
                });
            }
        }

        var wasCompleted = IsCompleted(existing.IsComplete, existing.Status);
        var nextStatus = updateDto.Status ?? existing.Status;
        var nowCompleted = IsCompleted(updateDto.IsComplete, nextStatus);

        if (!wasCompleted && nowCompleted && await HasIncompleteChildrenAsync(id))
        {
            return UnprocessableEntity(new
            {
                code = ParentCompleteBlockedByChildrenErrorCode,
                message = "Parent tasks cannot be completed while child tasks are still open."
            });
        }

        if (wasCompleted && !nowCompleted)
        {
            var assignedDate = await _repo.GetAssignedJournalDateAsync(id);
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            if (assignedDate.HasValue && assignedDate.Value < today)
            {
                return UnprocessableEntity(new
                {
                    code = ReopenPastDayErrorCode,
                    message = "Completed tasks assigned to past days cannot be reopened.",
                    details = new { assignedDate }
                });
            }
        }

        // Apply incoming changes
        existing.Title = updateDto.Title;
        existing.Description = updateDto.Description;
        existing.IsComplete = updateDto.IsComplete;
        existing.Status = updateDto.Status ?? existing.Status;
        existing.Priority = updateDto.Priority ?? existing.Priority;
        existing.DueDate = updateDto.DueDate;
        existing.ParentTaskItemId = updateDto.ParentTaskItemId;

        var validationResult = await _validator.ValidateAsync(existing);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        await _repo.UpdateAsync(existing);

        if (updateDto.AutoCompleteParentWhenChildrenDone &&
            !wasCompleted &&
            nowCompleted &&
            existing.ParentTaskItemId.HasValue)
        {
            await TryAutoCompleteParentAsync(existing.ParentTaskItemId.Value);
        }

        var responseDto = new TaskItemResponseDto
        {
            Id = existing.Id,
            Title = existing.Title,
            Description = existing.Description,
            IsComplete = existing.IsComplete,
            DueDate = existing.DueDate,
            Status = existing.Status.ToString(),
            Priority = existing.Priority.ToString(),
            ParentTaskItemId = existing.ParentTaskItemId,
            ChildTaskCount = await GetChildTaskCountAsync(existing.Id),
            CurrentJournalDate = await _repo.GetAssignedJournalDateAsync(existing.Id),
            MoveCount = existing.MoveCount,
            DaysTagged = GetDaysTagged(existing.FirstTaggedDate, await _repo.GetAssignedJournalDateAsync(existing.Id))
        };

        return Ok(responseDto); // Return 200 OK with the updated resource
    }

    private static bool IsCompleted(bool isComplete, Status status) =>
        isComplete || status == Status.Completed;

    private async Task<bool> HasIncompleteChildrenAsync(int taskId)
    {
        var allTasks = await _repo.GetAllAsync();
        return allTasks.Any(t => t.ParentTaskItemId == taskId && !IsCompleted(t.IsComplete, t.Status));
    }

    private async Task<int> GetChildTaskCountAsync(int taskId)
    {
        var allTasks = await _repo.GetAllAsync();
        return allTasks.Count(t => t.ParentTaskItemId == taskId);
    }

    private async Task TryAutoCompleteParentAsync(int parentTaskId)
    {
        var parent = await _repo.GetByIdAsync(parentTaskId);
        if (parent is null || IsCompleted(parent.IsComplete, parent.Status))
        {
            return;
        }

        var allTasks = await _repo.GetAllAsync();
        var hasChildren = allTasks.Any(t => t.ParentTaskItemId == parentTaskId);
        if (!hasChildren)
        {
            return;
        }

        var hasIncompleteChildren = allTasks.Any(t =>
            t.ParentTaskItemId == parentTaskId && !IsCompleted(t.IsComplete, t.Status));

        if (hasIncompleteChildren)
        {
            return;
        }

        parent.IsComplete = true;
        parent.Status = Status.Completed;

        var validationResult = await _validator.ValidateAsync(parent);
        if (!validationResult.IsValid)
        {
            return;
        }

        await _repo.UpdateAsync(parent);
    }

    private static int GetDaysTagged(DateOnly? firstTaggedDate, DateOnly? currentJournalDate)
    {
        if (!firstTaggedDate.HasValue || !currentJournalDate.HasValue)
        {
            return 0;
        }

        return Math.Max(0, currentJournalDate.Value.DayNumber - firstTaggedDate.Value.DayNumber + 1);
    }

    // DELETE: api/v1/TaskItems/5
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        var allTasks = await _repo.GetAllAsync();
        if (allTasks.Any(t => t.ParentTaskItemId == id))
        {
            return UnprocessableEntity(new
            {
                code = ParentDeleteBlockedByChildrenErrorCode,
                message = "This task has subtasks. Remove or reassign subtasks before deleting."
            });
        }

        await _repo.DeleteAsync(id);
        return NoContent();
    }

    private async Task<bool> WouldCreateCycleAsync(int taskId, int proposedParentId)
    {
        var allTasks = await _repo.GetAllAsync();
        var parentByTaskId = allTasks.ToDictionary(t => t.Id, t => t.ParentTaskItemId);

        var cursor = proposedParentId;
        while (true)
        {
            if (cursor == taskId)
            {
                return true;
            }

            if (!parentByTaskId.TryGetValue(cursor, out var next) || !next.HasValue)
            {
                return false;
            }

            cursor = next.Value;
        }
    }
}
