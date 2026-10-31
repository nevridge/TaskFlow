using Asp.Versioning;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.DTOs;
using TaskFlow.Api.Helpers;
using TaskFlow.Api.Models;
using TaskFlow.Api.Repositories;

namespace TaskFlow.Api.Controllers.V1;

[ApiController]
[ApiVersion(ApiVersions.V1)]
[Route("api/v{version:apiVersion}/JournalEntries/{entryId}/todos")]
public class JournalTodosController(
    IJournalEntryRepository journalRepo,
    IValidator<AddJournalTodoDto> validator,
    IValidator<JournalDayQueryDto> queryValidator) : ControllerBase
{
    private const string AssignmentPastDayErrorCode = "TASK_ASSIGNMENT_PAST_DAY_NOT_ALLOWED";
    private readonly IJournalEntryRepository _journalRepo = journalRepo;
    private readonly IValidator<AddJournalTodoDto> _validator = validator;
    private readonly IValidator<JournalDayQueryDto> _queryValidator = queryValidator;

    /// <summary>
    /// The todos of a journal day. A completed task with a completion time is a todo on the local day it was
    /// completed (derived with <c>timezoneOffsetMinutes</c>, UTC when omitted), not on its linked day; every other
    /// task is a todo on its linked day. Each task is a todo row on exactly one day.
    /// </summary>
    /// <remarks>
    /// Returns root tasks. A subtask that is a todo on this day while its parent is not is returned under its parent,
    /// which is then flagged <c>isContextOnly</c> and embeds only that day's subtasks. Each row's
    /// <c>currentJournalDate</c> is the task's own linked day (null when it was never linked).
    /// </remarks>
    // GET: api/v1/JournalEntries/{entryId}/todos
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItemResponseDto>>> GetAll(int entryId, [FromQuery] JournalDayQueryDto query)
    {
        var queryValidation = await _queryValidator.ValidateAsync(query);
        if (!queryValidation.IsValid)
        {
            return BadRequest(queryValidation.Errors);
        }

        var day = await _journalRepo.GetTodosForDayAsync(entryId, query.TimezoneOffsetMinutes);
        if (day is null)
        {
            return NotFound();
        }

        var rowIds = day.Tasks.Select(t => t.Id).ToHashSet();
        var rows = new List<TaskItemResponseDto>();

        foreach (var root in day.Tasks.Where(t => t.ParentTaskItemId is null))
        {
            rows.Add(MapTodo(root));
        }

        // A subtask whose parent is not a row of this day: show the parent as context, with only the subtasks of this day.
        var contextParents = day.Tasks
            .Where(t => t.ParentTaskItemId is { } parentId && !rowIds.Contains(parentId) && t.ParentTaskItem is not null)
            .GroupBy(t => t.ParentTaskItemId!.Value)
            .OrderBy(g => g.Key);
        foreach (var group in contextParents)
        {
            rows.Add(MapContextParent(group.First().ParentTaskItem!, group.OrderBy(c => c.Id)));
        }

        return Ok(rows);
    }

    // POST: api/v1/JournalEntries/{entryId}/todos
    [HttpPost]
    public async Task<IActionResult> AddTodo(int entryId, [FromBody] AddJournalTodoDto dto)
    {
        var validationResult = await _validator.ValidateAsync(dto);
        if (!validationResult.IsValid)
        {
            return BadRequest(validationResult.Errors);
        }

        var result = await _journalRepo.AddTodoAsync(entryId, dto.TaskItemId, dto.TimezoneOffsetMinutes);
        if (result == AddTodoResult.TaskCompleted)
        {
            var details = await _journalRepo.GetPlanCompletedDetailsAsync(entryId, dto.TaskItemId);
            return UnprocessableEntity(TaskRuleErrors.PlanCompletedNotAllowed(
                details?.AssignedDate, details?.CompletedAt, details?.JournalDate));
        }

        return result switch
        {
            AddTodoResult.EntryNotFound => NotFound(),
            AddTodoResult.TaskNotFound => NotFound(),
            AddTodoResult.AlreadyLinked => Conflict(new { message = "This task is already linked to the journal entry." }),
            AddTodoResult.PastDayNotAllowed => UnprocessableEntity(new
            {
                code = AssignmentPastDayErrorCode,
                message = "This task cannot be assigned to a past day."
            }),
            _ => NoContent(),
        };
    }

    // DELETE: api/v1/JournalEntries/{entryId}/todos/{taskItemId}
    [HttpDelete("{taskItemId}")]
    public async Task<IActionResult> RemoveTodo(int entryId, int taskItemId)
    {
        var currentTodos = await _journalRepo.GetTodosAsync(entryId);
        var todoList = currentTodos.ToList();

        if (!await _journalRepo.RemoveTodoAsync(entryId, taskItemId))
        {
            return NotFound();
        }

        var children = todoList.Where(t => t.ParentTaskItemId == taskItemId);
        foreach (var child in children)
        {
            await _journalRepo.RemoveTodoAsync(entryId, child.Id);
        }

        return NoContent();
    }

    // Maps a task with its own linked day. Children are preview data (#349): every subtask of a shown parent is
    // included, whichever day it is a todo on, and none of them is counted as a todo row of this day.
    private static TaskItemResponseDto MapTodo(TaskItem task) =>
        MapTodo(task, task.ChildTaskItems);

    private static TaskItemResponseDto MapContextParent(TaskItem parent, IEnumerable<TaskItem> attributedChildren)
    {
        var dto = MapTodo(parent, attributedChildren);
        dto.IsContextOnly = true;
        return dto;
    }

    private static TaskItemResponseDto MapTodo(TaskItem task, IEnumerable<TaskItem> childTasks)
    {
        var children = childTasks.Select(c => MapTodo(c, [])).ToList();
        // The task's own linked day, not the viewed day: a completed task is a row on its completion day.
        var linkedDate = task.CurrentJournalEntry?.Date;

        return new TaskItemResponseDto
        {
            Id = task.Id,
            Title = task.Title,
            Description = task.Description,
            DueDate = task.DueDate,
            Status = task.Status.ToString(),
            Priority = task.Priority.ToString(),
            ParentTaskItemId = task.ParentTaskItemId,
            ProjectId = task.ProjectId,
            ProjectName = task.Project?.Name,
            CurrentJournalEntryId = task.CurrentJournalEntryId,
            FirstTaggedDate = task.FirstTaggedDate,
            MoveCount = task.MoveCount,
            CurrentJournalDate = linkedDate,
            DaysTagged = DaysTaggedHelper.GetDaysTagged(task.FirstTaggedDate, linkedDate),
            ChildTaskCount = children.Count,
            BlockedReason = task.BlockedReason,
            BlockedAt = task.BlockedAt,
            PreviousStatus = task.PreviousStatus?.ToString(),
            StartedAt = task.StartedAt,
            CompletedAt = task.CompletedAt,
            Children = children.Count > 0 ? children : null,
        };
    }
}
