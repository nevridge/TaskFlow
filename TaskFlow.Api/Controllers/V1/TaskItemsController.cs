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
public class TaskItemsController(ITaskRepository repo, IValidator<TaskItem> validator, IJournalEntryRepository? journalRepo = null) : ControllerBase
{
    private const string ApiVersionString = "1.0";
    private const string TaskCreationPastDayErrorCode = "TASK_CREATION_PAST_DAY_NOT_ALLOWED";
    private const string ReopenPastDayErrorCode = "TASK_REOPEN_PAST_DAY_NOT_ALLOWED";
    private const string ParentTaskNotFoundErrorCode = "TASK_PARENT_NOT_FOUND";
    private const string ParentSelfNotAllowedErrorCode = "TASK_PARENT_SELF_NOT_ALLOWED";
    private const string ParentDepthNotAllowedErrorCode = "TASK_PARENT_DEPTH_NOT_ALLOWED";
    private const string ParentCycleNotAllowedErrorCode = "TASK_PARENT_CYCLE_NOT_ALLOWED";
    private const string ParentCompleteBlockedByChildrenErrorCode = "TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN";
    private const string ParentDeleteBlockedByChildrenErrorCode = "TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN";
    private readonly ITaskRepository _repo = repo;
    private readonly IValidator<TaskItem> _validator = validator;
    private readonly IJournalEntryRepository? _journalRepo = journalRepo;

    // GET: api/v1/TaskItems
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll()
    {
        var items = await _repo.GetAllAsync();
        var childCounts = items
            .Where(t => t.ParentTaskItemId.HasValue)
            .GroupBy(t => t.ParentTaskItemId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        var dtoTasks = items.Select(i => MapTaskItemResponseAsync(i, childCounts));
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

        var dto = await MapTaskItemResponseAsync(item);
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
        if (createDto.JournalDate.HasValue)
        {
            // Use timezone offset if provided, otherwise fallback to UTC
            DateTime utcNow = DateTime.UtcNow;
            DateTime userNow = utcNow;
            if (createDto.TimezoneOffsetMinutes.HasValue)
            {
                userNow = utcNow.AddMinutes(-createDto.TimezoneOffsetMinutes.Value);
            }
            var today = DateOnly.FromDateTime(userNow);
            if (createDto.JournalDate.Value < today)
            {
                return UnprocessableEntity(new
                {
                    code = TaskCreationPastDayErrorCode,
                    message = "You cannot create new tasks on a past journal day.",
                    details = new { journalDate = createDto.JournalDate }
                });
            }
        }

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

        if (createDto.JournalDate.HasValue)
        {
            await AssignToJournalDateAsync(createdItem.Id, createDto.JournalDate.Value);
        }

        var refreshed = await _repo.GetByIdAsync(createdItem.Id) ?? createdItem;
        var responseDto = await MapTaskItemResponseAsync(refreshed);

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

            if (await HasChildrenAsync(id))
            {
                return UnprocessableEntity(new
                {
                    code = ParentDepthNotAllowedErrorCode,
                    message = "Only one subtask level is supported.",
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

        var responseDto = await MapTaskItemResponseAsync(existing);

        return Ok(responseDto); // Return 200 OK with the updated resource
    }

    private static bool IsCompleted(bool isComplete, Status status) =>
        isComplete || status == Status.Completed;

    private async Task<bool> HasIncompleteChildrenAsync(int taskId)
    {
        var allTasks = await _repo.GetAllAsync() ?? [];
        return allTasks.Any(t => t.ParentTaskItemId == taskId && !IsCompleted(t.IsComplete, t.Status));
    }

    private async Task<bool> HasChildrenAsync(int taskId)
    {
        var allTasks = await _repo.GetAllAsync() ?? [];
        return allTasks.Any(t => t.ParentTaskItemId == taskId);
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

    private async Task AssignToJournalDateAsync(int taskId, DateOnly journalDate)
    {
        if (_journalRepo is null)
        {
            return;
        }

        var entry = await _journalRepo.GetByDateAsync(journalDate)
            ?? await _journalRepo.AddAsync(new JournalEntry
            {
                Title = $"Journal {journalDate:MM-dd-yyyy}",
                Date = journalDate,
            });

        await _journalRepo.AddTodoAsync(entry.Id, taskId);
    }

    private async Task<TaskItemResponseDto> MapTaskItemResponseAsync(TaskItem item, IReadOnlyDictionary<int, int>? childCounts = null)
    {
        var currentJournalDate = await _repo.GetAssignedJournalDateAsync(item.Id);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        return new TaskItemResponseDto
        {
            Id = item.Id,
            Title = item.Title,
            Description = item.Description,
            IsComplete = item.IsComplete,
            DueDate = item.DueDate,
            Status = item.Status.ToString(),
            Priority = item.Priority.ToString(),
            ParentTaskItemId = item.ParentTaskItemId,
            CurrentJournalEntryId = item.CurrentJournalEntryId,
            FirstTaggedDate = item.FirstTaggedDate,
            LastMovedDate = await GetLastMovedDateAsync(item.Id),
            IsScheduledFuture = currentJournalDate.HasValue && currentJournalDate.Value > today,
            ChildCount = childCounts?.GetValueOrDefault(item.Id) ?? await GetChildTaskCountAsync(item.Id),
            ChildTaskCount = childCounts?.GetValueOrDefault(item.Id) ?? await GetChildTaskCountAsync(item.Id),
            CurrentJournalDate = currentJournalDate,
            MoveCount = item.MoveCount,
            DaysTagged = GetDaysTagged(item.FirstTaggedDate, currentJournalDate)
        };
    }

    private async Task<DateOnly?> GetLastMovedDateAsync(int taskId)
    {
        var history = await _repo.GetHistoryAsync(taskId);
        return history
            .OrderByDescending(e => e.OccurredAtUtc)
            .Select(e => e.ToJournalDate ?? e.FromJournalDate)
            .FirstOrDefault(d => d.HasValue);
    }
}
