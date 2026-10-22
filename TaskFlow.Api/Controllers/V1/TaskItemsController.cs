using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class TaskItemsController(
    ITaskRepository repo,
    IValidator<TaskItem> validator,
    IJournalEntryRepository journalRepo,
    IProjectRepository projectRepo) : ControllerBase
{
    private const string ApiVersionString = "1.0";
    private const string ProjectNotFoundErrorCode = "TASK_PROJECT_NOT_FOUND";
    private const string TaskCreationPastDayErrorCode = "TASK_CREATION_PAST_DAY_NOT_ALLOWED";
    private const string ReopenPastDayErrorCode = "TASK_REOPEN_PAST_DAY_NOT_ALLOWED";
    private const string ParentTaskNotFoundErrorCode = "TASK_PARENT_NOT_FOUND";
    private const string ParentSelfNotAllowedErrorCode = "TASK_PARENT_SELF_NOT_ALLOWED";
    private const string ParentDepthNotAllowedErrorCode = "TASK_PARENT_DEPTH_NOT_ALLOWED";
    private const string ParentCycleNotAllowedErrorCode = "TASK_PARENT_CYCLE_NOT_ALLOWED";
    private const string ParentCompleteBlockedByChildrenErrorCode = "TASK_PARENT_COMPLETE_BLOCKED_BY_CHILDREN";
    private const string ParentDeleteBlockedByChildrenErrorCode = "TASK_PARENT_DELETE_BLOCKED_BY_CHILDREN";
    private const string BlockDraftNotAllowedErrorCode = "TASK_BLOCK_DRAFT_NOT_ALLOWED";
    private const string BlockCompletedNotAllowedErrorCode = "TASK_BLOCK_COMPLETED_NOT_ALLOWED";
    private const string BlockedReasonRequiresBlockedStatusErrorCode = "TASK_BLOCKED_REASON_REQUIRES_BLOCKED_STATUS";
    private const string CreateBlockedNotAllowedErrorCode = "TASK_CREATE_BLOCKED_NOT_ALLOWED";
    private readonly ITaskRepository _repo = repo;
    private readonly IValidator<TaskItem> _validator = validator;
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly IProjectRepository _projectRepo = projectRepo;

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
        if (createDto.Status == Status.Blocked)
        {
            return UnprocessableEntity(new
            {
                code = CreateBlockedNotAllowedErrorCode,
                message = "New tasks cannot be created as Blocked. Create the task first, then block it.",
                details = new { status = createDto.Status.ToString() }
            });
        }

        if (createDto.JournalDate.HasValue)
        {
            // Use timezone offset if provided, otherwise fallback to UTC
            var today = UserDateHelper.GetUserToday(DateTime.UtcNow, createDto.TimezoneOffsetMinutes);
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

        if (createDto.ProjectId.HasValue && await _projectRepo.GetByIdAsync(createDto.ProjectId.Value) is null)
        {
            return UnprocessableEntity(new
            {
                code = ProjectNotFoundErrorCode,
                message = "The selected project was not found.",
                details = new { projectId = createDto.ProjectId }
            });
        }

        var item = new TaskItem
        {
            Title = createDto.Title,
            Description = createDto.Description,
            Status = createDto.Status,
            Priority = createDto.Priority,
            DueDate = createDto.DueDate,
            ParentTaskItemId = createDto.ParentTaskItemId,
            ProjectId = createDto.ProjectId
        };

        var validationResult = await _validator.ValidateAsync(item);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var createdItem = await _repo.AddAsync(item);

        if (createDto.JournalDate.HasValue)
        {
            await AssignToJournalDateAsync(createdItem.Id, createDto.JournalDate.Value, createDto.TimezoneOffsetMinutes);
        }

        var refreshed = await _repo.GetByIdAsync(createdItem.Id) ?? createdItem;
        var responseDto = await MapTaskItemResponseAsync(refreshed);

        return CreatedAtRoute("GetTaskV1", new { version = ApiVersionString, id = createdItem.Id }, responseDto);
    }

    // PUT: api/v1/TaskItems/5
    [HttpPut("{id}")]
    public Task<ActionResult<TaskItemResponseDto>> Update(int id, [FromBody] UpdateTaskItemDto updateDto) =>
        ApplyUpdateAsync(id, new TaskChanges
        {
            HasTitle = true,
            Title = updateDto.Title,
            HasDescription = true,
            Description = updateDto.Description,
            HasStatus = updateDto.Status.HasValue,
            Status = updateDto.Status,
            HasPriority = updateDto.Priority.HasValue,
            Priority = updateDto.Priority,
            HasDueDate = true,
            DueDate = updateDto.DueDate,
            HasParent = true,
            ParentTaskItemId = updateDto.ParentTaskItemId,
            // PUT: null keeps the stored reason, "" clears it.
            HasBlockedReason = updateDto.BlockedReason != null,
            BlockedReason = updateDto.BlockedReason,
            AutoCompleteParentWhenChildrenDone = updateDto.AutoCompleteParentWhenChildrenDone,
            TimezoneOffsetMinutes = updateDto.TimezoneOffsetMinutes
        });

    // PATCH: api/v1/TaskItems/5
    // Partial update (JSON Merge Patch): absent fields are left unchanged.
    [HttpPatch("{id}")]
    public Task<ActionResult<TaskItemResponseDto>> Patch(int id, [FromBody] PatchTaskItemDto patchDto) =>
        ApplyUpdateAsync(id, new TaskChanges
        {
            // A present null/empty title becomes "" so the validator returns 400.
            HasTitle = patchDto.IsPresent(nameof(PatchTaskItemDto.Title)),
            Title = patchDto.Title ?? string.Empty,
            HasDescription = patchDto.IsPresent(nameof(PatchTaskItemDto.Description)),
            Description = patchDto.Description,
            HasStatus = patchDto.Status.HasValue,
            Status = patchDto.Status,
            HasPriority = patchDto.Priority.HasValue,
            Priority = patchDto.Priority,
            HasDueDate = patchDto.IsPresent(nameof(PatchTaskItemDto.DueDate)),
            DueDate = patchDto.DueDate,
            HasParent = patchDto.IsPresent(nameof(PatchTaskItemDto.ParentTaskItemId)),
            ParentTaskItemId = patchDto.ParentTaskItemId,
            // PATCH: absent keeps the stored reason; present null or "" clears it.
            HasBlockedReason = patchDto.IsPresent(nameof(PatchTaskItemDto.BlockedReason)),
            BlockedReason = patchDto.BlockedReason,
            AutoCompleteParentWhenChildrenDone = patchDto.AutoCompleteParentWhenChildrenDone,
            TimezoneOffsetMinutes = patchDto.TimezoneOffsetMinutes
        });

    private sealed record TaskChanges
    {
        public bool HasTitle { get; init; }
        public string Title { get; init; } = string.Empty;
        public bool HasDescription { get; init; }
        public string? Description { get; init; }
        public bool HasStatus { get; init; }
        public Status? Status { get; init; }
        public bool HasPriority { get; init; }
        public Priority? Priority { get; init; }
        public bool HasDueDate { get; init; }
        public DateTime? DueDate { get; init; }
        public bool HasParent { get; init; }
        public int? ParentTaskItemId { get; init; }
        public bool HasBlockedReason { get; init; }
        public string? BlockedReason { get; init; }
        public bool AutoCompleteParentWhenChildrenDone { get; init; }
        public int? TimezoneOffsetMinutes { get; init; }
    }

    private async Task<ActionResult<TaskItemResponseDto>> ApplyUpdateAsync(int id, TaskChanges changes)
    {
        var existing = await _repo.GetByIdAsync(id);
        if (existing is null)
        {
            return NotFound();
        }

        if (changes.HasParent && changes.ParentTaskItemId.HasValue)
        {
            var proposedParentId = changes.ParentTaskItemId.Value;
            if (proposedParentId == id)
            {
                return UnprocessableEntity(new
                {
                    code = ParentSelfNotAllowedErrorCode,
                    message = "A task cannot be its own parent.",
                    details = new { parentTaskItemId = changes.ParentTaskItemId }
                });
            }

            var parent = await _repo.GetByIdAsync(proposedParentId);
            if (parent is null)
            {
                return UnprocessableEntity(new
                {
                    code = ParentTaskNotFoundErrorCode,
                    message = "The selected parent task was not found.",
                    details = new { parentTaskItemId = changes.ParentTaskItemId }
                });
            }

            if (parent.ParentTaskItemId.HasValue)
            {
                return UnprocessableEntity(new
                {
                    code = ParentDepthNotAllowedErrorCode,
                    message = "Only one subtask level is supported.",
                    details = new { parentTaskItemId = changes.ParentTaskItemId }
                });
            }

            if (await WouldCreateCycleAsync(id, proposedParentId))
            {
                return UnprocessableEntity(new
                {
                    code = ParentCycleNotAllowedErrorCode,
                    message = "This parent assignment would create a cycle.",
                    details = new { parentTaskItemId = changes.ParentTaskItemId }
                });
            }

            if (await HasChildrenAsync(id))
            {
                return UnprocessableEntity(new
                {
                    code = ParentDepthNotAllowedErrorCode,
                    message = "Only one subtask level is supported.",
                    details = new { parentTaskItemId = changes.ParentTaskItemId }
                });
            }
        }

        var (blockedError, blocked) = ResolveBlockedTransition(existing, changes);
        if (blockedError is not null)
        {
            return blockedError;
        }

        var wasCompleted = IsCompleted(existing.Status);
        var nextStatus = blocked.Status;
        var nowCompleted = IsCompleted(nextStatus);

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
            var today = UserDateHelper.GetUserToday(DateTime.UtcNow, changes.TimezoneOffsetMinutes);
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
        if (changes.HasTitle)
        {
            existing.Title = changes.Title;
        }

        if (changes.HasDescription)
        {
            existing.Description = changes.Description;
        }

        existing.Status = nextStatus;
        existing.BlockedReason = blocked.Reason;
        existing.BlockedAt = blocked.BlockedAt;
        existing.PreviousStatus = blocked.PreviousStatus;

        if (changes.HasPriority && changes.Priority.HasValue)
        {
            existing.Priority = changes.Priority.Value;
        }

        if (changes.HasDueDate)
        {
            existing.DueDate = changes.DueDate;
        }

        if (changes.HasParent)
        {
            existing.ParentTaskItemId = changes.ParentTaskItemId;
        }

        var validationResult = await _validator.ValidateAsync(existing);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        await _repo.UpdateAsync(existing);

        if (changes.AutoCompleteParentWhenChildrenDone &&
            !wasCompleted &&
            nowCompleted &&
            existing.ParentTaskItemId.HasValue)
        {
            await TryAutoCompleteParentAsync(existing.ParentTaskItemId.Value);
        }

        var responseDto = await MapTaskItemResponseAsync(existing);

        return Ok(responseDto); // Return 200 OK with the updated resource
    }

    private static bool IsCompleted(Status status) => status == Status.Completed;

    // Statuses a task may be blocked from. Add InProgress here when #239 lands.
    private static bool IsBlockable(Status status) => status == Status.Todo;

    // Statuses an unblock may restore. Add InProgress here when #239 lands; anything else restores Todo.
    private static bool IsRestorable(Status status) => status == Status.Todo;

    private sealed record BlockedState(Status Status, string? Reason, DateTime? BlockedAt, Status? PreviousStatus);

    private static string? NormalizeReason(string? reason)
    {
        var trimmed = reason?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    /// <summary>
    /// Applies the Blocked transition rules and returns the resulting status and blocked fields,
    /// or an error result when the transition is not allowed. Does not mutate the entity.
    /// </summary>
    private (ActionResult? Error, BlockedState State) ResolveBlockedTransition(TaskItem existing, TaskChanges changes)
    {
        var was = existing.Status;
        var next = changes.HasStatus && changes.Status.HasValue ? changes.Status.Value : was;
        var reason = NormalizeReason(changes.BlockedReason);

        if (was != Status.Blocked && next == Status.Blocked)
        {
            if (was == Status.Completed)
            {
                return (UnprocessableEntity(new
                {
                    code = BlockCompletedNotAllowedErrorCode,
                    message = "Completed tasks cannot be blocked.",
                    details = new { status = was.ToString() }
                }), default!);
            }

            if (!IsBlockable(was))
            {
                return (UnprocessableEntity(new
                {
                    code = BlockDraftNotAllowedErrorCode,
                    message = "Only open Todo tasks can be blocked.",
                    details = new { status = was.ToString() }
                }), default!);
            }

            return (null, new BlockedState(
                Status.Blocked,
                changes.HasBlockedReason ? reason : null,
                DateTime.UtcNow,
                was));
        }

        if (was == Status.Blocked && next == Status.Blocked)
        {
            // Only the reason may change. PreviousStatus and BlockedAt are never touched.
            return (null, new BlockedState(
                Status.Blocked,
                changes.HasBlockedReason ? reason : existing.BlockedReason,
                existing.BlockedAt,
                existing.PreviousStatus));
        }

        if (was == Status.Blocked)
        {
            // Leaving Blocked: clear all blocked fields; a reason sent in the same request is ignored.
            // An explicit Todo restores the previous status when restorable. Any other explicit status wins.
            var restored = next == Status.Todo && existing.PreviousStatus is { } previous && IsRestorable(previous)
                ? previous
                : next;
            return (null, new BlockedState(restored, null, null, null));
        }

        if (reason is not null)
        {
            return (UnprocessableEntity(new
            {
                code = BlockedReasonRequiresBlockedStatusErrorCode,
                message = "A blocked reason can only be set on a blocked task.",
                details = new { status = next.ToString() }
            }), default!);
        }

        return (null, new BlockedState(next, null, null, null));
    }

    private async Task<bool> HasIncompleteChildrenAsync(int taskId)
    {
        var allTasks = await _repo.GetAllAsync();
        return allTasks.Any(t => t.ParentTaskItemId == taskId && !IsCompleted(t.Status));
    }

    private async Task<bool> HasChildrenAsync(int taskId)
    {
        var allTasks = await _repo.GetAllAsync();
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
        if (parent is null || IsCompleted(parent.Status))
        {
            return;
        }

        // Blocked parents are never auto-completed.
        if (parent.Status == Status.Blocked)
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
            t.ParentTaskItemId == parentTaskId && !IsCompleted(t.Status));

        if (hasIncompleteChildren)
        {
            return;
        }

        parent.Status = Status.Completed;

        var validationResult = await _validator.ValidateAsync(parent);
        if (!validationResult.IsValid)
        {
            return;
        }

        await _repo.UpdateAsync(parent);
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

    private async Task AssignToJournalDateAsync(int taskId, DateOnly journalDate, int? timezoneOffsetMinutes = null)
    {
        JournalEntry entry;
        try
        {
            entry = await _journalRepo.GetByDateAsync(journalDate)
                ?? await _journalRepo.AddAsync(new JournalEntry
                {
                    Title = $"Journal {journalDate:MM-dd-yyyy}",
                    Date = journalDate,
                });
        }
        catch (DuplicateJournalDateException)
        {
            // A concurrent request created the entry for this date between our
            // GetByDateAsync miss and our AddAsync call. The row now exists —
            // re-fetch it and continue attaching the task to it. Unlike
            // JournalEntriesController.Create, the caller here only asked to
            // create a task, so we must not surface a 409 for this race.
            var existing = await _journalRepo.GetByDateAsync(journalDate);
            if (existing is null)
            {
                // Should not happen: the exception only fires on a unique
                // constraint violation, meaning a row for this date was just
                // committed by the concurrent request. Defensive guard only.
                return;
            }

            entry = existing;
        }

        await _journalRepo.AddTodoAsync(entry.Id, taskId, timezoneOffsetMinutes);
    }

    private async Task<TaskItemResponseDto> MapTaskItemResponseAsync(TaskItem item, IReadOnlyDictionary<int, int>? childCounts = null)
    {
        var currentJournalDate = await _repo.GetAssignedJournalDateAsync(item.Id);
        var childTaskCount = childCounts?.GetValueOrDefault(item.Id) ?? await GetChildTaskCountAsync(item.Id);

        return new TaskItemResponseDto
        {
            Id = item.Id,
            Title = item.Title,
            Description = item.Description,
            DueDate = item.DueDate,
            Status = item.Status.ToString(),
            Priority = item.Priority.ToString(),
            ParentTaskItemId = item.ParentTaskItemId,
            ProjectId = item.ProjectId,
            ProjectName = item.Project?.Name,
            CurrentJournalEntryId = item.CurrentJournalEntryId,
            FirstTaggedDate = item.FirstTaggedDate,
            LastMovedDate = await GetLastMovedDateAsync(item.Id),
            ChildTaskCount = childTaskCount,
            CurrentJournalDate = currentJournalDate,
            MoveCount = item.MoveCount,
            DaysTagged = DaysTaggedHelper.GetDaysTagged(item.FirstTaggedDate, currentJournalDate),
            BlockedReason = item.BlockedReason,
            BlockedAt = item.BlockedAt,
            PreviousStatus = item.PreviousStatus?.ToString()
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
